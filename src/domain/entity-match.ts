/**
 * Cross-retailer product identity (entity resolution).
 *
 * Hybrid pipeline — first stage that fires wins:
 *   1. UPC / GTIN exact
 *   2. saved / manual retailer mapping
 *   3. structured attributes (brand, size, unit, category, name tokens)
 *   4. Fellegi–Sunter weighted score (Splink-style, in-process)
 *   5. semantic / image fallback (stub; never auto-links)
 *
 * Do not auto-link below AUTO_LINK_THRESHOLD. Persist matchMethod,
 * matchConfidence, and verified via src/lib/product-matches.ts.
 *
 * Not wired into compare / connectors. Optional batch Splink lives outside
 * the Next.js request path (see docs/product-entity-matching.md).
 */
import type { ProductOffer } from "@/connectors/types";
import { normalizeUpc, packsSimilar, upcsMatch } from "@/domain/fair-compare";
import { parseMassFromText } from "@/domain/units";

export const AUTO_LINK_THRESHOLD = Number.parseFloat(
  process.env.ENTITY_MATCH_AUTO_LINK_THRESHOLD ?? "0.85",
);

export type MatchMethod =
  | "upc"
  | "manual_mapping"
  | "structured"
  | "fellegi_sunter"
  | "semantic_fallback"
  | "image_fallback"
  | "none";

export type MatchDecision = "auto_linked" | "needs_review" | "rejected";

export interface ProductRecord {
  retailer: string;
  retailerProductId?: string;
  name: string;
  normalizedName?: string;
  brand?: string;
  sizeValue?: number;
  sizeUnit?: string;
  category?: string;
  upc?: string;
  gtin?: string;
  imageUrl?: string;
}

export interface SavedProductMapping {
  leftRetailer: string;
  leftProductId: string;
  rightRetailer: string;
  rightProductId: string;
  /** When true, treat as human-confirmed. */
  verified?: boolean;
}

export interface MatchExplainStep {
  stage: MatchMethod | "gate";
  score: number;
  reason: string;
}

export interface EntityMatchResult {
  matchMethod: MatchMethod;
  matchConfidence: number;
  verified: boolean;
  decision: MatchDecision;
  explain: MatchExplainStep[];
}

export interface MatchOptions {
  mappings?: SavedProductMapping[];
  threshold?: number;
  /** Reserved; image stage is a stub and never auto-links. */
  enableImage?: boolean;
}

const NAME_STOP = new Set([
  "the",
  "and",
  "or",
  "a",
  "an",
  "of",
  "for",
  "with",
  "pack",
  "pk",
  "size",
  "bunch",
  "sold",
  "singles",
  "each",
  "ea",
  "in",
  "to",
  "from",
  "whole",
  "carton",
]);

type ConflictGroup = { tokens: string[]; requireAny?: string[] };

/** Same-slot substitutes. Optional requireAny avoids e.g. white pasta vs brown eggs. */
const CONFLICT_GROUPS: ConflictGroup[] = [
  { tokens: ["oat", "almond", "soy", "coconut"] },
  { tokens: ["salted", "unsalted"] },
  { tokens: ["grape", "cherry", "beefsteak", "roma", "vine"], requireAny: ["tomato"] },
  { tokens: ["canola", "olive", "vegetable", "sunflower"], requireAny: ["oil"] },
  { tokens: ["white", "brown"], requireAny: ["sugar", "rice"] },
  { tokens: ["decaf"] },
  { tokens: ["classic", "mountain", "silk"], requireAny: ["coffee", "folgers"] },
  { tokens: ["light", "medium", "dark"], requireAny: ["coffee", "roast"] },
  { tokens: ["breast", "thigh", "wing"] },
  { tokens: ["english", "field"], requireAny: ["cucumber"] },
  { tokens: ["red", "green", "yellow"], requireAny: ["pepper", "bell"] },
  { tokens: ["vanilla", "chocolate"] },
  {
    tokens: ["frozen", "fresh"],
    requireAny: ["strawberry", "blueberry", "spinach"],
  },
  { tokens: ["wheat", "oat"], requireAny: ["bran"] },
  { tokens: ["2pct", "homo", "skim", "1pct"], requireAny: ["milk"] },
  { tokens: ["large", "medium", "small", "xl"], requireAny: ["egg"] },
];

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/jell-o/gi, "jello")
    .replace(/(\d+(?:\.\d+)?)(kg|g|l|ml|lb|oz|ct)\b/g, "$1 $2")
    .replace(/[^a-z0-9.%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PLURALS: Record<string, string> = {
  tomatoes: "tomato",
  potatoes: "potato",
  strawberries: "strawberry",
  blueberries: "blueberry",
  peaches: "peach",
  leaves: "leaf",
  loaves: "loaf",
};

function stemToken(t: string): string {
  if (PLURALS[t]) return PLURALS[t];
  if (t.endsWith("ss") || t.endsWith("us") || t.endsWith("is")) return t;
  if (t.endsWith("ies") && t.length > 5) return `${t.slice(0, -3)}y`;
  if (t.endsWith("s") && t.length > 3) return t.slice(0, -1);
  return t;
}

export function nameTokens(raw: string): string[] {
  const normalized = normalizeName(raw)
    .replace(/jell\s+o\b/g, "jello")
    .replace(/\bmayo\b/g, "mayonnaise")
    .replace(/2\s*%/g, "2pct")
    .replace(/1\s*%/g, "1pct")
    .replace(/\bhomogenized\b/g, "homo")
    .replace(/\blitres?\b/g, "l")
    .replace(/\bliters?\b/g, "l")
    .replace(/\bgrams?\b/g, "g")
    .replace(/\bkilograms?\b/g, "kg");
  return normalized
    .split(" ")
    .map(stemToken)
    .filter((t) => t.length > 0 && !NAME_STOP.has(t));
}

const UNIT_TOKENS = new Set([
  "kg",
  "g",
  "l",
  "ml",
  "lb",
  "oz",
  "ct",
  "litre",
  "liter",
  "gram",
  "kilogram",
]);

function brandTokenSet(brand?: string): Set<string> {
  const toks = nameTokens(brand ?? "");
  const out = new Set(toks);
  const initials = toks.map((t) => t[0]).join("");
  if (initials.length >= 2) out.add(initials);
  return out;
}

/** Name tokens with brand / size / unit removed so Jaccard is about the product. */
export function contentTokens(r: ProductRecord): string[] {
  const brand = brandTokenSet(r.brand);
  return nameTokens(r.name).filter(
    (t) =>
      !brand.has(t) &&
      !UNIT_TOKENS.has(t) &&
      !/^\d+(\.\d+)?%?$/.test(t) &&
      t !== "pct",
  );
}

export function recordJaccard(a: ProductRecord, b: ProductRecord): number {
  const sa = new Set(contentTokens(a));
  const sb = new Set(contentTokens(b));
  if (sa.size === 0 && sb.size === 0) return tokenJaccard(a.name, b.name);
  if (sa.size === 0 || sb.size === 0) return tokenJaccard(a.name, b.name);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

export function contentIntersection(a: ProductRecord, b: ProductRecord): number {
  const sa = new Set(contentTokens(a));
  const sb = new Set(contentTokens(b));
  let n = 0;
  for (const t of sa) if (sb.has(t)) n += 1;
  return n;
}

export function tokenJaccard(a: string, b: string): number {
  const sa = new Set(nameTokens(a));
  const sb = new Set(nameTokens(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

export function brandsMatch(
  a?: string | null,
  b?: string | null,
): "exact" | "partial" | "mismatch" | "missing" {
  const na = normalizeName(a ?? "");
  const nb = normalizeName(b ?? "");
  if (!na || !nb) return "missing";
  if (na === nb) return "exact";
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  if (shorter.length >= 4 && longer.includes(shorter)) return "partial";
  return "mismatch";
}

function barcodeOf(r: ProductRecord): string | null {
  return normalizeUpc(r.upc) ?? normalizeUpc(r.gtin);
}

function countFromRecord(r: ProductRecord): number | null {
  if (
    r.sizeValue != null &&
    Number.isFinite(r.sizeValue) &&
    r.sizeValue > 0 &&
    isCountUnit(r.sizeUnit)
  ) {
    return r.sizeValue;
  }
  const text = `${r.name} ${r.sizeUnit ?? ""}`;
  const m =
    text.match(/\b(\d+)\s*(?:ct|count|pk|pcs|pieces|eggs?)\b/i) ||
    text.match(/\b(\d+)\s*pack\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isCountUnit(unit?: string): boolean {
  if (!unit) return false;
  return /^(ct|count|ea|each|pk|pack|pcs|eggs?)$/i.test(unit);
}

function massKg(r: ProductRecord): number | null {
  if (
    r.sizeValue != null &&
    Number.isFinite(r.sizeValue) &&
    r.sizeValue > 0 &&
    r.sizeUnit &&
    !isCountUnit(r.sizeUnit)
  ) {
    const parsed = parseMassFromText(`${r.sizeValue}${r.sizeUnit}`);
    if (parsed && parsed.kg > 0) return parsed.kg;
    const u = r.sizeUnit.toLowerCase();
    if (u === "kg") return r.sizeValue;
    if (u === "g") return r.sizeValue / 1000;
    if (u === "lb" || u === "lbs") return r.sizeValue * 0.45359237;
    if (u === "oz") return r.sizeValue * 0.028349523125;
    if (u === "l" || u === "ml") {
      return u === "l" ? r.sizeValue : r.sizeValue / 1000;
    }
  }
  const fromText = parseMassFromText(
    `${r.name} ${r.sizeValue ?? ""} ${r.sizeUnit ?? ""}`,
  );
  return fromText && fromText.kg > 0 ? fromText.kg : null;
}

export type SizeAgreement = "same" | "close" | "different" | "unknown";

export function sizeAgreement(a: ProductRecord, b: ProductRecord): SizeAgreement {
  const ca = countFromRecord(a);
  const cb = countFromRecord(b);
  if (ca != null && cb != null) {
    if (ca === cb) return "same";
    const ratio = Math.max(ca, cb) / Math.min(ca, cb);
    if (ratio <= 1.12) return "close";
    return "different";
  }
  const ka = massKg(a);
  const kb = massKg(b);
  if (ka == null || kb == null) return "unknown";
  if (packsSimilar(ka, kb, 0.12)) return "same";
  if (packsSimilar(ka, kb, 0.2)) return "close";
  return "different";
}

function conflictPenalty(a: ProductRecord, b: ProductRecord): string | null {
  const ta = new Set(nameTokens(`${a.brand ?? ""} ${a.name}`));
  const tb = new Set(nameTokens(`${b.brand ?? ""} ${b.name}`));
  for (const group of CONFLICT_GROUPS) {
    if (group.requireAny && !group.requireAny.some((t) => ta.has(t) && tb.has(t))) {
      continue;
    }
    const hitA = group.tokens.filter((g) => ta.has(g));
    const hitB = group.tokens.filter((g) => tb.has(g));
    if (hitA.length === 0 || hitB.length === 0) continue;
    const shared = hitA.filter((x) => hitB.includes(x));
    if (shared.length === 0) {
      return `${hitA[0]} vs ${hitB[0]}`;
    }
  }
  if (ta.has("decaf") !== tb.has("decaf") && ta.has("coffee") && tb.has("coffee")) {
    return "decaf vs caffeinated";
  }
  return null;
}

function categoriesAgree(a: ProductRecord, b: ProductRecord): boolean | null {
  const ca = normalizeName(a.category ?? "");
  const cb = normalizeName(b.category ?? "");
  if (!ca || !cb) return null;
  return ca === cb;
}

function pairIdKey(retailer: string, id: string): string {
  return `${retailer}::${id}`;
}

function mappingHits(
  a: ProductRecord,
  b: ProductRecord,
  mappings: SavedProductMapping[],
): SavedProductMapping | undefined {
  const idA = a.retailerProductId;
  const idB = b.retailerProductId;
  if (!idA || !idB) return undefined;
  const left = pairIdKey(a.retailer, idA);
  const right = pairIdKey(b.retailer, idB);
  return mappings.find((m) => {
    const x = pairIdKey(m.leftRetailer, m.leftProductId);
    const y = pairIdKey(m.rightRetailer, m.rightProductId);
    return (x === left && y === right) || (x === right && y === left);
  });
}

function decide(
  method: MatchMethod,
  confidence: number,
  threshold: number,
  verified: boolean,
  explain: MatchExplainStep[],
): EntityMatchResult {
  const conf = round3(clamp01(confidence));
  const neverAuto =
    method === "semantic_fallback" ||
    method === "image_fallback" ||
    method === "none";
  let decision: MatchDecision;
  if (verified) {
    decision = "auto_linked";
  } else if (neverAuto || conf < threshold) {
    decision = conf >= 0.5 ? "needs_review" : "rejected";
  } else {
    decision = "auto_linked";
  }
  return {
    matchMethod: method,
    matchConfidence: conf,
    verified,
    decision,
    explain,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Structured 0–1 score from brand / size / category / name. */
export function structuredScore(
  a: ProductRecord,
  b: ProductRecord,
): { score: number; explain: MatchExplainStep[] } {
  const explain: MatchExplainStep[] = [];
  const jaccard = recordJaccard(a, b);
  const brand = brandsMatch(a.brand, b.brand);
  const size = sizeAgreement(a, b);
  const cat = categoriesAgree(a, b);
  const conflict = conflictPenalty(a, b);
  const shared = contentIntersection(a, b);

  let score = jaccard * 0.5;
  explain.push({
    stage: "structured",
    score: round3(jaccard),
    reason: `name token Jaccard ${jaccard.toFixed(2)}`,
  });

  if (brand === "exact") score += 0.28;
  else if (brand === "partial") score += 0.16;
  else if (brand === "mismatch") score -= 0.2;
  explain.push({
    stage: "structured",
    score: brand === "exact" ? 0.28 : brand === "partial" ? 0.16 : brand === "mismatch" ? -0.2 : 0,
    reason: `brand ${brand}`,
  });

  if (size === "same") score += 0.22;
  else if (size === "close") score += 0.1;
  else if (size === "different") score = Math.min(score, 0.42);
  explain.push({
    stage: "structured",
    score: size === "same" ? 0.22 : size === "close" ? 0.1 : size === "different" ? 0 : 0,
    reason: `size ${size}`,
  });

  if (cat === true) score += 0.08;
  else if (cat === false) score -= 0.12;
  explain.push({
    stage: "structured",
    score: cat === true ? 0.08 : cat === false ? -0.12 : 0,
    reason: `category ${cat === null ? "unknown" : cat ? "same" : "different"}`,
  });

  if ((brand === "exact" || brand === "partial") && (size === "same" || size === "close")) {
    score += 0.08;
    explain.push({
      stage: "structured",
      score: 0.08,
      reason: "brand + size corroboration",
    });
  }

  if (jaccard >= 0.85 && size !== "different" && brand !== "mismatch") {
    score = Math.max(score, 0.9);
    explain.push({
      stage: "structured",
      score: 0.9,
      reason: "near-identical name tokens",
    });
  }

  if (
    shared >= 2 &&
    (brand === "exact" || brand === "partial") &&
    (size === "same" || size === "close") &&
    !conflict
  ) {
    score = Math.max(score, 0.88);
    explain.push({
      stage: "structured",
      score: 0.88,
      reason: `brand+size with ${shared} shared product tokens`,
    });
  }

  if (conflict) {
    score = Math.min(score, 0.4);
    explain.push({
      stage: "gate",
      score: 0.4,
      reason: `substitute conflict: ${conflict}`,
    });
  }

  if (size === "different") {
    explain.push({
      stage: "gate",
      score: 0.42,
      reason: "same-brand different size is not the same pack entity",
    });
  }

  return { score: clamp01(score), explain };
}

/**
 * Splink-style Fellegi–Sunter: sum of match/unmatch weights → probability.
 * Weights are grocery priors, not EM-trained. Use real Splink offline to retune.
 */
export function fellegiSunterProbability(
  a: ProductRecord,
  b: ProductRecord,
): { probability: number; lambda: number; explain: MatchExplainStep[] } {
  const explain: MatchExplainStep[] = [];
  let lambda = -4.6; // prior ≈ 0.04 two random grocery SKUs match
  explain.push({
    stage: "fellegi_sunter",
    score: lambda,
    reason: "prior log2-odds two random SKUs match",
  });

  const jaccard = recordJaccard(a, b);
  if (jaccard >= 0.85) lambda += 5;
  else if (jaccard >= 0.6) lambda += 3;
  else if (jaccard >= 0.4) lambda += 1;
  else lambda -= 3;
  explain.push({
    stage: "fellegi_sunter",
    score: jaccard,
    reason: `name Jaccard ${jaccard.toFixed(2)}`,
  });

  const brand = brandsMatch(a.brand, b.brand);
  if (brand === "exact") lambda += 4;
  else if (brand === "partial") lambda += 2;
  else if (brand === "mismatch") lambda -= 3;
  explain.push({
    stage: "fellegi_sunter",
    score: brand === "exact" ? 4 : brand === "partial" ? 2 : brand === "mismatch" ? -3 : 0,
    reason: `brand ${brand}`,
  });

  const size = sizeAgreement(a, b);
  if (size === "same") lambda += 3.5;
  else if (size === "close") lambda += 1;
  else if (size === "different") lambda -= 5;
  explain.push({
    stage: "fellegi_sunter",
    score: size === "same" ? 3.5 : size === "close" ? 1 : size === "different" ? -5 : 0,
    reason: `size ${size}`,
  });

  const cat = categoriesAgree(a, b);
  if (cat === true) lambda += 1.5;
  else if (cat === false) lambda -= 2.5;
  explain.push({
    stage: "fellegi_sunter",
    score: cat === true ? 1.5 : cat === false ? -2.5 : 0,
    reason: `category ${cat === null ? "unknown" : cat ? "same" : "different"}`,
  });

  const upcA = barcodeOf(a);
  const upcB = barcodeOf(b);
  if (upcA && upcB && !upcsMatch(upcA, upcB)) {
    lambda -= 8;
    explain.push({
      stage: "fellegi_sunter",
      score: -8,
      reason: "both have UPC and they differ",
    });
  }

  const conflict = conflictPenalty(a, b);
  if (conflict) {
    lambda -= 6;
    explain.push({
      stage: "fellegi_sunter",
      score: -6,
      reason: `substitute conflict: ${conflict}`,
    });
  }

  const probability = 1 / (1 + 2 ** -lambda);
  return { probability: clamp01(probability), lambda, explain };
}

export function offerToProductRecord(offer: ProductOffer): ProductRecord {
  return {
    retailer: offer.retailer,
    retailerProductId: offer.productId,
    name: offer.name,
    normalizedName: normalizeName(offer.name),
    brand: offer.brand,
    category: undefined,
    upc: offer.upc,
    sizeUnit: offer.packageSize,
  };
}

export function matchProducts(
  a: ProductRecord,
  b: ProductRecord,
  opts: MatchOptions = {},
): EntityMatchResult {
  const threshold = opts.threshold ?? AUTO_LINK_THRESHOLD;
  const explain: MatchExplainStep[] = [];

  const upcA = barcodeOf(a);
  const upcB = barcodeOf(b);
  if (upcA && upcB && upcsMatch(upcA, upcB)) {
    explain.push({
      stage: "upc",
      score: 1,
      reason: `GTIN/UPC match ${upcA}`,
    });
    return decide("upc", 1, threshold, false, explain);
  }
  if (upcA && upcB) {
    explain.push({
      stage: "upc",
      score: 0,
      reason: "both have UPC and they differ — not an exact identity match",
    });
  }

  const mapping = mappingHits(a, b, opts.mappings ?? []);
  if (mapping) {
    explain.push({
      stage: "manual_mapping",
      score: 1,
      reason: mapping.verified
        ? "human-verified retailer mapping"
        : "saved retailer mapping",
    });
    return decide("manual_mapping", 1, threshold, Boolean(mapping.verified), explain);
  }

  const upcConflict = Boolean(upcA && upcB && !upcsMatch(upcA, upcB));
  const structured = structuredScore(a, b);
  explain.push(...structured.explain);
  const size = sizeAgreement(a, b);
  const conflict = conflictPenalty(a, b);
  const blocked =
    size === "different" || Boolean(conflict) || upcConflict;
  if (upcConflict) {
    explain.push({
      stage: "gate",
      score: 0,
      reason: "different UPC/GTIN — identity auto-link blocked",
    });
  }
  const structuredCanAuto = structured.score >= threshold && !blocked;
  if (structuredCanAuto) {
    return decide("structured", structured.score, threshold, false, explain);
  }

  const fs = fellegiSunterProbability(a, b);
  explain.push(...fs.explain);
  const nameOverlap = recordJaccard(a, b);
  const fsCanAuto =
    fs.probability >= threshold &&
    !blocked &&
    nameOverlap >= 0.55 &&
    structured.score >= 0.7;
  if (fsCanAuto) {
    return decide("fellegi_sunter", fs.probability, threshold, false, explain);
  }

  const jaccard = nameOverlap;
  if (opts.enableImage && a.imageUrl && b.imageUrl) {
    explain.push({
      stage: "image_fallback",
      score: 0,
      reason: "image embedding matcher not enabled in this build",
    });
  }

  const semanticConf = Math.min(0.62, 0.35 + jaccard * 0.35);
  if (jaccard >= 0.35 && size !== "different" && !conflict) {
    explain.push({
      stage: "semantic_fallback",
      score: round3(semanticConf),
      reason: "name overlap only — semantic/image fallback, never auto-link",
    });
    return decide("semantic_fallback", semanticConf, threshold, false, explain);
  }

  const best = Math.max(structured.score, fs.probability);
  const method: MatchMethod =
    fs.probability >= structured.score ? "fellegi_sunter" : "structured";
  explain.push({
    stage: "gate",
    score: round3(best),
    reason:
      size === "different"
        ? "size mismatch blocked auto-link"
        : conflict
          ? `substitute blocked auto-link (${conflict})`
          : `best score ${best.toFixed(2)} below threshold ${threshold}`,
  });
  return decide(method, best, threshold, false, explain);
}

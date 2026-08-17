import type { ProductOffer } from "@/connectors/types";
import { scoreMassMatch, resolveUnitPrices, parsePackCount } from "@/domain/units";
import { extractBarcodes, upcsMatch } from "@/domain/fair-compare";

const STOP = new Set([
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
  // "no pulp" vs "pulp free" — "no" is not a product token
  "no",
]);

/** Size / unit tokens are soft preferences, not hard requirements. */
const SOFT = new Set([
  "4l",
  "3l",
  "2l",
  "1l",
  "4",
  "3",
  "2",
  "1",
  "l",
  "kg",
  "g",
  "ml",
  "dozen",
  "12",
  "ea",
  "each",
  "1kg",
  "500g",
  "1000g",
]);

const REJECT_IF_PRESENT = [
  "pump",
  "dessert",
  "dog",
  "cat",
  "treat",
  "shampoo",
  "toy",
  "potter",
  "dragon",
  "harry",
  "medela",
  "norbert",
  "hagrid",
  "easter",
  "fillable",
  "party",
  "powder",
  "chocolate",
];

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP.has(t));
}

function tokenHit(needle: string, hay: string[]): boolean {
  return hay.some(
    (n) =>
      n === needle ||
      (needle.length >= 4 && (n.startsWith(needle) || needle.startsWith(n))),
  );
}

/** Score how well an offer matches the intended grocery query. Higher is better. */
export function scoreOfferMatch(
  offer: ProductOffer,
  query: string,
  opts?: { targetMassKg?: number },
): number {
  const qAll = tokens(query);
  const qCore = qAll.filter((t) => !SOFT.has(t));
  const qSoft = qAll.filter((t) => SOFT.has(t));
  // PCX often puts Tropicana (etc.) on `brand`, not in `title`.
  const name = tokens(`${offer.brand ?? ""} ${offer.name}`);
  if (qCore.length === 0 || name.length === 0) return -Infinity;

  const nameJoined = name.join(" ");
  for (const bad of REJECT_IF_PRESENT) {
    if (nameJoined.includes(bad) && !qCore.includes(bad)) return -Infinity;
  }

  let coreHits = 0;
  for (const t of qCore) {
    if (tokenHit(t, name)) coreHits += 1;
  }
  if (coreHits < qCore.length) return -Infinity;

  let softHits = 0;
  for (const t of qSoft) {
    if (
      tokenHit(t, name) ||
      (offer.packageSize && tokenHit(t, tokens(offer.packageSize)))
    ) {
      softHits += 1;
    }
  }

  if (offer.confidence === "estimated" && offer.price >= 100) return -Infinity;
  if (offer.price <= 0) return -Infinity;

  const confBonus = offer.confidence === "exact" ? 1 : 0;
  const softBonus = qSoft.length ? softHits / qSoft.length : 0;
  const pricePenalty = offer.price > 40 ? 1 : 0;
  const massBonus =
    opts?.targetMassKg != null ? scoreMassMatch(offer, opts.targetMassKg) : 0;

  return 10 + confBonus + softBonus + massBonus - pricePenalty;
}

export type OfferPickMode = "preferred" | "cheapest";

/**
 * Among offers that match the query, pick the lowest fair price.
 * Uses $/kg when mass/unit price is known (produce), otherwise shelf price.
 * Brand / preferred SKU is ignored — call only when matchMode=cheapest.
 */
export function pickCheapestOffer(
  offers: ProductOffer[],
  query: string,
  opts?: {
    targetMassKg?: number;
    /** Prefer comparing by $/kg when resolvable (default true). */
    byUnitPrice?: boolean;
    /** Compare by shelf ÷ pack count (eggs 12 vs 30). */
    byEach?: boolean;
    /** When unit prices are close, keep the bigger carton. */
    preferLargerPack?: boolean;
    /** If any hit matches, restrict to those (e.g. spinach cubes). */
    preferNameIncludes?: string[];
  },
): ProductOffer | null {
  if (offers.length === 0) return null;

  const byUnit = opts?.byUnitPrice !== false && !opts?.byEach;
  type Ranked = {
    offer: ProductOffer;
    matchScore: number;
    sortPrice: number;
    hasUnit: boolean;
    packCount: number;
  };
  let ranked: Ranked[] = [];

  for (const offer of offers) {
    const matchScore = scoreOfferMatch(offer, query, opts);
    if (matchScore === -Infinity) continue;

    const count = parsePackCount(offer.name, offer.packageSize);
    if (opts?.byEach) {
      const each =
        count && count > 0
          ? offer.price / count
          : offer.unitPrice != null && offer.unitPrice > 0 && offer.unitPrice < 3
            ? offer.unitPrice
            : null;
      if (each == null || !(each > 0)) continue;
      ranked.push({
        offer,
        matchScore,
        sortPrice: each,
        hasUnit: true,
        packCount: count ?? 0,
      });
      continue;
    }

    const units = byUnit
      ? resolveUnitPrices(offer, { forceSoldByWeight: false })
      : null;
    const hasUnit = Boolean(units?.pricePerKg && units.pricePerKg > 0);
    const sortPrice = hasUnit ? units!.pricePerKg : offer.price;
    if (!(sortPrice > 0)) continue;
    ranked.push({
      offer,
      matchScore,
      sortPrice,
      hasUnit,
      packCount: count ?? 0,
    });
  }

  if (!ranked.length) return null;

  const withUnit = ranked.filter((r) => r.hasUnit);
  if (withUnit.length) ranked = withUnit;

  if (opts?.preferNameIncludes?.length) {
    const pref = ranked.filter((r) => {
      const n = `${r.offer.brand ?? ""} ${r.offer.name}`.toLowerCase();
      return opts.preferNameIncludes!.some((p) => n.includes(p.toLowerCase()));
    });
    if (pref.length) ranked = pref;
  }

  ranked.sort((a, b) => {
    if (opts?.preferLargerPack && a.packCount > 0 && b.packCount > 0) {
      const rel =
        Math.abs(a.sortPrice - b.sortPrice) / Math.min(a.sortPrice, b.sortPrice);
      if (rel <= 0.08 && a.packCount !== b.packCount) {
        return b.packCount - a.packCount;
      }
    }
    if (a.sortPrice !== b.sortPrice) return a.sortPrice - b.sortPrice;
    if (opts?.preferLargerPack && a.packCount !== b.packCount) {
      return b.packCount - a.packCount;
    }
    return b.matchScore - a.matchScore;
  });
  return ranked[0]!.offer;
}

function findUpcHit(
  offers: ProductOffer[],
  query: string,
  preferredUpc?: string,
): ProductOffer | undefined {
  const codes = [
    ...extractBarcodes(query, preferredUpc),
    ...(preferredUpc ? [preferredUpc] : []),
  ];
  if (!codes.length) return undefined;
  return offers.find((o) =>
    codes.some(
      (c) => upcsMatch(o.upc, c) || upcsMatch(o.productId, c),
    ),
  );
}

export function pickBestOffer(
  offers: ProductOffer[],
  query: string,
  preferredId?: string,
  opts?: {
    targetMassKg?: number;
    mode?: OfferPickMode;
    preferNameIncludes?: string[];
    byEach?: boolean;
    preferLargerPack?: boolean;
    preferredUpc?: string;
  },
): ProductOffer | null {
  if (offers.length === 0) return null;

  if (preferredId) {
    const hit = offers.find((o) => o.productId === preferredId);
    if (hit) return hit;
  }

  const upcHit = findUpcHit(offers, query, opts?.preferredUpc);
  if (upcHit && opts?.mode !== "cheapest") return upcHit;

  if (opts?.mode === "cheapest") {
    return pickCheapestOffer(offers, query, opts);
  }

  let best: ProductOffer | null = null;
  let bestScore = -Infinity;
  for (const offer of offers) {
    const score = scoreOfferMatch(offer, query, opts);
    if (score > bestScore) {
      bestScore = score;
      best = offer;
    }
  }

  if (bestScore === -Infinity) return null;
  return best;
}

import type { ProductOffer } from "@/connectors/types";

export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 1 / KG_PER_LB;

export type MassUnit = "kg" | "g" | "lb" | "oz" | "ml" | "l";
/** Shelf weight-price unit (produce / sold-by-weight). */
export type WeightPriceUnit = "kg" | "lb";

export interface ParsedMass {
  value: number;
  unit: MassUnit;
  /** Always in kilograms */
  kg: number;
}

export interface UnitPriceBreakdown {
  pricePerKg: number;
  pricePerLb: number;
  /** Store-native unit for display (Walmart → kg, No Frills → lb by default). */
  nativeUnit: WeightPriceUnit;
  nativePrice: number;
  basis: string;
}

/** Parse first mass token from product name / packageSize (handles kg, g, lb, oz, ml≈g). */
export function parseMassFromText(text: string): ParsedMass | null {
  const s = text.toLowerCase().replace(/,/g, "");
  const all = [
    ...s.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|lb|lbs|oz|ounce|ounces|ml|l)\b/g),
  ].filter((m) => {
    // Skip unit-price crumbs: "$7.69/1kg" or "/ lb"
    const i = m.index ?? 0;
    const prev = s[i - 1];
    if (prev === "/" || prev === "$") return false;
    const before = s.slice(Math.max(0, i - 3), i);
    if (before.includes("/")) return false;
    return true;
  });
  if (all.length === 0) {
    const m2 = s.match(/(^|[^$/])(\d+(?:\.\d+)?)(kg|g|lb|lbs|oz|ml)\b/);
    if (!m2) return null;
    return toMass(Number(m2[2]), normalizeUnit(m2[3]));
  }
  // Prefer the largest pack size (skip "100ml" unit-price crumbs)
  const parsed = all.map((x) => toMass(Number(x[1]), normalizeUnit(x[2])));
  parsed.sort((a, b) => b.kg - a.kg);
  return parsed[0] ?? null;
}

/** "$7.69/1kg $3.49/1lb" from Loblaw packageSizing — real by-weight rate. */
export function parseEmbeddedWeightRates(text: string): {
  perKg?: number;
  perLb?: number;
} {
  const s = text.toLowerCase().replace(/,/g, "");
  let perKg: number | undefined;
  let perLb: number | undefined;
  for (const m of s.matchAll(
    /\$?\s*(\d+(?:\.\d+)?)\s*\/\s*(?:1\s*)?(kg|lb|lbs)\b/g,
  )) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const u = m[2];
    if (u === "kg") perKg = n;
    else perLb = n;
  }
  return { perKg, perLb };
}

function normalizeUnit(u: string): MassUnit {
  if (u === "kg") return "kg";
  if (u === "g") return "g";
  if (u === "lb" || u === "lbs") return "lb";
  if (u === "ml") return "ml";
  if (u === "l") return "l";
  return "oz";
}

function toMass(value: number, unit: MassUnit): ParsedMass {
  let kg = value;
  if (unit === "g" || unit === "ml") kg = value / 1000; // egg whites ~1 g/ml
  else if (unit === "l") kg = value; // 1 L ≈ 1 kg for egg whites
  else if (unit === "lb") kg = value * KG_PER_LB;
  else if (unit === "oz") kg = (value / 16) * KG_PER_LB;
  else if (unit === "kg") kg = value;
  return { value, unit, kg };
}

/** Prefer offers whose package mass ≈ targetKg (default ±12%). */
export function scoreMassMatch(
  offer: ProductOffer,
  targetKg: number,
  tol = 0.12,
): number {
  const mass =
    parseMassFromText(offer.packageSize ?? "") ??
    parseMassFromText(offer.name);
  if (!mass || targetKg <= 0) return 0;
  const rel = Math.abs(mass.kg - targetKg) / targetKg;
  if (rel <= tol) return 3;
  if (rel <= 0.25) return 1;
  // Strongly prefer exact size: half-size (500g vs 1kg) gets penalty
  if (mass.kg < targetKg * 0.6) return -4;
  if (mass.kg > targetKg * 1.6) return -2;
  return -1;
}

export function pickBestSizedOffer(
  offers: ProductOffer[],
  query: string,
  opts?: {
    preferredUpc?: string;
    targetMassKg?: number;
    pickBestOffer: (
      offers: ProductOffer[],
      query: string,
      preferredId?: string,
      opts?: { targetMassKg?: number },
    ) => ProductOffer | null;
  },
): ProductOffer | null {
  if (!offers.length) return null;
  const upc = opts?.preferredUpc?.replace(/^0+/, "") ?? "";
  if (upc) {
    const byUpc = offers.find(
      (o) =>
        (o.upc && o.upc.replace(/^0+/, "").includes(upc)) ||
        o.productId.replace(/^0+/, "").includes(upc),
    );
    if (byUpc) return byUpc;
  }

  const exact = offers.filter((o) => o.confidence === "exact");
  const pool = exact.length ? exact : offers;
  return opts!.pickBestOffer(pool, query, undefined, {
    targetMassKg: opts?.targetMassKg,
  });
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMass(kg: number): string {
  if (kg >= 1) return `${round2(kg)} kg`;
  return `${Math.round(kg * 1000)} g`;
}

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** Default shelf unit by retailer — Walmart CA uses kg; No Frills shelves often $/lb. */
export function defaultWeightUnit(
  retailer: string | undefined,
): WeightPriceUnit {
  if (retailer === "no_frills" || retailer === "wholesale_club") return "lb";
  return "kg";
}

/**
 * Detect whether an offer's unitPrice / shelf price is per kg or per lb.
 * Prefer productId suffixes from Loblaw (_KG / _LB), then text hints, then retailer default.
 */
export function detectWeightPriceUnit(
  offer: Pick<ProductOffer, "productId" | "name" | "packageSize" | "retailer">,
  retailerDefault?: WeightPriceUnit,
): WeightPriceUnit {
  const id = offer.productId.toUpperCase();
  if (id.endsWith("_LB") || id.includes("_LB_")) return "lb";
  if (id.endsWith("_KG") || id.includes("_KG_")) return "kg";

  const hint = `${offer.name} ${offer.packageSize ?? ""}`.toLowerCase();
  const hasLb = /(?:^|[\s/])(?:lb|lbs)\b|\/\s*lb|per\s*lb/.test(hint);
  const hasKg = /(?:^|[\s/])kg\b|\/\s*kg|per\s*kg/.test(hint);
  if (hasLb && !hasKg) return "lb";
  if (hasKg && !hasLb) return "kg";

  return retailerDefault ?? defaultWeightUnit(offer.retailer);
}

/**
 * Derive $/kg and $/lb for an offer. Returns null when mass/unit price cannot be resolved.
 *
 * `displayUnit` is what we show in the UI (Walmart → kg, No Frills → lb).
 * Shelf denomination is detected separately, then converted.
 */
export function resolveUnitPrices(
  offer: ProductOffer,
  opts?: {
    displayUnit?: WeightPriceUnit;
    /** Treat shelf `price` as already per-kg/per-lb (produce). */
    forceSoldByWeight?: boolean;
  },
): UnitPriceBreakdown | null {
  const displayUnit =
    opts?.displayUnit ?? defaultWeightUnit(offer.retailer);

  const embedded = parseEmbeddedWeightRates(
    `${offer.packageSize ?? ""} ${offer.name}`,
  );
  if (embedded.perKg != null || embedded.perLb != null) {
    const pricePerKg =
      embedded.perKg ??
      (embedded.perLb != null ? embedded.perLb / KG_PER_LB : 0);
    if (pricePerKg > 0) {
      const pricePerLb = pricePerKg * KG_PER_LB;
      return {
        pricePerKg: round2(pricePerKg),
        pricePerLb: round2(pricePerLb),
        nativeUnit: displayUnit,
        nativePrice: round2(displayUnit === "lb" ? pricePerLb : pricePerKg),
        basis: "embedded_rate",
      };
    }
  }

  const mass =
    parseMassFromText(offer.packageSize ?? "") ??
    parseMassFromText(offer.name);

  const id = offer.productId.toUpperCase();
  const soldByWeight =
    opts?.forceSoldByWeight === true ||
    id.endsWith("_KG") ||
    id.endsWith("_LB") ||
    /\b(?:per|\/)\s*(?:kg|lb)\b/i.test(
      `${offer.name} ${offer.packageSize ?? ""}`,
    );

  let pricePerKg: number | null = null;
  let basis = "";

  if (soldByWeight) {
    const shelfIs = detectWeightPriceUnit(offer, displayUnit);
    pricePerKg = shelfIs === "lb" ? offer.price / KG_PER_LB : offer.price;
    basis = `sold_by_${shelfIs}`;
  } else if (
    offer.unitPrice != null &&
    Number.isFinite(offer.unitPrice) &&
    offer.unitPrice > 0 &&
    !(
      mass &&
      mass.kg > 0 &&
      offer.price > 0 &&
      offer.unitPrice > (offer.price / mass.kg) * 20
    ) &&
    !(offer.price > 0 && offer.unitPrice > Math.max(offer.price * 50, 80))
  ) {
    const unitIs = detectWeightPriceUnit(offer, displayUnit);
    pricePerKg =
      unitIs === "lb" ? offer.unitPrice / KG_PER_LB : offer.unitPrice;
    basis = "unitPrice";
  } else if (mass && mass.kg > 0) {
    pricePerKg = offer.price / mass.kg;
    basis = `pack_${mass.value}${mass.unit}`;
  }

  if (pricePerKg == null || !Number.isFinite(pricePerKg) || pricePerKg <= 0) {
    return null;
  }

  const pricePerLb = pricePerKg * KG_PER_LB;
  return {
    pricePerKg: round2(pricePerKg),
    pricePerLb: round2(pricePerLb),
    nativeUnit: displayUnit,
    nativePrice: round2(displayUnit === "lb" ? pricePerLb : pricePerKg),
    basis,
  };
}

/**
 * Normalize an offer price to CAD for a given purchase mass in kg.
 * Uses unitPrice when present; otherwise derives from package mass or treats price as per-kg if name says kg.
 */
export function priceForMassKg(
  offer: ProductOffer,
  purchaseKg: number,
): {
  lineTotal: number;
  pricePerKg: number;
  basis: string;
} | null {
  if (purchaseKg <= 0) return null;
  const units = resolveUnitPrices(offer, { forceSoldByWeight: false });
  if (!units) {
    // Produce fallback: try treating shelf as sold-by-weight
    const sold = resolveUnitPrices(offer, { forceSoldByWeight: true });
    if (!sold) return null;
    return {
      lineTotal: round2(sold.pricePerKg * purchaseKg),
      pricePerKg: sold.pricePerKg,
      basis: sold.basis,
    };
  }
  return {
    lineTotal: round2(units.pricePerKg * purchaseKg),
    pricePerKg: units.pricePerKg,
    basis: units.basis,
  };
}

/**
 * Cover a needed mass with N smaller/larger packs of the same SKU.
 * Example: need 4 × 1 kg → 4 kg; only 500 ml packs → buy 8 × $5.49.
 */
export function priceByPackCount(
  offer: ProductOffer,
  needKg: number,
): {
  lineTotal: number;
  packsNeeded: number;
  packKg: number;
  coveredKg: number;
  pricePerKg: number;
  basis: string;
} | null {
  if (needKg <= 0) return null;
  const mass =
    parseMassFromText(offer.packageSize ?? "") ??
    parseMassFromText(offer.name);
  if (!mass || mass.kg <= 0) return null;

  const packsNeeded = Math.ceil(needKg / mass.kg - 1e-9);
  if (packsNeeded < 1) return null;
  const coveredKg = round2(packsNeeded * mass.kg);
  const lineTotal = round2(packsNeeded * offer.price);
  return {
    lineTotal,
    packsNeeded,
    packKg: mass.kg,
    coveredKg,
    pricePerKg: round2(offer.price / mass.kg),
    basis: `${packsNeeded}×${formatMass(mass.kg)}`,
  };
}

export function weightUnitLabel(unit: WeightPriceUnit): string {
  return unit === "lb" ? "\u0437\u0430 1 lb" : "\u0437\u0430 1 kg";
}

export function formatMoneyPerWeight(
  price: number,
  unit: WeightPriceUnit,
): string {
  return `$${round2(price).toFixed(2)} / ${unit}`;
}

/** Carton / dozen count from name or "30 ea, $0.58/1ea". */
export function parsePackCount(
  ...parts: Array<string | undefined | null>
): number | null {
  const t = parts.filter(Boolean).join(" ").toLowerCase();
  if (!t) return null;
  let best: number | null = null;
  for (const m of t.matchAll(/(\d+)\s*(?:ea|count|ct|eggs?)\b/g)) {
    const n = Number(m[1]);
    if (n >= 6 && n <= 60 && (best == null || n > best)) best = n;
  }
  if (best != null) return best;
  if (/\bdozen\b/.test(t)) return 12;
  const bare = t.match(/\b(6|12|18|24|30|36|60)\b/);
  if (bare) return Number(bare[1]);
  return null;
}

export function formatMoneyPerEach(price: number, unit = "egg"): string {
  return `$${round2(price).toFixed(2)} / ${unit}`;
}

import type { ProductOffer } from "@/connectors/types";

const KG_PER_LB = 0.45359237;

export type MassUnit = "kg" | "g" | "lb" | "oz" | "ml" | "l";

export interface ParsedMass {
  value: number;
  unit: MassUnit;
  /** Always in kilograms */
  kg: number;
}

/** Parse first mass token from product name / packageSize (handles kg, g, lb, oz, ml≈g). */
export function parseMassFromText(text: string): ParsedMass | null {
  const s = text.toLowerCase().replace(/,/g, "");
  const all = [
    ...s.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|lb|lbs|oz|ounce|ounces|ml|l)\b/g),
  ];
  if (all.length === 0) {
    const m2 = s.match(/(\d+(?:\.\d+)?)(kg|g|lb|lbs|oz|ml)\b/);
    if (!m2) return null;
    return toMass(Number(m2[1]), normalizeUnit(m2[2]));
  }
  // Prefer the largest pack size (skip "100ml" unit-price crumbs)
  const parsed = all.map((x) => toMass(Number(x[1]), normalizeUnit(x[2])));
  parsed.sort((a, b) => b.kg - a.kg);
  return parsed[0] ?? null;
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

  const mass =
    parseMassFromText(offer.packageSize ?? "") ??
    parseMassFromText(offer.name);

  // Explicit unit price (often already $/kg or $/lb — detect from name)
  if (offer.unitPrice != null && Number.isFinite(offer.unitPrice)) {
    const unitHint = `${offer.name} ${offer.packageSize ?? ""}`.toLowerCase();
    let perKg = offer.unitPrice;
    if (/\b\/\s*lb\b|\bper\s*lb\b|\blb\b/.test(unitHint) && !/\bkg\b/.test(unitHint)) {
      perKg = offer.unitPrice / KG_PER_LB;
    }
    // productId ending _KG from Loblaw often means price is already for sold-by-kg item
    if (offer.productId.endsWith("_KG") && !mass) {
      perKg = offer.price; // shelf price is typically $/kg for variable-weight
      return {
        lineTotal: round2(perKg * purchaseKg),
        pricePerKg: perKg,
        basis: "sold_by_kg",
      };
    }
    return {
      lineTotal: round2(perKg * purchaseKg),
      pricePerKg: perKg,
      basis: "unitPrice",
    };
  }

  if (offer.productId.endsWith("_KG")) {
    return {
      lineTotal: round2(offer.price * purchaseKg),
      pricePerKg: offer.price,
      basis: "sold_by_kg",
    };
  }

  if (mass && mass.kg > 0) {
    const perKg = offer.price / mass.kg;
    return {
      lineTotal: round2(perKg * purchaseKg),
      pricePerKg: perKg,
      basis: `pack_${mass.value}${mass.unit}`,
    };
  }

  // Single item with unknown mass — cannot fair-compare to weighted receipt line
  return null;
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

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMass(kg: number): string {
  if (kg >= 1) return `${round2(kg)} kg`;
  return `${Math.round(kg * 1000)} g`;
}

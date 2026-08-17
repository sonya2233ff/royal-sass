/**
 * Category B purchase pick: needed weight, not cheapest $/100g.
 * Do not use for category A.
 */
import { packMassKg, pricePer100gFromKg } from "@/domain/fair-compare";
import { isEachSoldOffer } from "@/domain/same-packed-item";
import { round2 } from "@/domain/units";

/** Allowed shortfall vs needed weight. */
export const NEEDED_WEIGHT_UNDER_FRAC = 0.1;
/** Allowed surplus vs needed weight. */
export const NEEDED_WEIGHT_OVER_FRAC = 0.15;

export interface NeededWeightCandidate {
  productId: string;
  name: string;
  price: number;
  packageSize?: string;
  parsedMassKg?: number;
  /** When the shelf price is per piece (1 ea), use this average fruit/veg weight. */
  typicalEachGrams?: number;
  image?: string;
}

export interface WeightPurchasePlan {
  productId: string;
  name: string;
  image?: string;
  neededGrams: number;
  packGrams: number;
  packs: number;
  gotGrams: number;
  deltaGrams: number;
  deltaPct: number;
  shelfPrice: number;
  totalPrice: number;
  pricePer100g: number;
  inRange: boolean;
  coverFallback: boolean;
  soldByWeight: boolean;
}

export function neededWeightBounds(neededGrams: number): {
  minGrams: number;
  maxGrams: number;
} {
  return {
    minGrams: neededGrams * (1 - NEEDED_WEIGHT_UNDER_FRAC),
    maxGrams: neededGrams * (1 + NEEDED_WEIGHT_OVER_FRAC),
  };
}

export function isInNeededWeightRange(
  gotGrams: number,
  neededGrams: number,
): boolean {
  if (!(neededGrams > 0) || !(gotGrams > 0)) return false;
  const { minGrams, maxGrams } = neededWeightBounds(neededGrams);
  return gotGrams + 1e-6 >= minGrams && gotGrams - 1e-6 <= maxGrams;
}

function planFromPacks(input: {
  candidate: NeededWeightCandidate;
  neededGrams: number;
  packGrams: number;
  packs: number;
  inRange: boolean;
  coverFallback: boolean;
}): WeightPurchasePlan {
  const gotGrams = input.packs * input.packGrams;
  const deltaGrams = round2(gotGrams - input.neededGrams);
  const totalPrice = round2(input.candidate.price * input.packs);
  const perKg =
    input.packGrams > 0
      ? input.candidate.price / (input.packGrams / 1000)
      : 0;
  return {
    productId: input.candidate.productId,
    name: input.candidate.name,
    image: input.candidate.image,
    neededGrams: input.neededGrams,
    packGrams: round2(input.packGrams),
    packs: input.packs,
    gotGrams: round2(gotGrams),
    deltaGrams,
    deltaPct: round2((deltaGrams / input.neededGrams) * 100),
    shelfPrice: input.candidate.price,
    totalPrice,
    pricePer100g: perKg > 0 ? pricePer100gFromKg(perKg) : 0,
    inRange: input.inRange,
    coverFallback: input.coverFallback,
    soldByWeight: false,
  };
}

/** One SKU: in-range N packs, else cheapest N that fully covers. */
export function purchasePlanForPack(
  neededGrams: number,
  candidate: NeededWeightCandidate,
): WeightPurchasePlan | null {
  const printedKg = packMassKg(candidate.name, candidate.packageSize, null);
  const eachKg =
    candidate.typicalEachGrams != null &&
    candidate.typicalEachGrams > 0 &&
    isEachSoldOffer(candidate)
      ? candidate.typicalEachGrams / 1000
      : null;
  const storedKg = packMassKg(
    candidate.name,
    candidate.packageSize,
    candidate.parsedMassKg,
  );
  const useKg =
    printedKg && printedKg > 0
      ? printedKg
      : eachKg && eachKg > 0
        ? eachKg
        : storedKg;
  if (!useKg || useKg <= 0 || !(candidate.price > 0) || !(neededGrams > 0)) {
    return null;
  }
  const packGrams = useKg * 1000;
  const { minGrams, maxGrams } = neededWeightBounds(neededGrams);
  const nMin = Math.max(1, Math.ceil(minGrams / packGrams - 1e-9));
  const nMax = Math.floor(maxGrams / packGrams + 1e-9);
  const inRange: WeightPurchasePlan[] = [];
  if (nMax >= nMin) {
    for (let n = nMin; n <= Math.min(nMax, 30); n += 1) {
      const got = n * packGrams;
      if (!isInNeededWeightRange(got, neededGrams)) continue;
      inRange.push(
        planFromPacks({
          candidate,
          neededGrams,
          packGrams,
          packs: n,
          inRange: true,
          coverFallback: false,
        }),
      );
    }
  }
  if (inRange.length) {
    inRange.sort(comparePlans);
    return inRange[0] ?? null;
  }
  const nCover = Math.max(1, Math.ceil(neededGrams / packGrams - 1e-9));
  const got = nCover * packGrams;
  if (got + 1e-6 < neededGrams) return null;
  return planFromPacks({
    candidate,
    neededGrams,
    packGrams,
    packs: nCover,
    inRange: isInNeededWeightRange(got, neededGrams),
    coverFallback: !isInNeededWeightRange(got, neededGrams),
  });
}

function comparePlans(a: WeightPurchasePlan, b: WeightPurchasePlan): number {
  if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
  return Math.abs(a.deltaGrams) - Math.abs(b.deltaGrams);
}

/**
 * Among pack sizes, prefer in-range (−10% / +15%) lowest total price,
 * else cheapest cover of the needed weight.
 */
export function pickNeededWeightPurchase(
  neededGrams: number,
  candidates: NeededWeightCandidate[],
): WeightPurchasePlan | null {
  const plans: WeightPurchasePlan[] = [];
  for (const candidate of candidates) {
    const plan = purchasePlanForPack(neededGrams, candidate);
    if (plan) plans.push(plan);
  }
  if (!plans.length) return null;
  const inRange = plans.filter((p) => p.inRange);
  const pool = inRange.length ? inRange : plans.filter((p) => p.coverFallback);
  if (!pool.length) return null;
  pool.sort(comparePlans);
  return pool[0] ?? null;
}

/** Loose produce: price is $/kg, no pack count. */
export function looseWeightPurchase(input: {
  neededGrams: number;
  pricePerKg: number;
  productId: string;
  name: string;
  image?: string;
  shelfPrice?: number;
}): WeightPurchasePlan | null {
  if (!(input.neededGrams > 0) || !(input.pricePerKg > 0)) return null;
  const totalPrice = round2(input.pricePerKg * (input.neededGrams / 1000));
  return {
    productId: input.productId,
    name: input.name,
    image: input.image,
    neededGrams: input.neededGrams,
    packGrams: 0,
    packs: 0,
    gotGrams: input.neededGrams,
    deltaGrams: 0,
    deltaPct: 0,
    shelfPrice: input.shelfPrice ?? input.pricePerKg,
    totalPrice,
    pricePer100g: pricePer100gFromKg(input.pricePerKg),
    inRange: true,
    coverFallback: false,
    soldByWeight: true,
  };
}

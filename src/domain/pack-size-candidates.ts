/**
 * Category B packed items: keep one candidate per pack size so
 * needed-weight pick can choose 2×283 g instead of one 907 g bag.
 * Not used for category A or sold-by-weight.
 */
import { packMassKg } from "@/domain/fair-compare";
import {
  pickNeededWeightPurchase,
  type NeededWeightCandidate,
} from "@/domain/needed-weight-pick";

const PACK_BUCKET_G = 5;
const MAX_PACK_SIZES = 10;

export function packGramsOf(offer: {
  name?: string | null;
  packageSize?: string | null;
  parsedMassKg?: number | null;
}): number | null {
  const kg = packMassKg(offer.name, offer.packageSize, offer.parsedMassKg);
  if (kg == null || kg <= 0) return null;
  return Math.round(kg * 1000);
}

export function packSizeBucketKey(offer: {
  productId: string;
  name?: string | null;
  packageSize?: string | null;
  parsedMassKg?: number | null;
}): string {
  const grams = packGramsOf(offer);
  if (grams == null) return `id:${offer.productId}`;
  return `g:${Math.round(grams / PACK_BUCKET_G) * PACK_BUCKET_G}`;
}

/** Cheapest offer per pack-size bucket. Unknown-size SKUs stay distinct. */
export function mergeDistinctPackSizes<
  T extends {
    productId: string;
    name: string;
    price: number;
    packageSize?: string;
    parsedMassKg?: number;
  },
>(offers: T[]): T[] {
  const byBucket = new Map<string, T>();
  for (const offer of offers) {
    if (!offer?.productId || !(offer.price > 0)) continue;
    const key = packSizeBucketKey(offer);
    const prev = byBucket.get(key);
    if (!prev || offer.price < prev.price - 0.005) {
      byBucket.set(key, offer);
    }
  }
  return [...byBucket.values()].slice(0, MAX_PACK_SIZES);
}

export function needsMorePackSizes(
  neededGrams: number,
  candidates: NeededWeightCandidate[],
): boolean {
  if (!(neededGrams > 0)) return false;
  if (!candidates.length) return true;
  const picked = pickNeededWeightPurchase(neededGrams, candidates);
  return !picked || !picked.inRange;
}

export function splitOfferAndAlternates<
  T extends { productId: string },
>(
  merged: T[],
  keepProductId?: string | null,
): { offer: T | null; alternates: T[] } {
  if (!merged.length) return { offer: null, alternates: [] };
  const offer =
    (keepProductId
      ? merged.find((o) => o.productId === keepProductId)
      : undefined) ?? merged[0] ?? null;
  if (!offer) return { offer: null, alternates: [] };
  return {
    offer,
    alternates: merged.filter((o) => o.productId !== offer.productId),
  };
}

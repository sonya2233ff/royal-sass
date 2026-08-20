import { parseCountPack, parseMassFromText } from "@/domain/units";
import { isEggPackStaple } from "@/domain/egg-pack";

export type OfferStatus =
  | "ok"
  | "unavailable"
  | "wrong_pack"
  | "wrong_size"
  | "stale"
  | "no_match"
  | "rejected";

export type CompareUnit = "per_pack" | "per_kg" | "per_lb" | "composed_packs";

export interface SanityInput {
  itemId: string;
  name: string;
  price: number;
  packageSize?: string;
  unitPrice?: number;
  /** Expected pack mass in kg (e.g. eggs 1kg, milk ~2L ≈ 2kg) */
  expectedPackKg?: number;
  /**
   * When set, smaller packs are OK — compare by composing N packs
   * (e.g. 2×500ml egg whites ≈ 1 kg). Do not emit wrong_size.
   */
  allowCompose?: boolean;
  /** Soft floor — reject below this for dairy jugs etc. */
  minPlausiblePrice?: number;
  /** Soft ceiling */
  maxPlausiblePrice?: number;
  checkedAt?: string;
  staleAfterHours?: number;
}

export interface SanityResult {
  ok: boolean;
  status: OfferStatus;
  reason?: string;
  inferredPackKg?: number;
  ageHours?: number;
}

const DEFAULT_STALE_HOURS = 24;

/** Egg warehouse cases: compare $/carton, not the $58 case sticker. */
export function comparableShelfPrice(input: SanityInput): number {
  if (!isEggPackStaple({ id: input.itemId }) || !(input.price > 0)) {
    return input.price;
  }
  const pack = parseCountPack(input.name, input.packageSize);
  const outer = pack && pack.outerCount > 1 ? pack.outerCount : 1;
  return input.price / outer;
}

export function offerFailsPlausibleShelfPrice(
  item: {
    id: string;
    minPlausiblePrice?: number;
    maxPlausiblePrice?: number;
  },
  offer: { name: string; price: number; packageSize?: string },
): string | null {
  const comparable = comparableShelfPrice({
    itemId: item.id,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
  });
  if (item.minPlausiblePrice != null && comparable < item.minPlausiblePrice) {
    return `price $${offer.price} < min plausible $${item.minPlausiblePrice}`;
  }
  if (item.maxPlausiblePrice != null && comparable > item.maxPlausiblePrice) {
    return `price $${offer.price} > max plausible $${item.maxPlausiblePrice}`;
  }
  return null;
}

/** Reject only mini packs. Same branded 1.36L vs expected 2.63L is still cafe-size. */
export const MIN_COMPARABLE_PACK_RATIO = 0.35;
/** 2×500g egg whites; not 10×100ml minis. */
export const MAX_COMPOSE_PACKS = 6;
export const MAX_IDENTITY_COMPOSE_PACKS = 4;

export function isComparablePackKg(
  inferredKg: number | undefined,
  expectedKg: number | undefined,
): boolean {
  if (expectedKg == null || !(expectedKg > 0)) return true;
  if (inferredKg == null || !(inferredKg > 0)) return true;
  return inferredKg >= expectedKg * MIN_COMPARABLE_PACK_RATIO;
}

export function composePackCount(packKg: number, needKg: number): number {
  if (!(packKg > 0) || !(needKg > 0)) return 0;
  return Math.max(1, Math.ceil(needKg / packKg - 1e-9));
}

/** Smaller same-product packs may cover the cafe size (2×500g ≈ 1kg). */
export function canComposeToNeed(
  packKg: number | undefined,
  needKg: number | undefined,
  maxPacks = MAX_COMPOSE_PACKS,
): boolean {
  if (needKg == null || !(needKg > 0)) return true;
  if (packKg == null || !(packKg > 0)) return true;
  if (isComparablePackKg(packKg, needKg)) return true;
  if (packKg + 1e-9 >= needKg) return false;
  const n = composePackCount(packKg, needKg);
  return n >= 2 && n <= maxPacks;
}

/** Infer pack volume/mass from unit price string math: price / (unitPer100ml) */
export function inferPackKgFromUnitPrice(
  price: number,
  unitPricePer100?: number,
  unitHint?: string,
): number | undefined {
  if (unitPricePer100 == null || unitPricePer100 <= 0 || price <= 0) {
    return undefined;
  }
  const hint = (unitHint ?? "").toLowerCase();
  // unitPrice stored as dollars per 100ml or per 100g (e.g. 0.64 = 64¢/100ml)
  if (hint.includes("ml") || !hint) {
    const ml = (price / unitPricePer100) * 100;
    if (Number.isFinite(ml) && ml > 0) return ml / 1000; // ≈ kg for milk
  }
  if (hint.includes("g") || hint.includes("kg")) {
    const g = (price / unitPricePer100) * 100;
    if (Number.isFinite(g) && g > 0) return g / 1000;
  }
  return undefined;
}

export function ageHours(checkedAt?: string): number | undefined {
  if (!checkedAt) return undefined;
  const t = Date.parse(checkedAt);
  if (!Number.isFinite(t)) return undefined;
  return (Date.now() - t) / (1000 * 60 * 60);
}

/**
 * Reject absurd shelf offers (mini packs sold as cafe staples, stale, etc.).
 */
export function sanityCheckOffer(input: SanityInput): SanityResult {
  const age = ageHours(input.checkedAt);
  const staleHours = input.staleAfterHours ?? DEFAULT_STALE_HOURS;

  if (input.price <= 0) {
    return { ok: false, status: "rejected", reason: "non-positive price", ageHours: age };
  }

  const mass =
    parseMassFromText(input.packageSize ?? "") ??
    parseMassFromText(input.name);
  let inferred = mass?.kg;
  if (inferred == null && input.unitPrice != null) {
    inferred = inferPackKgFromUnitPrice(input.price, input.unitPrice);
  }

  const composing =
    Boolean(input.allowCompose) &&
    input.expectedPackKg != null &&
    inferred != null &&
    inferred > 0 &&
    inferred + 1e-9 < input.expectedPackKg;
  const composePacks = composing
    ? composePackCount(inferred!, input.expectedPackKg!)
    : 1;
  const comparablePrice = comparableShelfPrice(input);
  const minCheckPrice =
    composing && composePacks >= 2
      ? comparablePrice * composePacks
      : comparablePrice;

  if (input.minPlausiblePrice != null && minCheckPrice < input.minPlausiblePrice) {
    return {
      ok: false,
      status: "wrong_pack",
      reason: `price $${input.price} < min plausible $${input.minPlausiblePrice}`,
      ageHours: age,
    };
  }
  if (input.maxPlausiblePrice != null && comparablePrice > input.maxPlausiblePrice) {
    return {
      ok: false,
      status: "rejected",
      reason: `price $${input.price} > max plausible $${input.maxPlausiblePrice}`,
      ageHours: age,
    };
  }

  if (input.expectedPackKg != null && inferred != null) {
    if (composing) {
      if (composePacks < 1 || composePacks > MAX_COMPOSE_PACKS) {
        return {
          ok: false,
          status: "wrong_size",
          reason: `pack ~${inferred.toFixed(2)} kg too small to compose (need ${composePacks}×)`,
          inferredPackKg: inferred,
          ageHours: age,
        };
      }
    } else if (!isComparablePackKg(inferred, input.expectedPackKg)) {
      // Mini bottles only (e.g. 200ml vs 2.63L). Tropicana 1.36L vs 2.63L
      // stays comparable — fair compare uses $/kg, not "out of stock".
      return {
        ok: false,
        status: "wrong_size",
        reason: `pack ~${inferred.toFixed(2)} kg vs expected ~${input.expectedPackKg} kg`,
        inferredPackKg: inferred,
        ageHours: age,
      };
    }
  }

  // Dairy jugs: unit-price implying <400ml when expecting multi-litre
  if (
    (input.itemId === "milk_2pct" ||
      input.itemId === "homo_milk" ||
      input.itemId === "milk_2pct_2l" ||
      input.itemId === "milk_1pct_2l" ||
      input.itemId === "homo_milk_2l") &&
    inferred != null &&
    inferred < 0.4
  ) {
    return {
      ok: false,
      status: "wrong_pack",
      reason: `inferred ~${Math.round(inferred * 1000)} ml mini — not cafe jug`,
      inferredPackKg: inferred,
      ageHours: age,
    };
  }

  if (age != null && age > staleHours) {
    return {
      ok: true,
      status: "stale",
      reason: `cache age ${age.toFixed(1)}h > ${staleHours}h`,
      inferredPackKg: inferred,
      ageHours: age,
    };
  }

  return { ok: true, status: "ok", inferredPackKg: inferred, ageHours: age };
}

export function formatAge(hours?: number): string | null {
  if (hours == null) return null;
  if (hours < 1) {
    return `${Math.max(1, Math.round(hours * 60))} \u0445\u0432 \u0442\u043e\u043c\u0443`;
  }
  if (hours < 48) {
    return `${hours.toFixed(1)} \u0433\u043e\u0434 \u0442\u043e\u043c\u0443`;
  }
  return `${(hours / 24).toFixed(1)} \u0434 \u0442\u043e\u043c\u0443`;
}

export function compareUnitLabel(unit: CompareUnit): string {
  switch (unit) {
    case "per_pack":
      return "\u0437\u0430 \u043f\u0430\u0447\u043a\u0443";
    case "per_kg":
      return "\u0437\u0430 1 kg";
    case "per_lb":
      return "\u0437\u0430 1 lb";
    case "composed_packs":
      return "\u043d\u0430\u0431\u0440\u0430\u043d\u043e \u0437 \u043c\u0435\u043d\u0448\u0438\u0445 \u043f\u0430\u0447\u043e\u043a";
  }
}

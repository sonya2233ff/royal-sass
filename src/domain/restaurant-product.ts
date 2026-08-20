/**
 * Restaurant product config: match rules and purchase rules are independent.
 */
import {
  DEFAULT_TOLERANCE_PERCENT,
  type AmountUnit,
} from "@/domain/purchase-units";
import { isEggPackStaple, typicalEggCartonCount } from "@/domain/egg-pack";

export type { AmountUnit };

export type MatchMode = "exact" | "cheapest_equivalent";
export type PurchaseStrategy = "exact_need" | "stock_up";
export type LegacyMatchMode = "preferred" | "cheapest";

export interface MatchRules {
  productType?: string;
  form?: string;
  variant?: string;
  mustIncludeAll?: string[];
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
}

export interface RestaurantProduct {
  id: string;
  label: string;
  matchMode: MatchMode;
  purchaseStrategy: PurchaseStrategy;
  defaultAmount: number;
  unit: AmountUnit;
  tolerancePercent: number;
  maximumAmount?: number;
  matchRules?: MatchRules;
  preferredProductId?: string;
  category?: string;
}

export interface StapleLike {
  id: string;
  label: string;
  matchMode?: string;
  purchaseStrategy?: string;
  defaultAmount?: number;
  unit?: string;
  tolerancePercent?: number;
  maximumAmount?: number;
  matchRules?: MatchRules;
  preferredProductId?: string;
  category?: string;
  soldByWeight?: boolean;
  typicalEachGrams?: number;
  expectedPackKg?: number;
  mustIncludeAll?: string[];
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
  rejectNameIncludes?: string[];
  queries?: string[];
}

export function canonicalizeMatchMode(raw?: string | null): MatchMode | null {
  if (raw === "exact" || raw === "cheapest_equivalent") return raw;
  if (raw === "preferred") return "exact";
  if (raw === "cheapest") return "cheapest_equivalent";
  return null;
}

export function toLegacyMatchMode(mode: MatchMode): LegacyMatchMode {
  return mode === "cheapest_equivalent" ? "cheapest" : "preferred";
}

export function inferMatchMode(item: StapleLike): MatchMode {
  const explicit = canonicalizeMatchMode(item.matchMode);
  if (explicit) return explicit;
  if (
    item.category === "produce" ||
    item.category === "frozen" ||
    item.category === "eggs"
  ) {
    return "cheapest_equivalent";
  }
  return "exact";
}

export function inferPurchaseStrategy(item: StapleLike): PurchaseStrategy {
  if (item.purchaseStrategy === "stock_up" || item.purchaseStrategy === "exact_need") {
    return item.purchaseStrategy;
  }
  return "exact_need";
}

export function inferUnit(item: StapleLike): AmountUnit {
  if (isEggPackStaple(item)) return "ea";
  const u = item.unit;
  if (u === "g" || u === "kg" || u === "ml" || u === "l" || u === "ea" || u === "pack") {
    return u;
  }
  if (item.soldByWeight) return "kg";
  const blob = `${item.id} ${item.label}`.toLowerCase();
  if (/\b(ml|l|lt|litre|liter)\b/.test(blob) || /_\d+l\b/.test(item.id)) return "l";
  if (/\b(g|gr|gram|kg)\b/.test(blob) || item.expectedPackKg) return "g";
  return "pack";
}

export function inferDefaultAmount(item: StapleLike, unit: AmountUnit): number {
  if (item.defaultAmount != null && item.defaultAmount > 0) return item.defaultAmount;
  if (isEggPackStaple(item) && unit === "ea") return typicalEggCartonCount(item);
  if (unit === "kg" && item.soldByWeight) return 1;
  if (unit === "g" && item.expectedPackKg) return Math.round(item.expectedPackKg * 1000);
  if (unit === "g" && /750/.test(item.label)) return 750;
  if (unit === "l") {
    const blob = `${item.id.replace(/_/g, " ")} ${item.label}`;
    const labeled = blob.match(/(\d+(?:\.\d+)?)\s*l\b/i);
    if (labeled) return Number(labeled[1]);
  }
  return 1;
}

function mergeKeywords(
  ...lists: Array<readonly string[] | undefined>
): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const t = raw.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out.length ? out : undefined;
}

export function toRestaurantProduct(item: StapleLike): RestaurantProduct {
  const matchMode = inferMatchMode(item);
  const unit = inferUnit(item);
  const defaultAmount = inferDefaultAmount(item, unit);
  const tolerance =
    item.tolerancePercent != null && item.tolerancePercent >= 0
      ? item.tolerancePercent
      : DEFAULT_TOLERANCE_PERCENT;
  const matchRules: MatchRules = {
    ...(item.matchRules ?? {}),
    mustIncludeAll: mergeKeywords(
      item.matchRules?.mustIncludeAll,
      item.mustIncludeAll,
    ),
    mustIncludeAny: mergeKeywords(
      item.matchRules?.mustIncludeAny,
      item.mustIncludeAny,
    ),
    mustNotInclude: mergeKeywords(
      item.matchRules?.mustNotInclude,
      item.mustNotInclude,
      item.rejectNameIncludes,
    ),
  };
  const product: RestaurantProduct = {
    id: item.id,
    label: item.label,
    matchMode,
    purchaseStrategy: inferPurchaseStrategy(item),
    defaultAmount,
    unit,
    tolerancePercent: tolerance,
    matchRules,
    preferredProductId: item.preferredProductId,
    category: item.category,
  };
  if (item.maximumAmount != null && item.maximumAmount > 0) {
    product.maximumAmount = item.maximumAmount;
  }
  return product;
}

export type ProductOverride = Partial<
  Pick<
    RestaurantProduct,
    | "matchMode"
    | "purchaseStrategy"
    | "defaultAmount"
    | "unit"
    | "tolerancePercent"
    | "maximumAmount"
    | "matchRules"
    | "preferredProductId"
  >
> & {
  confirmedStoreProducts?: Record<string, string>;
  /** Client flag: old store mappings must not lock Compare until reconfirmed. */
  needsReview?: boolean;
  maximumAmount?: number | null;
};

function eggOverrideAmount(
  base: RestaurantProduct,
  override: ProductOverride,
): number {
  const raw =
    override.defaultAmount != null && override.defaultAmount > 0
      ? override.defaultAmount
      : base.defaultAmount;
  if (isEggPackStaple(base) && override.unit === "pack" && raw <= 10) {
    return raw * typicalEggCartonCount(base);
  }
  return raw;
}

export function applyProductOverride(
  base: RestaurantProduct,
  override?: ProductOverride | null,
): RestaurantProduct {
  if (!override) return base;
  const {
    confirmedStoreProducts: _confirmed,
    needsReview: _review,
    maximumAmount: overrideMax,
    ...rest
  } = override;
  const matchRules = {
    ...(base.matchRules ?? {}),
    ...(override.matchRules ?? {}),
    mustIncludeAny: mergeKeywords(
      base.matchRules?.mustIncludeAny,
      override.matchRules?.mustIncludeAny,
    ),
    mustIncludeAll: mergeKeywords(
      base.matchRules?.mustIncludeAll,
      override.matchRules?.mustIncludeAll,
    ),
    mustNotInclude: mergeKeywords(
      base.matchRules?.mustNotInclude,
      override.matchRules?.mustNotInclude,
    ),
  };
  const next: RestaurantProduct = {
    ...base,
    ...rest,
    matchRules,
    matchMode: canonicalizeMatchMode(override.matchMode) ?? base.matchMode,
    purchaseStrategy:
      override.purchaseStrategy === "stock_up" ||
      override.purchaseStrategy === "exact_need"
        ? override.purchaseStrategy
        : base.purchaseStrategy,
    unit: isEggPackStaple(base)
      ? "ea"
      : ((override.unit as AmountUnit) ?? base.unit),
    defaultAmount: eggOverrideAmount(base, override),
    tolerancePercent:
      override.tolerancePercent != null && override.tolerancePercent >= 0
        ? override.tolerancePercent
        : base.tolerancePercent,
  };
  if (overrideMax === null) {
    delete next.maximumAmount;
  } else if (overrideMax != null && overrideMax > 0) {
    next.maximumAmount = overrideMax;
  }
  return next;
}

/** Apply in-app settings onto a catalog staple before a live rematch. */
export function stapleWithClientOverride<T extends StapleLike>(
  item: T,
  override?: ProductOverride | null,
): T {
  if (!override) return item;
  const next: T = { ...item };
  const mode = canonicalizeMatchMode(override.matchMode);
  if (mode) next.matchMode = mode;
  if (override.purchaseStrategy) next.purchaseStrategy = override.purchaseStrategy;
  const rules = override.matchRules;
  if (rules) {
    next.matchRules = { ...(item.matchRules ?? {}), ...rules };
    next.mustIncludeAny = mergeKeywords(
      item.mustIncludeAny,
      item.matchRules?.mustIncludeAny,
      rules.mustIncludeAny,
    );
    next.mustIncludeAll = mergeKeywords(
      item.mustIncludeAll,
      item.matchRules?.mustIncludeAll,
      rules.mustIncludeAll,
    );
    next.mustNotInclude = mergeKeywords(
      item.mustNotInclude,
      item.matchRules?.mustNotInclude,
      rules.mustNotInclude,
    );
    if (next.matchRules) {
      next.matchRules.mustIncludeAny = next.mustIncludeAny;
      next.matchRules.mustIncludeAll = next.mustIncludeAll;
      next.matchRules.mustNotInclude = next.mustNotInclude;
    }
    const typeQ = rules.productType?.trim();
    const liveMode =
      mode ?? canonicalizeMatchMode(item.matchMode) ?? inferMatchMode(item);
    // Exact branded search must keep "tropicana … 2.63" first, not generic
    // "orange juice" from productType (that pool never contains the jug).
    if (typeQ && liveMode === "cheapest_equivalent") {
      const queries = Array.isArray((next as { queries?: string[] }).queries)
        ? [...((next as { queries?: string[] }).queries ?? [])]
        : [];
      if (!queries.some((q) => q.toLowerCase() === typeQ.toLowerCase())) {
        (next as { queries?: string[] }).queries = [typeQ, ...queries];
      }
    }
  }
  const wm = override.confirmedStoreProducts?.walmart_ca;
  if (wm) next.preferredProductId = wm;
  else if (override.preferredProductId) {
    next.preferredProductId = override.preferredProductId;
  }
  return next;
}

const CONFIRMED_SKU_ALIASES: Record<string, string[]> = {
  walmart_ca: ["walmart_ca"],
  no_frills: ["no_frills", "nofrills"],
  wholesale_club: ["wholesale_club", "wholesaleclub"],
  mvr: ["mvr"],
};

/** In-app «Підтвердити» SKU for a compare column. */
export function confirmedStoreSku(
  override: ProductOverride | null | undefined,
  retailer: keyof typeof CONFIRMED_SKU_ALIASES | string,
): string | undefined {
  const map = override?.confirmedStoreProducts;
  if (!map) return undefined;
  const keys = CONFIRMED_SKU_ALIASES[retailer] ?? [retailer];
  for (const key of keys) {
    const v = map[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function clearCart(): Cart {
  return {};
}

export function cartSize(cart: Cart): number {
  return Object.keys(cart).length;
}

/** Search filter helper — never mutates cart. */
export function filterVisibleIds(
  items: Array<{ id: string; label: string }>,
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((item) => !q || item.label.toLowerCase().includes(q))
    .map((item) => item.id);
}

export type CartItem = {
  requestedAmount: number;
  unit: AmountUnit;
  isCustom: boolean;
};

export type Cart = Record<string, CartItem>;

export function addCartItem(cart: Cart, id: string, product: RestaurantProduct): Cart {
  if (cart[id]) return cart;
  return {
    ...cart,
    [id]: {
      requestedAmount: product.defaultAmount,
      unit: product.unit,
      isCustom: false,
    },
  };
}

export function removeCartItem(cart: Cart, id: string): Cart {
  if (!cart[id]) return cart;
  const next = { ...cart };
  delete next[id];
  return next;
}

export function setCartCustomAmount(
  cart: Cart,
  id: string,
  amount: number,
  unit: AmountUnit,
): Cart {
  if (!(amount > 0) || !cart[id]) return cart;
  return {
    ...cart,
    [id]: { requestedAmount: amount, unit, isCustom: true },
  };
}

export function effectiveRequestedAmount(
  cartItem: CartItem | undefined,
  product: RestaurantProduct,
): number {
  return cartItem?.requestedAmount ?? product.defaultAmount;
}

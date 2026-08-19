/**
 * Restaurant product config: match rules and purchase rules are independent.
 */
import {
  DEFAULT_TOLERANCE_PERCENT,
  type AmountUnit,
} from "@/domain/purchase-units";

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
  if (unit === "kg" && item.soldByWeight) return 1;
  if (unit === "g" && item.expectedPackKg) return Math.round(item.expectedPackKg * 1000);
  if (unit === "g" && /750/.test(item.label)) return 750;
  return 1;
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
    mustIncludeAll: item.matchRules?.mustIncludeAll ?? item.mustIncludeAll,
    mustIncludeAny: item.matchRules?.mustIncludeAny ?? item.mustIncludeAny,
    mustNotInclude: [
      ...(item.matchRules?.mustNotInclude ?? item.mustNotInclude ?? []),
      ...(item.rejectNameIncludes ?? []),
    ].filter(Boolean),
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
    unit: (override.unit as AmountUnit) ?? base.unit,
    defaultAmount:
      override.defaultAmount != null && override.defaultAmount > 0
        ? override.defaultAmount
        : base.defaultAmount,
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

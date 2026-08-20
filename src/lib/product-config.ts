/**
 * Client-first product config overrides (Vercel has a read-only FS).
 * Compare receives the merged config in the request body.
 */
import {
  applyProductOverride,
  toRestaurantProduct,
  type ProductOverride,
  type RestaurantProduct,
  type StapleLike,
} from "@/domain/restaurant-product";

export const PRODUCT_OVERRIDE_STORAGE_KEY = "royal-sass-product-overrides-v1";
export const CART_STORAGE_KEY = "royal-sass-cart-v1";
/** Waiter portal draft list (local only — not sent to a driver). */
export const WAITER_LIST_STORAGE_KEY = "royal-sass-waiter-list-v1";
/** Hidden cafe cards. Live store on Vercel (read-only FS); disk copy is best-effort. */
export const REMOVED_STAPLES_STORAGE_KEY = "royal-sass-removed-staples-v1";

export function parseRemovedStapleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

export function readRemovedStapleIds(): string[] {
  try {
    const raw = window.localStorage.getItem(REMOVED_STAPLES_STORAGE_KEY);
    if (!raw) return [];
    return parseRemovedStapleIds(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeRemovedStapleIds(ids: Iterable<string>): string[] {
  const next = parseRemovedStapleIds([...ids]);
  try {
    window.localStorage.setItem(REMOVED_STAPLES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function effectiveProduct(
  item: StapleLike,
  override?: ProductOverride | null,
): RestaurantProduct {
  return applyProductOverride(toRestaurantProduct(item), override);
}

export function parseOverrideMap(raw: unknown): Record<string, ProductOverride> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ProductOverride> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object") continue;
    out[id] = value as ProductOverride;
  }
  return out;
}

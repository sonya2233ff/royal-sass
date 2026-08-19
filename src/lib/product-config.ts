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

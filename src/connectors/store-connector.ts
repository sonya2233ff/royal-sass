/**
 * Target connector contract for future store adapters.
 *
 * This file is additive. Production still uses RetailerConnector / ProductOffer
 * in ./types.ts. Do not wire StoreConnector into getConnector() until a
 * store-specific adapter is implemented behind a feature flag.
 */

export type AvailabilityStatus =
  | "in_stock"
  | "low_stock"
  | "out_of_stock"
  | "unknown";

export type FulfillmentType =
  | "in_store"
  | "pickup"
  | "delivery"
  | "shipping"
  | "unknown";

export type PricingPolicy =
  | "same_as_in_store"
  | "possible_markup"
  | "online_only"
  | "loyalty"
  | "promotional"
  | "estimated"
  | "unknown";

export type PriceKind =
  | "shelf"
  | "online"
  | "delivery"
  | "marketplace_seller"
  | "loyalty"
  | "promotional"
  | "estimated";

export interface StoreLocation {
  retailer: string;
  banner?: string;
  storeId: string;
  storeName?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface StoreProduct {
  retailer: string;
  banner?: string;
  storeId: string;
  retailerProductId: string;
  productName: string;
  brand?: string;
  upc?: string;
  packageQuantity?: number;
  packageUnit?: string;
  sourceUrl?: string;
}

export interface StorePrice {
  internalProductId?: string;
  retailer: string;
  banner: string;
  storeId: string;
  storeName?: string;
  retailerProductId: string;
  upc?: string;
  productName: string;
  brand?: string;
  packageQuantity?: number;
  packageUnit?: string;
  price: number;
  regularPrice?: number;
  salePrice?: number;
  unitPrice?: number;
  unitPriceUnit?: string;
  promotionText?: string;
  availability: AvailabilityStatus;
  fulfillmentType: FulfillmentType;
  seller?: string;
  source: string;
  sourceUrl?: string;
  pricingPolicy?: PricingPolicy;
  priceKind?: PriceKind;
  confidence: "high" | "medium" | "low";
  checkedAt: string;
}

export interface StoreConnector {
  searchProducts(
    query: string,
    location: StoreLocation,
  ): Promise<StoreProduct[]>;
  getProduct(
    productId: string,
    location: StoreLocation,
  ): Promise<StoreProduct | null>;
  getPrices(
    productIds: string[],
    location: StoreLocation,
  ): Promise<StorePrice[]>;
  checkAvailability(
    productId: string,
    location: StoreLocation,
  ): Promise<AvailabilityStatus>;
}

/** Parse MVR Plus Shopify tags such as INSTOREPRICE:16.59 and MARKUP:1.1 */
export function parseMvrShopifyTags(tags: string[] | string | undefined): {
  inStorePrice?: number;
  markup?: number;
  lastUpdated?: string;
  shelfLocation?: string;
} {
  const list = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(",").map((t) => t.trim())
      : [];
  const out: {
    inStorePrice?: number;
    markup?: number;
    lastUpdated?: string;
    shelfLocation?: string;
  } = {};
  for (const tag of list) {
    const [key, ...rest] = tag.split(":");
    const value = rest.join(":");
    if (key === "INSTOREPRICE") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) out.inStorePrice = n;
    } else if (key === "MARKUP") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) out.markup = n;
    } else if (key === "LASTUPDATED") {
      out.lastUpdated = value;
    } else if (key === "SHELFLOCATION") {
      out.shelfLocation = value;
    }
  }
  return out;
}

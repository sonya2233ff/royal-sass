export type Confidence = "exact" | "estimated" | "stale";
export type Availability = "in_stock" | "out_of_stock" | "unknown";

export interface StoreRef {
  retailer: string;
  storeId: string;
}

export interface ProductOffer {
  retailer: string;
  storeId: string;
  productId: string;
  name: string;
  brand?: string;
  packageSize?: string;
  upc?: string;
  /** Current shelf / offer price in CAD */
  price: number;
  unitPrice?: number;
  promoPrice?: number;
  /** Regular / list price when the current shelf price is a sale. */
  wasPrice?: number;
  /** True when the retailer marks a rollback, sale, or deal. */
  onSale?: boolean;
  availability: Availability;
  confidence: Confidence;
  /** ISO timestamp when this price was retrieved */
  checkedAt: string;
  sourceUrl?: string;
  /** Debug payload; prefer persisting via raw_retailer_responses */
  raw?: unknown;
}

export interface RetailerConnector {
  readonly id: string;
  searchProducts(query: string, storeId: string): Promise<ProductOffer[]>;
  getProduct(productId: string, storeId: string): Promise<ProductOffer | null>;
  getPrice(productId: string, storeId: string): Promise<ProductOffer | null>;
  getAvailability(productId: string, storeId: string): Promise<Availability>;
}

/** Keep a was-price only when it is actually higher than the shelf price. */
export function pickWasPrice(
  price: number,
  ...candidates: Array<number | undefined | null>
): number | undefined {
  for (const c of candidates) {
    if (c != null && Number.isFinite(c) && c > price + 0.005) {
      return Math.round(c * 100) / 100;
    }
  }
  return undefined;
}

export function offerIsOnSale(offer: {
  price: number;
  wasPrice?: number;
  onSale?: boolean;
} | null | undefined): boolean {
  if (!offer) return false;
  if (offer.onSale) return true;
  return offer.wasPrice != null && offer.wasPrice > offer.price + 0.005;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly retailer: string,
    public readonly code:
      | "blocked"
      | "http"
      | "parse"
      | "no_store_context"
      | "not_found"
      | "unsupported",
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

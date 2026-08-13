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

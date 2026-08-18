import {
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";
import {
  pcxGetProduct,
  pcxProductIdsMatch,
  pcxSearchOrThrow,
  probePcxSearch,
} from "./pcx-bff";

/** PCX / locator id for Wholesale Club Richmond Hill, 10909 Yonge St, L4C 3E3. */
export const WHOLESALECLUB_STORE_ID = "3724";
export const WHOLESALECLUB_STORE_KEY = "wholesaleclub_3724";
export const WHOLESALECLUB_BANNER = "wholesaleclub" as const;
export const WHOLESALECLUB_ORIGIN = "https://www.wholesaleclub.ca";
export const WHOLESALECLUB_CONNECTOR_ID = "wholesale_club" as const;

const ORIGINS = [WHOLESALECLUB_ORIGIN];

export class WholesaleClubConnector implements RetailerConnector {
  readonly id = WHOLESALECLUB_CONNECTOR_ID;

  async searchProducts(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    return pcxSearchOrThrow({
      query,
      storeId,
      banner: WHOLESALECLUB_BANNER,
      retailer: WHOLESALECLUB_CONNECTOR_ID,
      origins: ORIGINS,
      label: "Wholesale Club",
    });
  }

  async getProduct(
    productId: string,
    storeId: string,
  ): Promise<ProductOffer | null> {
    return pcxGetProduct({
      productId,
      storeId,
      banner: WHOLESALECLUB_BANNER,
      retailer: WHOLESALECLUB_CONNECTOR_ID,
      origins: ORIGINS,
      label: "Wholesale Club",
    });
  }

  async getPrice(
    productId: string,
    storeId: string,
  ): Promise<ProductOffer | null> {
    return this.getProduct(productId, storeId);
  }

  async getAvailability(
    productId: string,
    storeId: string,
  ): Promise<Availability> {
    const offer = await this.getProduct(productId, storeId);
    return offer?.availability ?? "unknown";
  }
}

export async function probeWholesaleClubSearch(opts: {
  query: string;
  storeId?: string;
  includeRaw?: boolean;
  rawLimit?: number;
}) {
  return probePcxSearch({
    query: opts.query,
    storeId: String(opts.storeId ?? WHOLESALECLUB_STORE_ID),
    banner: WHOLESALECLUB_BANNER,
    retailer: WHOLESALECLUB_CONNECTOR_ID,
    origins: ORIGINS,
    includeRaw: opts.includeRaw,
    rawLimit: opts.rawLimit,
  });
}

export function wholesaleClubProductIdsMatch(a: string, b: string): boolean {
  return pcxProductIdsMatch(a, b);
}

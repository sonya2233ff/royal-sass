import {
  ConnectorError,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";

/**
 * Sobeys connector (POC) — Clark & Hilda focus.
 *
 * Confirmed:
 * - Flyer host lists Clark & Hilda with merchant_store_code "659"
 *   (441 Clark Avenue West, Thornhill / postal L4J6W7)
 * - Flipp item search returns flyer prices for merchant "Sobeys" by postal code
 *
 * NOT confirmed:
 * - A store-scoped full shelf catalog API equivalent to Loblaw PCX BFF
 * - That Flipp prices equal shelf prices at store 659
 *
 * Therefore all Flipp-backed offers use confidence: "estimated".
 */
const FLIPP_SEARCH = "https://backflipp.wishabi.com/flipp/items/search";

/** Confirmed Flipp/flyer merchant_store_code for Sobeys Clark & Hilda */
export const SOBEYS_CLARK_HILDA_STORE_CODE = "659";

function parsePrice(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function mapFlippItem(
  item: Record<string, unknown>,
  storeId: string,
): ProductOffer | null {
  const name = String(item.name ?? item.display_name ?? "");
  if (!name) return null;
  const price =
    parsePrice(item.current_price) ??
    parsePrice(item.price) ??
    parsePrice(item.sale_story);
  if (price == null) return null;

  return {
    retailer: "sobeys",
    storeId,
    productId: String(item.id ?? item.flyer_item_id ?? `${name}-${price}`),
    name,
    brand: typeof item.brand === "string" ? item.brand : undefined,
    packageSize:
      typeof item.description === "string" ? item.description : undefined,
    price,
    availability: "unknown",
    confidence: "estimated",
    checkedAt: new Date().toISOString(),
    sourceUrl:
      typeof item.web_url === "string"
        ? item.web_url
        : "https://www.sobeys.com/en/stores/sobeys-clark-hilda",
    raw: {
      ...item,
      _pocNote:
        "Flipp/flyer price for Sobeys regional flyer — NOT confirmed shelf price at Clark & Hilda",
      _merchantStoreCode: storeId,
    },
  };
}

export class SobeysConnector implements RetailerConnector {
  readonly id = "sobeys";

  constructor(private readonly postalCode: string = "L4J6W7") {}

  async searchProducts(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    if (!storeId) {
      throw new ConnectorError(
        "Sobeys requires a storeId (merchant_store_code). Clark & Hilda = 659.",
        this.id,
        "no_store_context",
      );
    }

    // Refuse silently swapping to another store — caller must pass the intended ID.
    const postal = this.postalCode.replace(/\s+/g, "");
    const url = new URL(FLIPP_SEARCH);
    url.searchParams.set("locale", "en-ca");
    url.searchParams.set("postal_code", postal);
    url.searchParams.set("q", `Sobeys ${query}`);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; RoyalSassPOC/0.1; +local-dev)",
      },
    });

    if (!res.ok) {
      throw new ConnectorError(
        `Sobeys/Flipp search HTTP ${res.status}`,
        this.id,
        "http",
      );
    }

    const body = await res.json();
    const items = Array.isArray((body as { items?: unknown }).items)
      ? ((body as { items: Record<string, unknown>[] }).items)
      : [];

    return items
      .map((item) => mapFlippItem(item, storeId))
      .filter((o): o is ProductOffer => o != null);
  }

  async getProduct(
    productId: string,
    storeId: string,
  ): Promise<ProductOffer | null> {
    const hits = await this.searchProducts(productId, storeId);
    return hits.find((h) => h.productId === productId) ?? hits[0] ?? null;
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

export async function discoverSobeysClarkHilda(): Promise<{
  merchantStoreCode: string;
  postalCode: string;
  notes: string[];
}> {
  const notes: string[] = [
    "Confirmed from flyers.sobeys.com nearest_stores JSON: Sobeys Clark and Hilda → merchant_store_code 659",
    "Address match: 441 Clark Avenue West, Thornhill, ON",
    "No Loblaw-style store-scoped shelf catalog API confirmed for Sobeys",
    "Voila is Empire online grocery and is NOT assumed equal to Clark & Hilda shelf prices",
    "Flipp/backflipp search by postal L4J6W7 returns flyer items only (estimated)",
  ];
  return {
    merchantStoreCode: SOBEYS_CLARK_HILDA_STORE_CODE,
    postalCode: "L4J6W7",
    notes,
  };
}

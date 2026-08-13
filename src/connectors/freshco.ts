import {
  ConnectorError,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";

/**
 * FreshCo connector (POC).
 *
 * Confirmed: FreshCo.com is primarily store locator + weekly flyer (Flipp).
 * Unproven: a PC-Express-like store-scoped full shelf catalog API.
 *
 * Interim path: Flipp flyer search by postal code + merchant "FreshCo".
 * All Flipp-backed prices are confidence: "estimated" (promo/flyer, not shelf).
 */
const FLIPP_SEARCH =
  "https://backflipp.wishabi.com/flipp/items/search";

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

  const productId = String(item.id ?? item.item_id ?? `${name}-${price}`);

  return {
    retailer: "freshco",
    storeId,
    productId,
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
        : `https://www.freshco.com/`,
    raw: item,
  };
}

export class FreshCoConnector implements RetailerConnector {
  readonly id = "freshco";

  /** Optional postal code for Flipp regional flyers */
  constructor(private readonly postalCode: string = "M1P2L8") {}

  async searchProducts(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    if (!storeId) {
      throw new ConnectorError(
        "FreshCo requires a storeId / store_code context",
        this.id,
        "no_store_context",
      );
    }

    const postal = this.postalCode.replace(/\s+/g, "");
    const url = new URL(FLIPP_SEARCH);
    url.searchParams.set("locale", "en-ca");
    url.searchParams.set("postal_code", postal);
    url.searchParams.set("q", `FreshCo ${query}`);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; RoyalSassPOC/0.1; +local-dev)",
      },
    });

    if (!res.ok) {
      throw new ConnectorError(
        `FreshCo/Flipp search HTTP ${res.status}`,
        this.id,
        "http",
      );
    }

    const body = await res.json();
    const items = Array.isArray((body as { items?: unknown }).items)
      ? ((body as { items: Record<string, unknown>[] }).items)
      : [];

    const offers = items
      .map((item) => mapFlippItem(item, storeId))
      .filter((o): o is ProductOffer => o != null);

    // Tag that these are flyer estimates tied to postal region, not proven shelf SKUs
    return offers.map((o) => ({
      ...o,
      confidence: "estimated" as const,
      raw: {
        ...(typeof o.raw === "object" && o.raw ? o.raw : {}),
        _pocNote:
          "Flipp flyer price — not confirmed FreshCo shelf price for this storeId",
        _postalCode: postal,
        _requestedStoreId: storeId,
      },
    }));
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

/** Discovery helper: probe whether freshco.com exposes JSON product APIs. */
export async function discoverFreshCoEndpoints(postalCode: string): Promise<{
  storeLocatorOk: boolean;
  flippOk: boolean;
  notes: string[];
}> {
  const notes: string[] = [];
  let storeLocatorOk = false;
  let flippOk = false;

  try {
    const res = await fetch("https://www.freshco.com/store-locator", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RoyalSassPOC/0.1; +local-dev)",
      },
    });
    storeLocatorOk = res.ok;
    notes.push(
      `freshco.com/store-locator → HTTP ${res.status}. Expect HTML/locator UI, not a full product catalog.`,
    );
  } catch (e) {
    notes.push(`store-locator fetch failed: ${String(e)}`);
  }

  try {
    const url = new URL(FLIPP_SEARCH);
    url.searchParams.set("locale", "en-ca");
    url.searchParams.set("postal_code", postalCode.replace(/\s+/g, ""));
    url.searchParams.set("q", "FreshCo milk");
    const res = await fetch(url.toString());
    flippOk = res.ok;
    if (res.ok) {
      const body = await res.json();
      const count = Array.isArray((body as { items?: unknown[] }).items)
        ? (body as { items: unknown[] }).items.length
        : 0;
      notes.push(
        `Flipp FreshCo milk search → HTTP ${res.status}, ${count} items (estimated flyer prices).`,
      );
    } else {
      notes.push(`Flipp FreshCo search → HTTP ${res.status}`);
    }
  } catch (e) {
    notes.push(`Flipp probe failed: ${String(e)}`);
  }

  notes.push(
    "ASSUMPTION UNPROVEN: FreshCo store-scoped shelf catalog API equivalent to Loblaw PC Express.",
  );
  notes.push(
    "Voila (voila.ca) is Sobeys online grocery and is NOT confirmed as FreshCo in-store pricing.",
  );

  return { storeLocatorOk, flippOk, notes };
}

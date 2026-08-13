import {
  ConnectorError,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";

const BANNER = "nofrills";
/** Current Loblaw PCX BFF search (replaces older product-facade path for many banners). */
const SEARCH_URL =
  process.env.NOFRILLS_SEARCH_URL ??
  "https://api.pcexpress.ca/pcx-bff/api/v2/products/search";
/** Key used by Loblaw web properties; override via env if rotated. */
const API_KEY =
  process.env.NOFRILLS_API_KEY ?? "C1xujSegT5j3ap3yexJjqhOfELwGKYvz";

function todayDdmmyyyy(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      parseMoney(obj.price) ??
      parseMoney(obj.amount) ??
      parseMoney(obj.value) ??
      parseMoney(obj.displayPrice)
    );
  }
  return undefined;
}

function mapAvailability(raw: unknown): Availability {
  if (raw === true || raw === "OK" || raw === "IN_STOCK") return "in_stock";
  if (raw === false || raw === "OUT" || raw === "OUT_OF_STOCK")
    return "out_of_stock";
  return "unknown";
}

function walkProducts(node: unknown, out: Record<string, unknown>[] = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) walkProducts(item, out);
    return out;
  }
  if (typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;

  // PCX BFF product grid tiles
  if (Array.isArray(obj.productTiles)) {
    for (const tile of obj.productTiles) {
      if (tile && typeof tile === "object") {
        out.push(tile as Record<string, unknown>);
      }
    }
  }

  const hasPricing =
    obj.pricing != null || obj.prices != null || obj.price != null;
  const hasId =
    obj.productId != null || obj.offerId != null || obj.articleNumber != null;
  if (hasPricing && hasId && (obj.title || obj.name)) {
    out.push(obj);
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") walkProducts(value, out);
  }
  return out;
}

function mapProduct(
  raw: Record<string, unknown>,
  storeId: string,
): ProductOffer | null {
  const productId = String(
    raw.productId ?? raw.articleNumber ?? raw.code ?? raw.productCode ?? "",
  );
  if (!productId) return null;

  const name = String(raw.title ?? raw.name ?? "Unknown product");
  const brand =
    typeof raw.brand === "string"
      ? raw.brand
      : typeof (raw.brand as { name?: string } | undefined)?.name === "string"
        ? (raw.brand as { name: string }).name
        : undefined;

  const packageSize =
    typeof raw.packageSizing === "string"
      ? raw.packageSizing
      : typeof raw.packageSize === "string"
        ? raw.packageSize
        : typeof raw.size === "string"
          ? raw.size
          : undefined;

  const pricing = (raw.pricing ?? raw.prices ?? raw.price ?? {}) as Record<
    string,
    unknown
  >;
  const pricingUnits = (raw.pricingUnits ?? {}) as Record<string, unknown>;

  const price =
    parseMoney(pricing.price) ??
    parseMoney(pricing.displayPrice) ??
    parseMoney(pricing.regularPrice) ??
    parseMoney(pricing.originalPrice) ??
    parseMoney(pricingUnits.price) ??
    (typeof raw.price === "number" ? raw.price : undefined);
  if (price == null) return null;

  const promoPrice =
    parseMoney(pricing.salePrice) ??
    parseMoney(pricing.wasPrice) ??
    parseMoney(pricing.memberPrice);

  const unitPrice = parseMoney(pricing.unitPrice);

  const stockStatus = raw.inventoryIndicator ?? raw.stockStatus ?? raw.isAvailable;

  return {
    retailer: "no_frills",
    storeId,
    productId,
    name,
    brand,
    packageSize,
    upc: typeof raw.upc === "string" ? raw.upc : undefined,
    price,
    unitPrice,
    promoPrice:
      promoPrice != null && promoPrice !== price ? promoPrice : undefined,
    availability: mapAvailability(stockStatus),
    confidence: "exact",
    checkedAt: new Date().toISOString(),
    sourceUrl: `https://www.nofrills.ca/product/${String(raw.articleNumber ?? productId).replace(/_EA$/, "")}`,
    raw,
  };
}

function buildHeaders(originHost: string): Record<string, string> {
  return {
    Accept: "*/*",
    "Content-Type": "application/json",
    "Accept-Language": "en",
    "X-Apikey": API_KEY,
    "X-Application-Type": "Web",
    "X-Channel": "web",
    "X-Loblaw-Tenant-Id": "ONLINE_GROCERIES",
    "Business-User-Agent": "PCXWEB",
    "Is-Helios-Account": "false",
    "Is-Iceberg-Enabled": "true",
    "X-Preview": "false",
    Origin_session_header: "B",
    "Site-Banner": BANNER,
    Origin: originHost,
    Referer: `${originHost}/`,
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
}

export class NoFrillsConnector implements RetailerConnector {
  readonly id = "no_frills";

  async searchProducts(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    if (!storeId) {
      throw new ConnectorError(
        "No Frills requires a storeId for store-specific pricing",
        this.id,
        "no_store_context",
      );
    }

    const payload = {
      cart: { cartId: crypto.randomUUID() },
      fulfillmentInfo: {
        storeId: String(storeId),
        pickupType: "STORE",
        offerType: "OG",
        date: todayDdmmyyyy(),
        timeSlot: null,
      },
      listingInfo: {
        filters: { "search-bar": [query] },
        sort: {},
        pagination: { from: 1 },
        includeFiltersInResponse: false,
      },
      banner: BANNER,
      userData: {
        domainUserId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
      },
      device: { screenSize: 1358 },
      searchRelatedInfo: {
        term: query,
        options: [{ name: "rmp.unifiedSearchVariant", value: "Y" }],
      },
    };

    const origins = [
      "https://www.nofrills.ca",
      "https://www.realcanadiansuperstore.ca",
    ];

    let lastStatus = 0;
    let lastBody = "";

    for (const origin of origins) {
      const res = await fetch(SEARCH_URL, {
        method: "POST",
        headers: buildHeaders(origin),
        body: JSON.stringify(payload),
      });
      lastStatus = res.status;
      lastBody = await res.text();

      if (res.status === 403 || res.status === 401) {
        continue;
      }
      if (!res.ok) {
        throw new ConnectorError(
          `No Frills search HTTP ${res.status}: ${lastBody.slice(0, 180)}`,
          this.id,
          "http",
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(lastBody);
      } catch {
        throw new ConnectorError(
          "No Frills returned non-JSON body",
          this.id,
          "parse",
        );
      }

      const offers = walkProducts(json)
        .map((r) => mapProduct(r, storeId))
        .filter((o): o is ProductOffer => o != null);

      // Deduplicate by productId
      const seen = new Set<string>();
      const unique = offers.filter((o) => {
        if (seen.has(o.productId)) return false;
        seen.add(o.productId);
        return true;
      });

      return unique;
    }

    if (process.env.NOFRILLS_ALLOW_FLIPP_FALLBACK === "1") {
      return this.searchViaFlipp(query, storeId);
    }

    throw new ConnectorError(
      `No Frills blocked or unauthorized (HTTP ${lastStatus}). Akamai edge may be filtering this IP — set NOFRILLS_API_KEY from a browser session, or NOFRILLS_ALLOW_FLIPP_FALLBACK=1 for estimated flyer prices. Body: ${lastBody.slice(0, 120)}`,
      this.id,
      "blocked",
    );
  }

  /** Flyer-only estimated fallback — not shelf prices. */
  private async searchViaFlipp(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    const postal = (process.env.NOFRILLS_POSTAL_CODE ?? "M1P2L8").replace(
      /\s+/g,
      "",
    );
    const url = new URL(
      "https://backflipp.wishabi.com/flipp/items/search",
    );
    url.searchParams.set("locale", "en-ca");
    url.searchParams.set("postal_code", postal);
    url.searchParams.set("q", `No Frills AND ${query}`);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; RoyalSassPOC/0.1; +local-dev)",
      },
    });
    if (!res.ok) {
      throw new ConnectorError(
        `No Frills Flipp fallback HTTP ${res.status}`,
        this.id,
        "http",
      );
    }
    const body = await res.json();
    const items = Array.isArray((body as { items?: unknown }).items)
      ? ((body as { items: Record<string, unknown>[] }).items)
      : [];

    return items
      .map((item) => {
        const name = String(item.name ?? "");
        const price =
          typeof item.current_price === "number"
            ? item.current_price
            : typeof item.price === "number"
              ? item.price
              : Number.parseFloat(String(item.current_price ?? "").replace(/[^0-9.]/g, ""));
        if (!name || !Number.isFinite(price)) return null;
        const offer: ProductOffer = {
          retailer: "no_frills",
          storeId,
          productId: String(item.id ?? `${name}-${price}`),
          name,
          price,
          availability: "unknown",
          confidence: "estimated",
          checkedAt: new Date().toISOString(),
          sourceUrl: "https://www.nofrills.ca/flyer",
          raw: { ...item, _pocNote: "Flipp flyer fallback — not shelf price" },
        };
        return offer;
      })
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

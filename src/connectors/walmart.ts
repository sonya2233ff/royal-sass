import {
  ConnectorError,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";
import {
  isWalmartBrowserEnabled,
  searchProductsInBrowser,
} from "./walmart-browser";
import {
  parseWalmartSearchNextData,
  resolveWalmartStorePage,
  type WalmartStoreNode,
} from "./walmart-store";

/**
 * Walmart Canada connector (POC) — store #5831 focus.
 *
 * How Walmart binds price to a location:
 * 1. Map/store page resolves physical node (e.g. /en/store/5831).
 * 2. Browser sets cookies: deliveryCatchment, defaultNearestStoreId, assortmentStoreId = storeId.
 * 3. Search / PDP APIs return priceInfo for THAT node.
 * 4. Same usItemId can have different priceInfo at different storeIds.
 *
 * Working without PX: GET /en/store/{storeId} (metadata only).
 * Shelf prices: Playwright persistent profile (npm run walmart:warm), optional WALMART_BROWSER_COOKIE fast path.
 */
const PRESO_HASH =
  process.env.WALMART_GET_PRESO_HASH ??
  "557b40dad92e91e7d4c2a2a1f98162945db8b9a33b2f66fd7d9feafd0d6770c6";

function mapAvailability(status: unknown): Availability {
  const s = String(status ?? "").toUpperCase();
  if (s.includes("IN_STOCK") || s === "AVAILABLE" || s.includes("AVAILABLE"))
    return "in_stock";
  if (s.includes("OUT") || s.includes("UNAVAILABLE")) return "out_of_stock";
  return "unknown";
}

function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function walkProducts(node: unknown, out: Record<string, unknown>[] = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) walkProducts(item, out);
    return out;
  }
  if (typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  if (
    (obj.usItemId || obj.id || obj.productId) &&
    (obj.name || obj.title || obj.priceInfo || obj.price)
  ) {
    out.push(obj);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") walkProducts(value, out);
  }
  return out;
}

function mapItem(
  item: Record<string, unknown>,
  storeId: string,
): ProductOffer | null {
  const productId = String(item.usItemId ?? item.id ?? item.productId ?? "");
  if (!productId) return null;

  const priceInfo = (item.priceInfo ?? {}) as Record<string, unknown>;
  const current = (priceInfo.currentPrice ?? priceInfo.linePrice ?? {}) as {
    price?: unknown;
  };
  const was = (priceInfo.wasPrice ?? {}) as { price?: unknown };
  const unit = (priceInfo.unitPrice ?? {}) as { price?: unknown };

  const price =
    parseMoney(current.price) ??
    parseMoney(item.price) ??
    parseMoney(priceInfo.linePrice) ??
    parseMoney(priceInfo.price);
  if (price == null) return null;

  const wasPrice = parseMoney(was.price);

  return {
    retailer: "walmart_ca",
    storeId,
    productId,
    name: String(item.name ?? item.title ?? "Unknown"),
    brand: typeof item.brand === "string" ? item.brand : undefined,
    packageSize:
      typeof item.salesUnit === "string" ? item.salesUnit : undefined,
    price,
    promoPrice: wasPrice != null && wasPrice > price ? price : undefined,
    unitPrice: parseMoney(unit.price),
    availability: mapAvailability(
      item.availabilityStatus ?? item.availability,
    ),
    confidence: "exact",
    checkedAt: new Date().toISOString(),
    sourceUrl: `https://www.walmart.ca/en/ip/${productId}`,
    raw: item,
  };
}

function cookieOverrides(): Record<string, string> {
  const raw = process.env.WALMART_COOKIE_OVERRIDES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function browserCookieHeader(storeId: string): string | null {
  const full = process.env.WALMART_BROWSER_COOKIE?.trim();
  if (!full) return null;
  return [
    full,
    `deliveryCatchment=${storeId}`,
    `defaultNearestStoreId=${storeId}`,
    `assortmentStoreId=${storeId}`,
  ].join("; ");
}

export class WalmartConnector implements RetailerConnector {
  readonly id = "walmart_ca";

  constructor(private readonly postalCode: string = "L4J0A7") {}

  /** Map/store page — works without PX; validates physical store node. */
  async resolveStore(storeId: string): Promise<WalmartStoreNode | null> {
    return resolveWalmartStorePage(storeId);
  }

  async searchProducts(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    if (!storeId) {
      throw new ConnectorError(
        "Walmart requires storeId. Locked POC store = 5831.",
        this.id,
        "no_store_context",
      );
    }

    const ssr = await this.searchViaSsrHtml(query, storeId);
    if (ssr.length > 0) return ssr;

    let blocked = false;
    try {
      const gql = await this.searchViaGetPreso(query, storeId);
      if (gql.length > 0) return gql;
    } catch (e) {
      if (e instanceof ConnectorError && e.code === "blocked") {
        blocked = true;
      } else {
        throw e;
      }
    }

    if (isWalmartBrowserEnabled()) {
      try {
        const browserHits = await searchProductsInBrowser(query, storeId);
        if (browserHits.length > 0) return browserHits;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (process.env.WALMART_ALLOW_FLIPP_FALLBACK === "1") {
          return this.searchViaFlipp(query, storeId);
        }
        throw new ConnectorError(
          msg.includes("walmart:warm")
            ? msg
            : `Walmart browser path failed for store ${storeId}: ${msg.slice(0, 200)}. Run: npm run walmart:warm`,
          this.id,
          "blocked",
        );
      }
    }

    if (process.env.WALMART_ALLOW_FLIPP_FALLBACK === "1") {
      return this.searchViaFlipp(query, storeId);
    }

    throw new ConnectorError(
      blocked
        ? `Walmart shelf API blocked by PerimeterX for store ${storeId}. ` +
            `Run: npm run walmart:warm (persistent browser profile; no manual cookie paste). ` +
            `See docs/walmart-pricing.md`
        : `Walmart returned no products for store ${storeId}. Run: npm run walmart:warm`,
      this.id,
      blocked ? "blocked" : "not_found",
    );
  }

  private async searchViaSsrHtml(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    const cookie =
      browserCookieHeader(storeId) ??
      [
        `deliveryCatchment=${storeId}`,
        `defaultNearestStoreId=${storeId}`,
        `assortmentStoreId=${storeId}`,
        `walmart.nearestPostalCode=${this.postalCode}`,
        ...Object.entries(cookieOverrides()).map(([k, v]) => `${k}=${v}`),
      ].join("; ");

    const url = `https://www.walmart.ca/en/search?q=${encodeURIComponent(query)}&facet=fulfillment_method%3APickup`;
    const res = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Cookie: cookie,
      },
      redirect: "follow",
    });
    const html = await res.text();
    if (/Verify Your Identity/i.test(html) || res.url.includes("/blocked")) {
      return [];
    }
    return parseWalmartSearchNextData(html, storeId);
  }

  private async searchViaGetPreso(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    const aqp = {
      categoryNupsEnabled: false,
      isDynamicFacetsEnabled: true,
      isGenAiEnabled: false,
      isLMPBrowsePage: false,
      isModuleArrayReq: false,
      isMoreOptionsTileEnabled: true,
      isWicCacheAvailable: false,
      neuralSearchSeeAll: false,
    };

    const variables = {
      adsParams: { fungibilityEnabled: false },
      aQP: aqp,
      contentLayoutVersion: "v1",
      dGv: false,
      enableQuickViewBottomSheet: false,
      enableSlaBadgeV2: false,
      fE: false,
      fetchSBAV1: false,
      fFp: {
        dynamicFitmentEnabled: true,
        extendedAttributesEnabled: true,
        fuelTypeEnabled: true,
        optInSearchFitmentEnabled: true,
        powerSportEnabled: true,
      },
      fSP: {
        additionalQueryParams: aqp,
        channel: "Mobile",
        displayGuidedNav: false,
        facet: "fulfillment_method:Pickup",
        id: "",
        page: 1,
        pageType: "MobileSearchPage",
        prg: "ios",
        query,
        spelling: true,
        tenant: "CA_GLASS",
      },
      ft: "fulfillment_method:Pickup",
      fungibilityEnabled: false,
      iCLS: true,
      includeGroupsV2: false,
      isAddToListMenuIconEnabled: false,
      p13n: {
        page: 1,
        userClientInfo: { callType: "CLIENT", deviceType: "IOS" },
        userReqInfo: {
          enableSlaBadgeV2: false,
          isMoreOptionsTileEnabled: true,
          refererContext: { query },
          vid: crypto.randomUUID().toUpperCase(),
        },
      },
      pg: 1,
      postProcessingVersion: 1,
      pT: "MobileSearchPage",
      qy: query,
      rLS: true,
      shouldQueryRedirectUrl: false,
      sp: true,
      tempo: {},
      ten: "CA_GLASS",
      tp: false,
    };

    const url = new URL(
      `https://www.walmart.ca/orchestra/snb/graphql/getPreso/${PRESO_HASH}/search`,
    );
    url.searchParams.set("query", query);
    url.searchParams.set("facet", "fulfillment_method:Pickup");
    url.searchParams.set("page", "1");
    url.searchParams.set("spelling", "true");
    url.searchParams.set("displayGuidedNav", "false");
    url.searchParams.set(
      "additionalQueryParams",
      "{isGenAiEnabled=false,isMoreOptionsTileEnabled=true,isDynamicFacetsEnabled=true,isModuleArrayReq=false}",
    );
    url.searchParams.set("id", PRESO_HASH);
    url.searchParams.set("variables", JSON.stringify(variables));

    const browser = browserCookieHeader(storeId);
    const cookies: Record<string, string> = {
      deliveryCatchment: storeId,
      defaultNearestStoreId: storeId,
      assortmentStoreId: storeId,
      ...cookieOverrides(),
    };

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": browser
          ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
          : "WMT1H-CA/26.3.1 iOS/26.2.1",
        "X-O-Platform": browser ? "rweb" : "ios",
        "X-O-Platform-Version": "26.3.1",
        "X-O-Bu": "WALMART-CA",
        "X-O-Mart": "B2C",
        "X-O-Gql-Query": "query getPreso",
        "X-Apollo-Operation-Name": "getPreso",
        "X-O-Segment": "oaoh",
        Cookie:
          browser ??
          Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
      },
    });

    if (res.status === 412 || res.status === 403) {
      throw new ConnectorError(
        `Walmart getPreso blocked (HTTP ${res.status})`,
        this.id,
        "blocked",
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new ConnectorError(
        `Walmart search HTTP ${res.status}: ${text.slice(0, 240)}`,
        this.id,
        "http",
      );
    }

    if (
      text.includes("px-captcha") ||
      text.includes('"redirectUrl":"/blocked')
    ) {
      throw new ConnectorError(
        "Walmart returned PerimeterX challenge payload",
        this.id,
        "blocked",
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ConnectorError(
        "Walmart returned non-JSON body",
        this.id,
        "parse",
      );
    }

    const offers = walkProducts(body)
      .map((item) => mapItem(item, storeId))
      .filter((o): o is ProductOffer => o != null);

    const seen = new Set<string>();
    return offers.filter((o) => {
      if (seen.has(o.productId)) return false;
      seen.add(o.productId);
      return true;
    });
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

  private async searchViaFlipp(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    const postal = (
      process.env.WALMART_POSTAL_CODE ?? this.postalCode
    ).replace(/\s+/g, "");
    const url = new URL("https://backflipp.wishabi.com/flipp/items/search");
    url.searchParams.set("locale", "en-ca");
    url.searchParams.set("postal_code", postal);
    url.searchParams.set("q", `Walmart ${query}`);
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; RoyalSassPOC/0.1; +local-dev)",
      },
    });
    if (!res.ok) {
      throw new ConnectorError(
        `Walmart Flipp fallback HTTP ${res.status}`,
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
            : Number.parseFloat(
                String(item.current_price ?? item.price ?? "").replace(
                  /[^0-9.]/g,
                  "",
                ),
              );
        if (!name || !Number.isFinite(price)) return null;
        const offer: ProductOffer = {
          retailer: "walmart_ca",
          storeId,
          productId: String(item.id ?? `${name}-${price}`),
          name,
          price,
          availability: "unknown",
          confidence: "estimated",
          checkedAt: new Date().toISOString(),
          sourceUrl: "https://www.walmart.ca/",
          raw: { ...item, _pocNote: "Flipp flyer fallback — not shelf price" },
        };
        return offer;
      })
      .filter((o): o is ProductOffer => o != null);
  }
}

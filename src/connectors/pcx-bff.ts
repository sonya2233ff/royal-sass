import {
  ConnectorError,
  pickWasPrice,
  type Availability,
  type ProductOffer,
} from "./types";
import { extractRetailerImage } from "@/lib/product-image";
import {
  applySetCookiesFromResponse,
  cookieHeaderFromJar,
  formatPcxFulfillmentDate,
  initialPcxJar,
  pcxCookieCount,
  pcxShouldPrewarmCookies,
  prewarmPcxJar,
  refreshPcxJar,
  type CookieJar,
  PCX_BROWSER_UA,
} from "./pcx-session";

/** Current Loblaw PCX BFF search. */
export const PCX_SEARCH_URL =
  process.env.NOFRILLS_SEARCH_URL?.trim() ||
  "https://api.pcexpress.ca/pcx-bff/api/v2/products/search";

/**
 * Public web X-Apikey sent by nofrills.ca / wholesaleclub.ca.
 * `.env` copies often set `NOFRILLS_API_KEY=` (empty). `??` does not treat
 * "" as missing, so a blank header becomes 401 invalid_client.
 */
export const PCX_PUBLIC_WEB_API_KEY = "C1xujSegT5j3ap3yexJjqhOfELwGKYvz";

export function resolvePcxApiKey(): string {
  return process.env.NOFRILLS_API_KEY?.trim() || PCX_PUBLIC_WEB_API_KEY;
}

export type PcxBanner = "nofrills" | "wholesaleclub";

export type PcxRetailerId = "no_frills" | "wholesale_club";

export type PcxSearchOpts = {
  query: string;
  storeId: string;
  banner: PcxBanner;
  retailer: PcxRetailerId;
  origins: string[];
  includeRaw?: boolean;
  rawLimit?: number;
};

export type PcxProbeResult = {
  ok: boolean;
  query: string;
  storeId: string;
  banner: PcxBanner;
  searchUrl: string;
  originTried: string | null;
  httpStatus: number | null;
  mappedCount: number;
  tileCount: number;
  offers: ProductOffer[];
  rawTiles?: Record<string, unknown>[];
  bodyPreview?: string;
  error?: string;
  ms: number;
  cookieCount?: number;
  retriedWithCookies?: boolean;
};

export function pcxProductIdsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const strip = (id: string) => id.replace(/_(EA|KG|LB|C\d+)$/i, "");
  const left = strip(a);
  const right = strip(b);
  return left.length > 0 && left === right;
}

function todayDdmmyyyy(): string {
  return formatPcxFulfillmentDate();
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
  retailer: PcxRetailerId,
  originHost: string,
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

  const deal =
    raw.deal && typeof raw.deal === "object"
      ? (raw.deal as Record<string, unknown>)
      : null;
  const promotions = Array.isArray(raw.promotions) ? raw.promotions : [];
  const badgeBlob = `${raw.textBadge ?? ""} ${JSON.stringify(raw.productBadge ?? "")}`;
  const saleFlagged =
    deal != null ||
    promotions.length > 0 ||
    /sale|save|promo|deal|special/i.test(badgeBlob);
  const wasPrice = pickWasPrice(
    price,
    parseMoney(pricing.wasPrice),
    parseMoney(pricing.regularPrice),
    parseMoney(pricing.originalPrice),
    parseMoney(deal?.wasPrice),
    parseMoney(deal?.regularPrice),
  );
  const promoPrice =
    parseMoney(pricing.salePrice) ??
    parseMoney(pricing.wasPrice) ??
    parseMoney(pricing.memberPrice);

  const unitPrice =
    parseMoney(pricing.unitPrice) ??
    parseMoney(pricingUnits.unitPrice) ??
    parseMoney(pricingUnits.price);

  const uom = String(
    pricing.unitOfSize ??
      pricing.unitMeasure ??
      pricingUnits.unitOfSize ??
      pricingUnits.type ??
      "",
  ).toLowerCase();
  let normalizedId = productId;
  if (!/_KG$|_LB$|_EA$/i.test(productId)) {
    if (/\blb|lbs\b/.test(uom)) normalizedId = `${productId}_LB`;
    else if (/\bkg\b/.test(uom)) normalizedId = `${productId}_KG`;
  }

  const stockStatus = raw.inventoryIndicator ?? raw.stockStatus ?? raw.isAvailable;

  const linkRaw = typeof raw.link === "string" ? raw.link.trim() : "";
  let sourceUrl: string;
  if (linkRaw.startsWith("http")) {
    sourceUrl = linkRaw;
  } else if (linkRaw.startsWith("/")) {
    sourceUrl = `${originHost}${linkRaw}`;
  } else {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "product";
    const pageId = /_(EA|KG|LB|C\d+)$/i.test(normalizedId)
      ? normalizedId
      : `${normalizedId}_EA`;
    sourceUrl = `${originHost}/en/${slug}/p/${pageId}`;
  }

  return {
    retailer,
    storeId,
    productId: normalizedId,
    name,
    brand,
    packageSize,
    upc: typeof raw.upc === "string" ? raw.upc : undefined,
    price,
    unitPrice,
    promoPrice:
      promoPrice != null && promoPrice !== price ? promoPrice : undefined,
    wasPrice,
    onSale: wasPrice != null || saleFlagged ? true : undefined,
    availability: mapAvailability(stockStatus),
    confidence: "exact",
    checkedAt: new Date().toISOString(),
    sourceUrl,
    image: extractRetailerImage(raw),
    raw,
  };
}

function buildHeaders(
  originHost: string,
  banner: PcxBanner,
  jar: CookieJar,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "*/*",
    "Content-Type": "application/json",
    "Accept-Language": "en",
    "X-Apikey": resolvePcxApiKey(),
    "X-Application-Type": "Web",
    "X-Channel": "web",
    "X-Loblaw-Tenant-Id": "ONLINE_GROCERIES",
    "Business-User-Agent": "PCXWEB",
    "Is-Helios-Account": "false",
    "Is-Iceberg-Enabled": "true",
    "X-Preview": "false",
    Origin_session_header: "B",
    "Site-Banner": banner,
    Origin: originHost,
    Referer: `${originHost}/`,
    "User-Agent": PCX_BROWSER_UA,
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
  const cookie = cookieHeaderFromJar(jar);
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function postPcxSearch(
  originHost: string,
  banner: PcxBanner,
  payload: unknown,
  jar: CookieJar,
): Promise<{ status: number; body: string }> {
  const res = await fetch(PCX_SEARCH_URL, {
    method: "POST",
    headers: buildHeaders(originHost, banner, jar),
    body: JSON.stringify(payload),
  });
  applySetCookiesFromResponse(jar, res);
  const body = await res.text();
  return { status: res.status, body };
}

export async function probePcxSearch(opts: PcxSearchOpts): Promise<PcxProbeResult> {
  const started = Date.now();
  const query = opts.query.trim();
  const storeId = String(opts.storeId);
  const includeRaw = Boolean(opts.includeRaw);
  const rawLimit = Math.min(Math.max(opts.rawLimit ?? 5, 1), 20);

  if (!query) {
    return {
      ok: false,
      query,
      storeId,
      banner: opts.banner,
      searchUrl: PCX_SEARCH_URL,
      originTried: null,
      httpStatus: null,
      mappedCount: 0,
      tileCount: 0,
      offers: [],
      error: "query is required",
      ms: Date.now() - started,
    };
  }

  const makePayload = () => ({
    cart: { cartId: crypto.randomUUID() },
    fulfillmentInfo: {
      storeId,
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
    banner: opts.banner,
    userData: {
      domainUserId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    },
    device: { screenSize: 1358 },
    searchRelatedInfo: {
      term: query,
      options: [{ name: "rmp.unifiedSearchVariant", value: "Y" }],
    },
  });

  let lastStatus = 0;
  let lastBody = "";
  let lastOrigin: string | null = null;
  let lastCookieCount = 0;
  let retriedWithCookies = false;

  for (const origin of opts.origins) {
    lastOrigin = origin;
    let jar = initialPcxJar(origin);
    if (pcxShouldPrewarmCookies() && jar.size === 0) {
      jar = await prewarmPcxJar(origin);
    }

    let posted = await postPcxSearch(origin, opts.banner, makePayload(), jar);
    lastStatus = posted.status;
    lastBody = posted.body;
    lastCookieCount = pcxCookieCount(jar);

    if (posted.status === 403 || posted.status === 401) {
      console.error(
        `pcx: HTTP ${posted.status} from ${origin}; rewriting session + banner cookies and retrying`,
      );
      jar = await refreshPcxJar(origin, false);
      posted = await postPcxSearch(origin, opts.banner, makePayload(), jar);
      lastStatus = posted.status;
      lastBody = posted.body;
      lastCookieCount = pcxCookieCount(jar);
      retriedWithCookies = true;
    }

    if (
      (posted.status === 403 || posted.status === 401) &&
      process.env.PCX_BOOTSTRAP_BROWSER === "1"
    ) {
      console.error(
        `pcx: HTTP ${posted.status} after HTTP cookies; trying browser bootstrap for ${origin}`,
      );
      jar = await refreshPcxJar(origin, true);
      posted = await postPcxSearch(origin, opts.banner, makePayload(), jar);
      lastStatus = posted.status;
      lastBody = posted.body;
      lastCookieCount = pcxCookieCount(jar);
      retriedWithCookies = true;
    }

    if (posted.status === 403 || posted.status === 401) {
      continue;
    }
    if (posted.status < 200 || posted.status >= 300) {
      return {
        ok: false,
        query,
        storeId,
        banner: opts.banner,
        searchUrl: PCX_SEARCH_URL,
        originTried: origin,
        httpStatus: posted.status,
        mappedCount: 0,
        tileCount: 0,
        offers: [],
        bodyPreview: lastBody.slice(0, 500),
        error: `HTTP ${posted.status}`,
        ms: Date.now() - started,
        cookieCount: lastCookieCount,
        retriedWithCookies,
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(lastBody);
    } catch {
      return {
        ok: false,
        query,
        storeId,
        banner: opts.banner,
        searchUrl: PCX_SEARCH_URL,
        originTried: origin,
        httpStatus: posted.status,
        mappedCount: 0,
        tileCount: 0,
        offers: [],
        bodyPreview: lastBody.slice(0, 500),
        error: "non-JSON body",
        ms: Date.now() - started,
        cookieCount: lastCookieCount,
        retriedWithCookies,
      };
    }

    const tiles = walkProducts(json);
    const offers = tiles
      .map((r) => mapProduct(r, storeId, opts.retailer, origin))
      .filter((o): o is ProductOffer => o != null);

    const seen = new Set<string>();
    const unique = offers.filter((o) => {
      if (seen.has(o.productId)) return false;
      seen.add(o.productId);
      return true;
    });

    return {
      ok: true,
      query,
      storeId,
      banner: opts.banner,
      searchUrl: PCX_SEARCH_URL,
      originTried: origin,
      httpStatus: posted.status,
      mappedCount: unique.length,
      tileCount: tiles.length,
      offers: includeRaw
        ? unique
        : unique.map((o) => {
            const { raw: _raw, ...rest } = o;
            return rest;
          }),
      rawTiles: includeRaw ? tiles.slice(0, rawLimit) : undefined,
      ms: Date.now() - started,
      cookieCount: lastCookieCount,
      retriedWithCookies,
    };
  }

  return {
    ok: false,
    query,
    storeId,
    banner: opts.banner,
    searchUrl: PCX_SEARCH_URL,
    originTried: lastOrigin,
    httpStatus: lastStatus || null,
    mappedCount: 0,
    tileCount: 0,
    offers: [],
    bodyPreview: lastBody.slice(0, 500),
    error: `blocked or unauthorized (HTTP ${lastStatus})`,
    ms: Date.now() - started,
    cookieCount: lastCookieCount,
    retriedWithCookies,
  };
}

export async function pcxSearchOrThrow(opts: {
  query: string;
  storeId: string;
  banner: PcxBanner;
  retailer: PcxRetailerId;
  origins: string[];
  label: string;
}): Promise<ProductOffer[]> {
  if (!opts.storeId) {
    throw new ConnectorError(
      `${opts.label} requires a storeId for store-specific pricing`,
      opts.retailer,
      "no_store_context",
    );
  }
  const probed = await probePcxSearch({
    query: opts.query,
    storeId: opts.storeId,
    banner: opts.banner,
    retailer: opts.retailer,
    origins: opts.origins,
    includeRaw: true,
  });
  if (probed.ok) return probed.offers;
  if (probed.error?.startsWith("HTTP ")) {
    throw new ConnectorError(
      `${opts.label} search ${probed.error}: ${(probed.bodyPreview ?? "").slice(0, 180)}`,
      opts.retailer,
      "http",
    );
  }
  if (probed.error === "non-JSON body") {
    throw new ConnectorError(
      `${opts.label} returned non-JSON body`,
      opts.retailer,
      "parse",
    );
  }
  throw new ConnectorError(
    `${opts.label} blocked or unauthorized (HTTP ${probed.httpStatus ?? "?"}). Empty NOFRILLS_API_KEY is ignored (public web key is used). On 401/403 the client rewrites banner cookies (and Playwright when PCX_BOOTSTRAP_BROWSER=1). If this is still blocked, the edge may be filtering this IP — paste a fresh X-Apikey into NOFRILLS_API_KEY or PCX_COOKIE from the banner Network tab. Body: ${(probed.bodyPreview ?? "").slice(0, 120)}`,
    opts.retailer,
    "blocked",
  );
}

export async function pcxGetProduct(opts: {
  productId: string;
  storeId: string;
  banner: PcxBanner;
  retailer: PcxRetailerId;
  origins: string[];
  label: string;
}): Promise<ProductOffer | null> {
  const hits = await pcxSearchOrThrow({
    query: opts.productId,
    storeId: opts.storeId,
    banner: opts.banner,
    retailer: opts.retailer,
    origins: opts.origins,
    label: opts.label,
  });
  const exact = hits.find((h) => pcxProductIdsMatch(h.productId, opts.productId));
  if (exact) return exact;
  if (/^\d{5,}/.test(opts.productId) || /_(EA|KG|LB|C\d+)$/i.test(opts.productId)) {
    return null;
  }
  return hits[0] ?? null;
}

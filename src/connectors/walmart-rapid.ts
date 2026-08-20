/**
 * Walmart Canada via OpenWeb Ninja / RapidAPI "Real-Time Walmart Data".
 * Store-scoped search: domain=ca, store_id, zip.
 *
 * Env:
 *   OPENWEBNINJA_API_KEY  → https://api.openwebninja.com (header x-api-key)
 *   RAPIDAPI_KEY          → RapidAPI gateway (X-RapidAPI-Key)
 *   WALMART_RAPID_HOST    → override RapidAPI host (optional)
 */
import {
  ConnectorError,
  pickWasPrice,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";
import { extractRetailerImage } from "@/lib/product-image";

const OWN_BASE = "https://api.openwebninja.com/real-time-walmart-data";
const RAPID_HOST =
  process.env.WALMART_RAPID_HOST ??
  "real-time-walmart-data1.p.rapidapi.com";

function ownKey(): string | undefined {
  return process.env.OPENWEBNINJA_API_KEY?.trim() || undefined;
}

function rapidKey(): string | undefined {
  return process.env.RAPIDAPI_KEY?.trim() || undefined;
}

export function isWalmartRapidConfigured(): boolean {
  return Boolean(ownKey() || rapidKey());
}

function authHeaders(): Record<string, string> {
  const own = ownKey();
  if (own) {
    return { "x-api-key": own, Accept: "application/json" };
  }
  const rapid = rapidKey();
  if (rapid) {
    return {
      "X-RapidAPI-Key": rapid,
      "X-RapidAPI-Host": RAPID_HOST,
      Accept: "application/json",
    };
  }
  throw new ConnectorError(
    "Set OPENWEBNINJA_API_KEY or RAPIDAPI_KEY for Walmart Rapid connector",
    "walmart_ca",
    "unsupported",
  );
}

function baseUrl(): string {
  if (ownKey()) return OWN_BASE;
  return `https://${RAPID_HOST}`;
}

function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function mapAvailability(raw: unknown): Availability {
  if (raw === true || raw === false) {
    return raw ? "out_of_stock" : "in_stock";
  }
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return "unknown";
  const compact = s.replace(/[\s-]+/g, "_");
  if (
    compact.includes("out_of_stock") ||
    s.includes("unavailable") ||
    s === "false"
  ) {
    return "out_of_stock";
  }
  if (
    compact.includes("in_stock") ||
    s.includes("in stock") ||
    s.includes("available") ||
    s === "true"
  ) {
    return "in_stock";
  }
  return "unknown";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Extract product arrays from various OpenWeb Ninja / RapidAPI envelopes. */
export function extractProductRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];

  const data = asRecord(root.data) ?? root;
  const candidates = [
    data.products,
    data.items,
    data.results,
    root.products,
    root.items,
    root.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      return c.filter((x) => x && typeof x === "object") as Record<
        string,
        unknown
      >[];
    }
  }

  // product-details single object
  if (data.product_id || data.us_item_id || data.productId || data.name || data.title) {
    return [data];
  }
  if (root.product_id || root.us_item_id || root.name || root.title) {
    return [root];
  }
  return [];
}

export function mapRapidProduct(
  item: Record<string, unknown>,
  storeId: string,
): ProductOffer | null {
  const productIdRaw = String(
    item.product_id ??
      item.us_item_id ??
      item.usItemId ??
      item.item_id ??
      item.id ??
      "",
  );
  const productId = productIdRaw.replace(/^PRD/i, "").trim();
  if (!productId) return null;

  const name = String(item.product_title ?? item.title ?? item.name ?? "").trim();
  if (!name) return null;

  const price =
    parseMoney(item.price) ??
    parseMoney(item.offer_price) ??
    parseMoney(item.current_price) ??
    parseMoney(asRecord(item.price_info)?.price) ??
    parseMoney(asRecord(item.priceInfo)?.currentPrice);

  if (price == null || price <= 0) return null;

  const unitRaw =
    item.price_per_unit_amount ??
    item.unit_price ??
    item.pricePerUnit ??
    asRecord(item.price_info)?.price_per_unit;
  let unitPrice = parseMoney(unitRaw);
  // OpenWeb sometimes returns "$1.00" style; also unit type separately
  if (unitPrice != null && unitPrice > 5 && String(unitRaw).includes("¢")) {
    unitPrice = unitPrice / 100;
  }
  // Guard: absurd unit prices break pack sanity (e.g. 321 instead of 0.32 $/100ml)
  if (
    unitPrice != null &&
    (unitPrice > price * 2 || unitPrice > 50)
  ) {
    unitPrice = undefined;
  }

  const packageSize = String(
    item.package_size ??
      item.product_size ??
      item.size ??
      item.volume ??
      item.weight ??
      "",
  ).trim() || undefined;

  const upc = String(item.upc ?? item.gtin ?? item.barcode ?? "").trim() || undefined;
  const brand = String(item.brand ?? item.manufacturer ?? "").trim() || undefined;
  const sourceUrl = String(item.url ?? item.product_url ?? item.link ?? "").trim() || undefined;

  const outOfStock =
    item.out_of_stock === true ||
    mapAvailability(item.availability) === "out_of_stock";

  const savings = parseMoney(item.savings_amount);
  const wasPrice = pickWasPrice(
    price,
    parseMoney(item.list_price),
    parseMoney(asRecord(item.price_info)?.was_price),
    parseMoney(asRecord(item.price_info)?.wasPrice),
    parseMoney(asRecord(item.priceInfo)?.wasPrice),
    savings != null && savings > 0.005 ? price + savings : undefined,
  );
  const badges = Array.isArray(item.badge_flags) ? item.badge_flags : [];
  const saleBadge = badges.some((b) => {
    const rec = asRecord(b);
    const blob = `${rec?.key ?? ""} ${rec?.text ?? ""} ${String(b)}`;
    return /rollback|sale|save/i.test(blob);
  });
  const urlSale = /athbdg=L1300/i.test(sourceUrl ?? "");
  const onSale = Boolean(wasPrice || saleBadge || urlSale);

  return {
    retailer: "walmart_ca",
    storeId,
    productId,
    name,
    brand,
    packageSize,
    upc,
    price,
    unitPrice,
    wasPrice,
    onSale: onSale || undefined,
    // Rapid "In stock" / out_of_stock:false is a website listing flag, not
    // store #5831 shelf quantity. Only trust an explicit out-of-stock.
    availability: outOfStock ? "out_of_stock" : "unknown",
    confidence: "exact",
    checkedAt: new Date().toISOString(),
    sourceUrl,
    image: extractRetailerImage(item),
    raw: item,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTimeoutLike(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = "name" in e ? String(e.name) : "";
  const msg = e instanceof Error ? e.message : String(e);
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /aborted|timeout/i.test(msg)
  );
}

/** Rapid product-details for walmart.ca often 456/503; search-by-SKU still works. */
export function rapidOfferMatchesSku(
  offer: { productId: string; sourceUrl?: string | null },
  sku: string,
): boolean {
  const want = sku.replace(/^PRD/i, "").trim();
  if (!want || !offer.productId) return false;
  const got = offer.productId.replace(/^PRD/i, "").trim();
  if (got === want) return true;
  return Boolean(offer.sourceUrl?.includes(want));
}

async function getJson(pathAndQuery: string): Promise<unknown> {
  const url = `${baseUrl()}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      const res = await fetch(url, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(25_000),
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text.slice(0, 500) };
      }
      if (res.status === 401 || res.status === 403) {
        throw new ConnectorError(
          `Walmart Rapid auth failed (${res.status})`,
          "walmart_ca",
          "blocked",
        );
      }
      if (res.status === 429 || res.status === 503) {
        lastErr = new ConnectorError(
          `Walmart Rapid HTTP ${res.status}: ${text.slice(0, 160)}`,
          "walmart_ca",
          "http",
        );
        continue;
      }
      if (!res.ok) {
        throw new ConnectorError(
          `Walmart Rapid HTTP ${res.status}: ${text.slice(0, 160)}`,
          "walmart_ca",
          "http",
        );
      }
      return body;
    } catch (e) {
      if (e instanceof ConnectorError && e.code === "blocked") throw e;
      if (e instanceof ConnectorError && !/HTTP (429|503)/.test(e.message)) {
        throw e;
      }
      lastErr = e;
      if (!isTimeoutLike(e) && !(e instanceof ConnectorError)) throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new ConnectorError(
        "Walmart Rapid request failed",
        "walmart_ca",
        "http",
      );
}

export class WalmartRapidConnector implements RetailerConnector {
  readonly id = "walmart_ca";

  constructor(
    private readonly postalCode = process.env.WALMART_POSTAL_CODE ?? "L4J0A7",
  ) {}

  async searchProducts(query: string, storeId: string): Promise<ProductOffer[]> {
    const params = new URLSearchParams({
      query,
      domain: "ca",
      store_id: storeId,
      zip: this.postalCode.replace(/\s+/g, ""),
      page: "1",
    });
    const body = await getJson(`/search?${params}`);
    const rows = extractProductRows(body);
    const out: ProductOffer[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const offer = mapRapidProduct(row, storeId);
      if (!offer || seen.has(offer.productId)) continue;
      seen.add(offer.productId);
      out.push(offer);
    }
    return out;
  }

  async getProduct(
    productId: string,
    storeId: string,
  ): Promise<ProductOffer | null> {
    const sku = productId.replace(/^PRD/i, "").trim();
    // CA product-details often returns HTTP 400/456 or 503. Store search by
    // the same SKU is faster and still store-scoped.
    try {
      const hits = await this.searchProducts(sku, storeId);
      const hit = hits.find((h) => rapidOfferMatchesSku(h, sku));
      if (hit) return hit;
    } catch (e) {
      if (e instanceof ConnectorError && e.code === "blocked") throw e;
    }

    const params = new URLSearchParams({
      product_id: sku,
      domain: "ca",
    });
    params.set("store_id", storeId);
    params.set("zip", this.postalCode.replace(/\s+/g, ""));
    try {
      const body = await getJson(`/product-details?${params}`);
      const rows = extractProductRows(body);
      for (const row of rows) {
        const offer = mapRapidProduct(row, storeId);
        if (offer && rapidOfferMatchesSku(offer, sku)) return offer;
        if (offer) return offer;
      }
    } catch (e) {
      if (e instanceof ConnectorError && e.code === "blocked") throw e;
    }
    return null;
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
    const p = await this.getProduct(productId, storeId);
    return p?.availability ?? "unknown";
  }
}

/**
 * MVR Cash & Carry (3655 Weston Rd) via public MVR Plus Shopify JSON.
 * One warehouse — prices are not per-store. INSTOREPRICE is the Cash & Carry
 * shelf tag; Shopify variant.price is the online markup and is not used for compare.
 */
import {
  ConnectorError,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";
import { parseMvrShopifyTags } from "./store-connector";
import { extractRetailerImage } from "@/lib/product-image";
import { parseMassFromText } from "@/domain/units";

export const MVR_STORE_ID = "weston";
export const MVR_STORE_KEY = "mvr_weston";
export const MVR_CONNECTOR_ID = "mvr" as const;
export const MVR_ORIGIN = "https://plus.mvrwholesale.com";
export const MVR_ADDRESS = "3655 Weston Rd, North York, ON M9L 1V8";

function shopifyBase(): string {
  return (
    process.env.MVR_SHOPIFY_BASE?.replace(/\/$/, "") ?? MVR_ORIGIN
  );
}

function absUrl(pathOrUrl: string | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith("//")) return `https:${pathOrUrl}`;
  const base = shopifyBase();
  if (pathOrUrl.startsWith("/")) return `${base}${pathOrUrl}`;
  return `${base}/products/${pathOrUrl}`;
}

export function packageSizeFromMvrTitle(title: string): string | undefined {
  const t = title.trim();
  const casePack = t.match(
    /(\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|lt|l|gr|g|kg|lb|lbs|pint|pints|ea|pk)\b.*)$/i,
  );
  if (casePack) return casePack[1].replace(/\s+/g, " ").trim();
  const caseWord = t.match(
    /(case\s+\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|lt|l|gr|g|kg|lb|lbs|pint|pints|ea|pk)\b.*)$/i,
  );
  if (caseWord) return caseWord[1].replace(/\s+/g, " ").trim();
  const perKg = t.match(/(per\s*kg)$/i);
  if (perKg) return "per kg";
  const single = t.match(
    /(\d+(?:\.\d+)?\s*(?:ml|lt|l|gr|g|kg|lb|lbs|pint|pints|ea|pk|lt)\b.*)$/i,
  );
  if (single) return single[1].replace(/\s+/g, " ").trim();
  return undefined;
}

function availabilityOf(available: unknown): Availability {
  if (available === true) return "in_stock";
  if (available === false) return "out_of_stock";
  return "unknown";
}

function mapProduct(input: {
  id: string;
  title: string;
  vendor?: string;
  handle?: string;
  url?: string;
  tags?: string[] | string;
  available?: boolean;
  suggestPrice?: unknown;
  variant?: {
    sku?: unknown;
    barcode?: unknown;
    price?: unknown;
    available?: unknown;
    grams?: unknown;
  };
  image?: unknown;
  raw: unknown;
  priceFromJsCents?: boolean;
}): ProductOffer | null {
  const tags = parseMvrShopifyTags(input.tags);
  const shelf = tags.inStorePrice;
  if (shelf == null || !(shelf > 0)) return null;

  const packageSize = packageSizeFromMvrTitle(input.title);
  const mass =
    parseMassFromText(packageSize ?? "") ?? parseMassFromText(input.title);
  const grams = Number(input.variant?.grams);
  const perKgTitle = /per\s*kg/i.test(input.title);
  const parsedMassKg = perKgTitle
    ? 1
    : mass?.kg ?? (Number.isFinite(grams) && grams > 0 ? grams / 1000 : undefined);
  const unitPrice = perKgTitle
    ? shelf
    : parsedMassKg && parsedMassKg > 0
      ? Math.round((shelf / parsedMassKg) * 100) / 100
      : undefined;
  const upc = String(
    input.variant?.sku ?? input.variant?.barcode ?? "",
  ).replace(/\D/g, "");

  return {
    retailer: MVR_CONNECTOR_ID,
    storeId: MVR_STORE_ID,
    productId: input.id,
    name: input.title,
    brand: input.vendor?.trim() || undefined,
    packageSize,
    upc: upc.length >= 8 ? upc : undefined,
    price: shelf,
    unitPrice,
    availability: availabilityOf(input.available ?? input.variant?.available),
    confidence: "exact",
    checkedAt: new Date().toISOString(),
    sourceUrl: absUrl(input.url) ?? absUrl(input.handle),
    image:
      extractRetailerImage(input.raw) ??
      extractRetailerImage({
        image: input.image,
        featured_image: input.image,
      }),
    raw: input.raw,
  };
}

type SuggestProduct = {
  id?: number | string;
  title?: string;
  vendor?: string;
  price?: string;
  tags?: string[] | string;
  available?: boolean;
  handle?: string;
  url?: string;
  featured_image?: unknown;
  image?: unknown;
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ConnectorError(
      `MVR Shopify HTTP ${res.status}: ${text.slice(0, 120)}`,
      MVR_CONNECTOR_ID,
      "http",
    );
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new ConnectorError("MVR Shopify JSON parse failed", MVR_CONNECTOR_ID, "parse");
  }
}

export async function mvrSuggest(query: string, limit = 10): Promise<SuggestProduct[]> {
  const url = new URL("/search/suggest.json", shopifyBase());
  url.searchParams.set("q", query);
  url.searchParams.set("resources[type]", "product");
  url.searchParams.set("resources[limit]", String(limit));
  const body = (await getJson(url.toString())) as {
    resources?: { results?: { products?: SuggestProduct[] } };
  };
  return body.resources?.results?.products ?? [];
}

export async function mvrProductByHandle(
  handle: string,
): Promise<Record<string, unknown> | null> {
  const h = handle.replace(/^\/+/, "").replace(/^products\//, "");
  if (!h) return null;
  const url = `${shopifyBase()}/products/${encodeURIComponent(h)}.js`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ConnectorError(
      `MVR product HTTP ${res.status}`,
      MVR_CONNECTOR_ID,
      "http",
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

function offerFromSuggest(p: SuggestProduct): ProductOffer | null {
  const handle = String(p.handle ?? "").trim();
  const id = handle || String(p.id ?? "");
  if (!id || !p.title) return null;
  return mapProduct({
    id,
    title: p.title,
    vendor: p.vendor,
    handle,
    url: p.url ?? (handle ? `/products/${handle}` : undefined),
    tags: p.tags,
    available: p.available,
    suggestPrice: p.price,
    variant: { price: p.price },
    image: p.featured_image ?? p.image,
    raw: p,
    priceFromJsCents: false,
  });
}

function offerFromProductJs(raw: Record<string, unknown>): ProductOffer | null {
  const handle = String(raw.handle ?? "").trim();
  const title = String(raw.title ?? "");
  if (!handle || !title) return null;
  const variants = Array.isArray(raw.variants)
    ? (raw.variants as Array<Record<string, unknown>>)
    : [];
  const v0 = variants[0] ?? {};
  return mapProduct({
    id: handle,
    title,
    vendor: typeof raw.vendor === "string" ? raw.vendor : undefined,
    handle,
    url: `/products/${handle}`,
    tags: raw.tags as string[] | string | undefined,
    available: Boolean(v0.available ?? raw.available),
    variant: {
      sku: v0.sku,
      barcode: v0.barcode,
      price: v0.price,
      available: v0.available,
      grams: v0.grams,
    },
    image: raw.featured_image ?? raw.featuredImage,
    raw,
    priceFromJsCents: true,
  });
}

export class MvrConnector implements RetailerConnector {
  readonly id = MVR_CONNECTOR_ID;

  async searchProducts(query: string, _storeId: string): Promise<ProductOffer[]> {
    const rows = await mvrSuggest(query, 10);
    const out: ProductOffer[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const offer = offerFromSuggest(row);
      if (!offer || seen.has(offer.productId)) continue;
      seen.add(offer.productId);
      out.push(offer);
    }
    return out;
  }

  async getProduct(productId: string, _storeId: string): Promise<ProductOffer | null> {
    const handle = productId.trim().replace(/^\/+/, "").replace(/^products\//, "");
    if (!handle) return null;
    if (/^[a-z0-9-]+$/i.test(handle) && /[a-z]/i.test(handle)) {
      const raw = await mvrProductByHandle(handle);
      return raw ? offerFromProductJs(raw) : null;
    }
    const hits = await this.searchProducts(productId, MVR_STORE_ID);
    return hits.find((h) => h.productId === productId) ?? hits[0] ?? null;
  }

  async getPrice(productId: string, storeId: string): Promise<ProductOffer | null> {
    return this.getProduct(productId, storeId);
  }

  async getAvailability(productId: string, storeId: string): Promise<Availability> {
    const offer = await this.getProduct(productId, storeId);
    return offer?.availability ?? "unknown";
  }
}

/** Fill UPC / grams / availability from products/{handle}.js when suggest JSON is thin. */
export async function hydrateMvrOffer(
  offer: ProductOffer,
): Promise<ProductOffer> {
  try {
    const full = await new MvrConnector().getProduct(
      offer.productId,
      MVR_STORE_ID,
    );
    return full ?? offer;
  } catch {
    return offer;
  }
}

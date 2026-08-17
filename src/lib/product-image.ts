/**
 * Retailer product photos (Rapid / OpenWeb Ninja `image` + `images[]`,
 * PCX `productImage[].imageUrl`). Results columns must use that store's
 * own object — never the shared staple art or the other store's CDN.
 */
import { catalogedOfferImage } from "@/lib/retailer-offer-images";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function isHttpImageUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function firstHttp(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (isHttpImageUrl(c)) return c.trim();
  }
  return undefined;
}

function imageFromObject(v: unknown): string | undefined {
  if (isHttpImageUrl(v)) return v.trim();
  const rec = asRecord(v);
  if (!rec) return undefined;
  return firstHttp(
    rec.extraLargeUrl,
    rec.largeUrl,
    rec.imageUrl,
    rec.url,
    rec.image,
    rec.mediumUrl,
    rec.smallUrl,
    rec.smallRetinaUrl,
    rec.thumbnail,
    rec.thumbnailUrl,
    rec.src,
  );
}

/** Pull a product photo URL from Rapid/PCX raw JSON or a mapped offer. */
export function extractRetailerImage(raw: unknown): string | undefined {
  const root = asRecord(raw);
  if (!root) return undefined;
  const data = asRecord(root.data) ?? root;
  const fromScalar = firstHttp(
    data.image,
    data.thumbnail,
    data.product_image,
    data.imageUrl,
    data.thumbnailUrl,
  );
  if (fromScalar) return fromScalar;

  if (Array.isArray(data.images)) {
    for (const img of data.images) {
      const url = imageFromObject(img);
      if (url) return url;
    }
  }

  const imgs = data.productImage ?? data.productImages;
  if (Array.isArray(imgs)) {
    for (const img of imgs) {
      const url = imageFromObject(img);
      if (url) return url;
    }
  }
  return imageFromObject(imgs);
}

export function offerImageUrl(offer?: {
  image?: string | null;
  raw?: unknown;
} | null): string | undefined {
  if (!offer) return undefined;
  return firstHttp(offer.image) ?? extractRetailerImage(offer.raw);
}

export function imageRetailerHost(
  url?: string | null,
): "walmart_ca" | "no_frills" | "other" | null {
  if (!url || !url.trim()) return null;
  const u = url.trim();
  if (/walmartimages\./i.test(u)) return "walmart_ca";
  if (
    /(?:digital|assets\.shop)\.loblaws\.ca/i.test(u) ||
    /loblaw\.ca/i.test(u) ||
    /dis-prod\.assetful\.loblaw/i.test(u)
  ) {
    return "no_frills";
  }
  return "other";
}

function isWalmartCdn(url?: string | null): boolean {
  return imageRetailerHost(url) === "walmart_ca";
}

function ownStoreImage(
  retailer: "walmart_ca" | "no_frills",
  url?: string | null,
): string | null {
  if (!isHttpImageUrl(url)) return null;
  const host = imageRetailerHost(url);
  if (host === retailer || host === "other") return url.trim();
  return null;
}

/**
 * Photo for one store column. Never reuse the other store's picture
 * or the shared `/products/` staple fallback.
 */
export function retailerSideImage(input: {
  retailer: "walmart_ca" | "no_frills";
  offer?: { image?: string | null; raw?: unknown; productId?: string | null } | null;
  stapleImage?: string | null;
}): string | null {
  const fromOffer = offerImageUrl(input.offer);
  const fromSku = catalogedOfferImage(
    input.retailer,
    input.offer?.productId,
  );
  const own = ownStoreImage(input.retailer, fromOffer ?? fromSku);
  if (own) return own;
  if (input.retailer === "walmart_ca" && isWalmartCdn(input.stapleImage)) {
    return input.stapleImage!.trim();
  }
  return null;
}

/**
 * Category A (preferred / exact SKU): Rapid/catalog photo, then local fallback.
 * Category B (cheapest produce): keep the staple's static image.
 */
export function preferredStapleImage(input: {
  matchMode: "preferred" | "cheapest";
  stapleImage?: string | null;
  wmOffer?: { image?: string | null; raw?: unknown } | null;
  nfOffer?: { image?: string | null; raw?: unknown } | null;
}): string | null {
  const fallback = input.stapleImage ?? null;
  if (input.matchMode !== "preferred") return fallback;
  return (
    offerImageUrl(input.wmOffer) ??
    offerImageUrl(input.nfOffer) ??
    (isHttpImageUrl(fallback) ? fallback.trim() : undefined) ??
    fallback
  );
}

/**
 * Retailer product photos (Rapid / OpenWeb Ninja `image` + `images[]`).
 * Category A cards prefer these CDN URLs over the static `/products/` fallback.
 */

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
    rec.url,
    rec.image,
    rec.thumbnail,
    rec.thumbnailUrl,
    rec.smallUrl,
    rec.imageUrl,
    rec.src,
  );
}

/** Pull a product photo URL from Rapid/PCX raw JSON or a mapped offer. */
export function extractRetailerImage(raw: unknown): string | undefined {
  const root = asRecord(raw);
  if (!root) return undefined;
  const data = asRecord(root.data) ?? root;
  const fromScalar = firstHttp(data.image, data.thumbnail, data.product_image);
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

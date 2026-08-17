/**
 * Per-SKU retailer photos (Walmart Rapid CDN / PCX digital.loblaws.ca).
 * Used when a catalog offer has no `image` yet so Results can still
 * show that store's object, not the shared staple art.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type RetailerKey = "walmart_ca" | "no_frills";
type ImageMap = Record<RetailerKey, Record<string, string>>;

const FILE = path.join(process.cwd(), "config", "retailer-offer-images.json");

let cached: ImageMap | null = null;

function emptyMap(): ImageMap {
  return { walmart_ca: {}, no_frills: {} };
}

function loadMap(): ImageMap {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<ImageMap>;
    cached = {
      walmart_ca: raw.walmart_ca ?? {},
      no_frills: raw.no_frills ?? {},
    };
  } catch {
    cached = emptyMap();
  }
  return cached;
}

function idKeys(productId: string, retailer: RetailerKey): string[] {
  const keys = [productId];
  const stripped = productId.replace(/_(EA|KG|LB|C\d+)$/i, "");
  if (stripped && stripped !== productId) keys.push(stripped);
  // Rapid sometimes stores Walmart.ca id ±1 vs the PDP / catalog id.
  if (retailer === "walmart_ca" && /^\d+$/.test(productId) && productId.length >= 6) {
    try {
      const n = BigInt(productId);
      keys.push(String(n - 1n), String(n + 1n));
    } catch {
      /* ignore */
    }
  }
  return keys;
}

export function catalogedOfferImage(
  retailer: RetailerKey,
  productId?: string | null,
): string | undefined {
  if (!productId) return undefined;
  const map = loadMap()[retailer] ?? {};
  for (const key of idKeys(productId, retailer)) {
    const url = map[key];
    if (typeof url === "string" && /^https?:\/\//i.test(url.trim())) {
      return url.trim();
    }
  }
  return undefined;
}

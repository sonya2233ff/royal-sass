import type { Availability, ProductOffer } from "./types";

export interface WalmartStoreNode {
  storeId: string;
  displayName: string;
  name?: string;
  addressLineOne?: string;
  city?: string;
  postalCode?: string;
  phoneNumber?: string;
  latitude?: number;
  longitude?: number;
  raw?: unknown;
}

/**
 * Store/map page SSR works without PerimeterX in our probes.
 * Confirms physical node metadata (not product prices).
 *
 * Example: https://www.walmart.ca/en/store/5831
 * → Thornhill, 700 Centre St, L4J 0A7, storeId 5831
 */
export async function resolveWalmartStorePage(
  storeId: string,
): Promise<WalmartStoreNode | null> {
  const res = await fetch(`https://www.walmart.ca/en/store/${storeId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  const html = await res.text();
  if (!res.ok || /Verify Your Identity/i.test(html)) return null;

  const next = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!next) return null;

  let data: unknown;
  try {
    data = JSON.parse(next[1]);
  } catch {
    return null;
  }

  const node = findNode(data, storeId);
  if (!node) {
    // Still confirm storeId appears
    if (!html.includes(storeId)) return null;
    return { storeId, displayName: `Walmart Store ${storeId}` };
  }
  return node;
}

function findNode(root: unknown, storeId: string): WalmartStoreNode | null {
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    const o = cur as Record<string, unknown>;
    if (String(o.id ?? o.storeId ?? "") === storeId && (o.displayName || o.name)) {
      const geo = o.geoPoint as
        | { latitude?: number; longitude?: number }
        | undefined;
      return {
        storeId,
        displayName: String(o.displayName ?? o.name),
        name: typeof o.name === "string" ? o.name : undefined,
        addressLineOne:
          typeof o.addressLineOne === "string" ? o.addressLineOne : undefined,
        city: typeof o.city === "string" ? o.city : undefined,
        postalCode:
          typeof o.postalCode === "string" ? o.postalCode : undefined,
        phoneNumber:
          typeof o.phoneNumber === "string" ? o.phoneNumber : undefined,
        latitude:
          typeof o.latitude === "number"
            ? o.latitude
            : typeof geo?.latitude === "number"
              ? geo.latitude
              : undefined,
        longitude:
          typeof o.longitude === "number"
            ? o.longitude
            : typeof geo?.longitude === "number"
              ? geo.longitude
              : undefined,
        raw: o,
      };
    }
    for (const v of Object.values(o)) stack.push(v);
  }
  return null;
}

/**
 * Parse product cards from search-page __NEXT_DATA__ (browser-warm session).
 */
export function parseWalmartSearchNextData(
  html: string,
  storeId: string,
): ProductOffer[] {
  if (/Verify Your Identity/i.test(html)) return [];
  const next = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!next) return [];

  let data: unknown;
  try {
    data = JSON.parse(next[1]);
  } catch {
    return [];
  }

  const items: Record<string, unknown>[] = [];
  const stack: unknown[] = [data];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    const o = cur as Record<string, unknown>;
    if (o.usItemId && (o.name || o.title) && (o.priceInfo || o.price)) {
      items.push(o);
    }
    for (const v of Object.values(o)) stack.push(v);
  }

  const checkedAt = new Date().toISOString();
  const offers: ProductOffer[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const productId = String(item.usItemId);
    if (seen.has(productId)) continue;
    seen.add(productId);

    const priceInfo = (item.priceInfo ?? {}) as Record<string, unknown>;
    const price =
      parseMoney(priceInfo.linePrice) ??
      parseMoney((priceInfo.currentPrice as { price?: unknown })?.price) ??
      parseMoney(priceInfo.price);
    if (price == null) continue;

    const avail = String(
      item.availabilityStatus ?? item.availability ?? "",
    ).toUpperCase();
    let availability: Availability = "unknown";
    if (avail.includes("IN_STOCK") || avail.includes("AVAILABLE"))
      availability = "in_stock";
    if (avail.includes("OUT")) availability = "out_of_stock";

    offers.push({
      retailer: "walmart_ca",
      storeId,
      productId,
      name: String(item.name ?? item.title),
      brand: typeof item.brand === "string" ? item.brand : undefined,
      price,
      unitPrice: parseMoney(
        (priceInfo.unitPrice as { price?: unknown } | string | undefined) ??
          priceInfo.unitPrice,
      ),
      availability,
      confidence: "exact",
      checkedAt,
      sourceUrl: `https://www.walmart.ca/en/ip/${productId}`,
      raw: item,
    });
  }
  return offers;
}

function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return parseMoney(o.price) ?? parseMoney(o.amount) ?? parseMoney(o.value);
  }
  return undefined;
}

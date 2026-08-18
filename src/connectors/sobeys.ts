import {
  ConnectorError,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";
import { parseMassFromText } from "@/domain/units";

/**
 * Thin Sobeys adapter for Clark & Hilda (merchant_store_code 659).
 *
 * Location context (confirmed in the flyer widget):
 *   postal_code=L4J6W7, cookie store_code_2072=659
 *
 * Reproducible price payload (no HTML scrape, no token):
 *   GET flyers.sobeys.com/flyer_data/{ontarioWeeklyFlyerId}
 *
 * That JSON is the **weekly Ontario flyer**, not a Clark & Hilda shelf API.
 * Offers are always confidence: "estimated".
 */
const FLIPP_FLYERS = "https://backflipp.wishabi.com/flipp/flyers";
const FLYER_DATA = "https://flyers.sobeys.com/flyer_data";
const MERCHANT_ID = 2072;

/** Confirmed Flipp/flyer merchant_store_code for Sobeys Clark & Hilda */
export const SOBEYS_CLARK_HILDA_STORE_CODE = "659";
export const SOBEYS_CLARK_HILDA_POSTAL = "L4J6W7";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type SobeysFlyerItem = {
  id?: number | string;
  flyer_item_id?: number | string;
  name?: string;
  display_name?: string;
  brand?: string;
  current_price?: number | string | null;
  price?: number | string | null;
  description?: string;
  sku?: string | null;
  valid_from?: string;
  valid_to?: string;
  large_image_url?: string;
  x_large_image_url?: string;
  clean_image_url?: string;
  sale_story?: string;
  pre_price_text?: string;
  web_url?: string;
  url?: string;
  flyer_type_name?: string;
  flyer_type_name_identifier?: string;
};

export type SobeysFlyerDocument = {
  id?: number | string;
  name_identifier?: string;
  flyer_type_name?: string;
  flyer_run_external_name?: string;
  title?: string;
  valid_from?: string;
  valid_to?: string;
  url?: string;
  items?: SobeysFlyerItem[];
};

export type SobeysFlyerCache = {
  flyerId: string;
  validFrom: string | null;
  validTo: string | null;
  flyerName: string;
  items: SobeysFlyerItem[];
  fetchedAt: string;
};

type FlippFlyer = {
  id?: number;
  merchant_id?: number;
  name?: string;
  merchant?: string;
  valid_from?: string;
  valid_to?: string;
};

let flyerCache: SobeysFlyerCache | null = null;

function normalizePostal(postal: string): string {
  return postal.replace(/\s+/g, "").toUpperCase();
}

function parsePrice(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9%+\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/^\d{8,14}$/.test(t));
}

export function scoreFlyerItem(item: SobeysFlyerItem, query: string): number {
  const hay =
    `${item.display_name ?? ""} ${item.name ?? ""} ${item.brand ?? ""} ${item.description ?? ""}`.toLowerCase();
  const parts = tokens(query);
  if (!parts.length) return 0;
  let hits = 0;
  for (const t of parts) {
    if (hay.includes(t)) hits += 1;
  }
  return hits / parts.length;
}

export function flyerItemToOffer(
  item: SobeysFlyerItem,
  opts: {
    storeId: string;
    flyerId?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    postalCode?: string;
  },
): ProductOffer | null {
  const name = String(item.display_name ?? item.name ?? "").trim();
  if (!name) return null;
  const price = parsePrice(item.current_price) ?? parsePrice(item.price);
  if (price == null) return null;
  const productId =
    item.flyer_item_id != null
      ? String(item.flyer_item_id)
      : item.id != null
        ? String(item.id)
        : null;
  if (!productId) return null;

  const pack =
    typeof item.description === "string" && item.description.trim()
      ? item.description.trim()
      : undefined;
  const mass = parseMassFromText(`${pack ?? ""} ${name}`);
  const unitPrice = mass && mass.kg > 0 ? Math.round((price / mass.kg) * 100) / 100 : undefined;
  const postal = normalizePostal(opts.postalCode ?? SOBEYS_CLARK_HILDA_POSTAL);
  const image =
    item.clean_image_url ||
    item.x_large_image_url ||
    item.large_image_url ||
    undefined;
  const onSale = Boolean(
    (item.sale_story && String(item.sale_story).trim()) ||
      (item.pre_price_text && String(item.pre_price_text).trim()),
  );

  return {
    retailer: "sobeys",
    storeId: opts.storeId,
    productId,
    name,
    brand: typeof item.brand === "string" && item.brand.trim() ? item.brand.trim() : undefined,
    packageSize: pack,
    upc: item.sku && String(item.sku).trim() ? String(item.sku).trim() : undefined,
    price,
    unitPrice,
    onSale: onSale || undefined,
    availability: "unknown",
    confidence: "estimated",
    checkedAt: new Date().toISOString(),
    sourceUrl:
      item.web_url ||
      item.url ||
      `https://flyers.sobeys.com/flyers/sobeys?type=2&locale=en&postal_code=${postal}`,
    image,
    raw: {
      flyerItemId: productId,
      flyerId: opts.flyerId ?? null,
      flyerValidFrom: opts.validFrom ?? item.valid_from ?? null,
      flyerValidTo: opts.validTo ?? item.valid_to ?? null,
      saleStory: item.sale_story ?? null,
      merchantStoreCode: opts.storeId,
      note:
        "Weekly Ontario flyer JSON — location cookies exist (postal + store 659) but prices are regional, not Clark & Hilda shelf.",
    },
  };
}

function flyerIdentity(doc: SobeysFlyerDocument): string {
  return `${doc.name_identifier ?? ""} ${doc.flyer_type_name ?? ""} ${doc.url ?? ""} ${doc.title ?? ""}`.toLowerCase();
}

function isSkippedBanner(ident: string): boolean {
  return (
    ident.includes("urbanfresh") ||
    ident.includes("urban fresh") ||
    ident.includes("kosher")
  );
}

function isOntarioWeeklyDoc(doc: SobeysFlyerDocument): boolean {
  const ident = flyerIdentity(doc);
  if (isSkippedBanner(ident)) return false;
  return (
    ident.includes("sobeysontario") ||
    ident.includes("weekly flyer - ontario") ||
    ident.includes("ontario")
  );
}

export function extractFlyerItems(payload: unknown): SobeysFlyerItem[] {
  if (Array.isArray(payload)) return payload as SobeysFlyerItem[];
  if (payload && typeof payload === "object") {
    const items = (payload as SobeysFlyerDocument).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

async function listFlyers(postal: string): Promise<FlippFlyer[]> {
  const url = `${FLIPP_FLYERS}?locale=en-ca&postal_code=${encodeURIComponent(postal)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ConnectorError(
      `Sobeys flyer list HTTP ${res.status}`,
      "sobeys",
      "http",
    );
  }
  const json = (await res.json()) as { flyers?: FlippFlyer[] };
  return (json.flyers ?? []).filter((f) => f.merchant_id === MERCHANT_ID);
}

async function loadFlyerDocument(flyerId: string): Promise<SobeysFlyerDocument> {
  const res = await fetch(`${FLYER_DATA}/${flyerId}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ConnectorError(
      `Sobeys flyer_data HTTP ${res.status} for ${flyerId}`,
      "sobeys",
      "http",
    );
  }
  const json = (await res.json()) as SobeysFlyerDocument | SobeysFlyerItem[];
  if (Array.isArray(json)) {
    return { id: flyerId, items: json };
  }
  return json ?? {};
}

function cacheFromDocument(doc: SobeysFlyerDocument, fallbackId: string): SobeysFlyerCache {
  const flyerId = doc.id != null ? String(doc.id) : fallbackId;
  return {
    flyerId,
    validFrom: doc.valid_from ?? null,
    validTo: doc.valid_to ?? null,
    flyerName:
      doc.flyer_type_name ??
      doc.flyer_run_external_name ??
      doc.name_identifier ??
      `flyer ${flyerId}`,
    items: extractFlyerItems(doc),
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadSobeysFlyer(
  postalCode = SOBEYS_CLARK_HILDA_POSTAL,
): Promise<SobeysFlyerCache> {
  if (flyerCache) return flyerCache;
  const postal = normalizePostal(postalCode);
  const flyers = await listFlyers(postal);
  if (!flyers.length) {
    throw new ConnectorError(
      `No Sobeys flyer for postal ${postal}`,
      "sobeys",
      "not_found",
    );
  }

  let fallback: SobeysFlyerCache | null = null;
  for (const listed of flyers) {
    if (listed.id == null) continue;
    const doc = await loadFlyerDocument(String(listed.id));
    const ident = flyerIdentity(doc);
    if (isSkippedBanner(ident)) continue;
    const cache = cacheFromDocument(doc, String(listed.id));
    if (isOntarioWeeklyDoc(doc) && cache.items.length) {
      flyerCache = cache;
      return flyerCache;
    }
    if (!fallback && cache.items.length) fallback = cache;
  }

  if (fallback) {
    flyerCache = fallback;
    return flyerCache;
  }
  throw new ConnectorError(
    `No Sobeys Ontario weekly flyer items for postal ${postal}`,
    "sobeys",
    "not_found",
  );
}

export function resetSobeysFlyerCache(): void {
  flyerCache = null;
}

export function flyerMeta(): Omit<SobeysFlyerCache, "items"> | null {
  if (!flyerCache) return null;
  const { items: _items, ...meta } = flyerCache;
  return meta;
}

export class SobeysConnector implements RetailerConnector {
  readonly id = "sobeys";

  constructor(private readonly postalCode: string = SOBEYS_CLARK_HILDA_POSTAL) {}

  async searchProducts(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    if (!storeId) {
      throw new ConnectorError(
        "Sobeys requires a storeId (merchant_store_code). Clark & Hilda = 659.",
        this.id,
        "no_store_context",
      );
    }

    const flyer = await loadSobeysFlyer(this.postalCode);
    const q = query.trim();
    const scored = flyer.items
      .map((item) => ({ item, score: scoreFlyerItem(item, q) }))
      .filter((x) => x.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);

    return scored
      .map((x) =>
        flyerItemToOffer(x.item, {
          storeId,
          flyerId: flyer.flyerId,
          validFrom: flyer.validFrom,
          validTo: flyer.validTo,
          postalCode: this.postalCode,
        }),
      )
      .filter((o): o is ProductOffer => o != null);
  }

  async getProduct(
    productId: string,
    storeId: string,
  ): Promise<ProductOffer | null> {
    if (!storeId) {
      throw new ConnectorError(
        "Sobeys requires a storeId (merchant_store_code). Clark & Hilda = 659.",
        this.id,
        "no_store_context",
      );
    }
    const flyer = await loadSobeysFlyer(this.postalCode);
    const item = flyer.items.find(
      (i) => String(i.flyer_item_id ?? i.id) === productId,
    );
    if (!item) return null;
    return flyerItemToOffer(item, {
      storeId,
      flyerId: flyer.flyerId,
      validFrom: flyer.validFrom,
      validTo: flyer.validTo,
      postalCode: this.postalCode,
    });
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

export async function discoverSobeysClarkHilda(): Promise<{
  merchantStoreCode: string;
  postalCode: string;
  notes: string[];
}> {
  return {
    merchantStoreCode: SOBEYS_CLARK_HILDA_STORE_CODE,
    postalCode: SOBEYS_CLARK_HILDA_POSTAL,
    notes: [
      "Confirmed from flyers.sobeys.com nearest_stores JSON: Sobeys Clark and Hilda → merchant_store_code 659",
      "Address match: 441 Clark Avenue West, Thornhill, ON L4J 6W7",
      "Flyer widget sets cookies postal_code=L4J6W7 and store_code_2072=659 (location context exists)",
      "Reproducible prices: GET https://flyers.sobeys.com/flyer_data/{id} after listing Ontario weekly flyer for L4J6W7 (merchant_id 2072)",
      "flyer_data prices are regional weekly ads — NOT a Clark & Hilda shelf catalog",
      "Browser Network did not yield a public store-659 shelf+price API; item-details URLs 404 from Node",
      "Voila is Empire online grocery (Vaughan FC mix) and is NOT Clark & Hilda shelf",
      "Thin adapter: flyer item → ProductOffer (estimated) → MasterProduct mapping (staple_winner) → ESTIMATED observation",
    ],
  };
}

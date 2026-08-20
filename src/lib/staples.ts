import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NoFrillsConnector } from "@/connectors/nofrills";
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import type { ProductOffer } from "@/connectors/types";
import { isEggPackStaple } from "@/domain/egg-pack";
import { pickBestOffer, staplePickQuery } from "@/domain/matching";
import { extractBarcodes } from "@/domain/fair-compare";
import {
  canonicalizeMatchMode,
  confirmedStoreSku,
  inferUnit,
  stapleWithClientOverride,
  toLegacyMatchMode,
  type ProductOverride,
} from "@/domain/restaurant-product";
import { offerFailsStapleOfferFilters, categoryBSearchQueries, retailerTaxonomyText } from "@/domain/catalog-normalize";
import { extractRetailerImage } from "@/lib/product-image";
import { RECEIPT_STAPLE_IDS } from "@/lib/receipt-staple-ids";
import {
  isLockedIdentityLink,
  loadRetailerMappings,
  lookupConfirmed,
  saveRetailerMappings,
  type RetailerMappingStore,
  type RetailerSkuLink,
} from "@/lib/retailer-mappings";
import { offerMatchesRetailerSku } from "@/domain/compare-resolve";
import {
  applyShelfOverrideToOffer,
  loadShelfOverrides,
  shelfOverrideFor,
} from "@/lib/shelf-overrides";
import {
  mergeDistinctPackSizes,
  splitOfferAndAlternates,
} from "@/domain/pack-size-candidates";
import {
  isActualCategoryBOffer,
  isEachSoldOffer,
  offerMassKg,
  samePackedItemCandidates,
  typicalEachGramsOf,
  usesCategoryBIdentity,
} from "@/domain/same-packed-item";
import {
  type CompareUnit,
  type OfferStatus,
  ageHours,
  compareUnitLabel,
  formatAge,
  isComparablePackKg,
  offerFailsPlausibleShelfPrice,
  sanityCheckOffer,
} from "@/domain/sanity";
import {
  defaultWeightUnit,
  formatMass,
  formatMoneyPerWeight,
  formatMoneyPerEach,
  parseMassFromText,
  parseCountPack,
  parsePackCount,
  priceByPackCount,
  resolveUnitPrices,
  round2,
  weightUnitLabel,
  type WeightPriceUnit,
} from "@/domain/units";

/** Produce sold by weight — show $/kg (WM) or $/lb (NF). Not for packaged milk/dry. */
const PRODUCE_WEIGHT_IDS = new Set([
  "red_peppers",
  "red_peppers_kg",
  "sweet_potatoes",
  "sweet_potatoes_kg",
  "pineapple",
  "pineapple_whole",
  "pear_bosc_kg",
  "eggplant_kg",
  "tomato_gh_red_kg",
  "bananas_kg",
  "kiwi_kg",
  "garlic_1kg",
  "cucumber_english",
  "bartlett_pears_kg",
  "granny_smith_kg",
  "jalapeno_peppers_kg",
  "red_grapes_kg",
  "yellow_peppers_case",
  "yellow_onions",
  "red_onions",
  "tomato",
]);

/** Frozen bags — pick cheapest $/kg, any brand; show unit price for fair bag-size compare. */
const FROZEN_BAG_IDS = new Set([
  "frozen_apple",
  "frozen_banana",
  "frozen_blueberry",
  "frozen_strawberry",
  "frozen_spinach",
  "frozen_pineapple",
  "butternut_squash_frozen",
  "frozen_carrots",
]);

/** Packaged produce — compare by shelf pack, no kg/lb conversion UI. */
const PACK_COMPARE_IDS = new Set([
  "tomatoes",
  "tomatoes_grape",
  "lemons_2lb",
  "blueberries",
  "strawberries",
  "golden_berries",
  "gooseberries",
  "limes_lrg",
  "mushrooms_sliced",
  "pomegranates_30s",
  "yukon_potatoes_10lb",
  "cantaloupe",
  "honeydew_melons",
  "celery",
  "cilantro",
  "parsley",
  "red_radish",
]);

export function isProduceItem(item: StapleItem): boolean {
  return item.category === "produce" || PRODUCE_IDS.has(item.id);
}

/** Only weighed produce gets kg/lb unit-price display. */
export function isProduceWeightItem(item: StapleItem): boolean {
  return PRODUCE_WEIGHT_IDS.has(item.id) || FROZEN_BAG_IDS.has(item.id);
}

/** Loose produce / protein sold by weight — user can enter grams when selected. */
const SOLD_BY_WEIGHT_IDS = new Set([
  "red_peppers",
  "red_peppers_kg",
  "sweet_potatoes",
  "sweet_potatoes_kg",
  "pear_bosc_kg",
  "eggplant_kg",
  "tomato_gh_red_kg",
  "bananas_kg",
  "kiwi_kg",
  "garlic_1kg",
  "bartlett_pears_kg",
  "granny_smith_kg",
  "jalapeno_peppers_kg",
  "red_grapes_kg",
  "yellow_peppers_case",
  "yellow_onions",
  "red_onions",
  "tomato",
]);

/** Shell-egg cartons — fair compare is $/egg. Quantity is eggs, not packs. */
export function isEggPackItem(item: { id: string; category?: string }): boolean {
  return isEggPackStaple(item);
}

/**
 * Dozen/Large Eggs staple: 12, 18, or 30-count cartons (and Nx those cases).
 * Extra Large / Medium are excluded by name filters, not by count.
 * Grayridge receipt lock stays 18-count only.
 */
export function eggCartonCountOk(
  item: { id: string },
  name: string,
  packageSize?: string,
): boolean {
  const parsed = parseCountPack(name, packageSize);
  const n = parsed?.innerCount ?? parsePackCount(name, packageSize);
  if (item.id === "large_eggs_dozen") return n === 12 || n === 18 || n === 30;
  if (item.id === "grayridge_eggs") return n === 18;
  return true;
}

/** When $/egg is close, keep the bigger Large carton / case. */
export function preferLargerEggPack(item: { id: string }): boolean {
  return item.id === "grayridge_eggs" || item.id === "large_eggs_dozen";
}

export function isSoldByWeightItem(item: StapleItem): boolean {
  return SOLD_BY_WEIGHT_IDS.has(item.id);
}

export interface StapleItem {
  id: string;
  label: string;
  queries: string[];
  unavailableAtWalmart?: boolean;
  preferredProductId?: string;
  targetMassKg?: number;
  /** Expected retail pack mass for sanity (milk 2L ≈ 2) */
  expectedPackKg?: number;
  minPlausiblePrice?: number;
  maxPlausiblePrice?: number;
  image?: string;
  notes?: string;
  mustIncludeAny?: string[];
  /** All of these substrings must appear (e.g. frozen + fruit). */
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
  /** Extra impostor words for this staple (category B produce). */
  rejectNameIncludes?: string[];
  /** Average grams for a 1-ea produce item with no pack mass. */
  typicalEachGrams?: number;
  preferNameIncludes?: string[];
  /**
   * preferred = lock brand/SKU when set (dairy, branded dry).
   * cheapest = produce: any brand OK, pick lowest $/kg (or shelf) in-store.
   */
  matchMode?: "preferred" | "cheapest" | "exact" | "cheapest_equivalent";
  purchaseStrategy?: "exact_need" | "stock_up";
  defaultAmount?: number;
  unit?: "g" | "kg" | "ml" | "l" | "ea" | "pack";
  tolerancePercent?: number;
  maximumAmount?: number;
  matchRules?: {
    productType?: string;
    form?: string;
    variant?: string;
    mustIncludeAll?: string[];
    mustIncludeAny?: string[];
    mustNotInclude?: string[];
  };
  category?: string;
  /** Added from in-app search; shown alongside PINNED_IDS. */
  custom?: boolean;
}

/** Produce / fruit — brand irrelevant; cheapest matching unit wins. */
export const PRODUCE_IDS = new Set([
  "tomatoes_grape",
  "tomatoes",
  "lemons_2lb",
  "pear_bosc_kg",
  "eggplant_kg",
  "tomato_gh_red_kg",
  "red_peppers",
  "red_peppers_kg",
  "sweet_potatoes",
  "sweet_potatoes_kg",
  "pineapple",
  "pineapple_whole",
  "bananas_kg",
  "kiwi_kg",
  "cucumber_english",
  "garlic_1kg",
  "blueberries",
  "strawberries",
]);

export function itemPreferredUpc(item: StapleItem): string | undefined {
  return extractBarcodes(...item.queries, item.preferredProductId)[0];
}

export function resolveMatchMode(
  item: StapleItem,
): "preferred" | "cheapest" {
  const canonical = canonicalizeMatchMode(item.matchMode);
  if (canonical) return toLegacyMatchMode(canonical);
  if (
    item.category === "produce" ||
    item.category === "frozen" ||
    item.category === "eggs" ||
    PRODUCE_IDS.has(item.id) ||
    FROZEN_BAG_IDS.has(item.id) ||
    isEggPackItem(item)
  ) {
    return "cheapest";
  }
  return "preferred";
}

/** Category B: grams purchase is allowed. Not eggs, not category A. */
export function usesNeededWeightPick(item: StapleItem): boolean {
  return resolveMatchMode(item) === "cheapest" && !isEggPackItem(item);
}

export function isFrozenBagItem(item: StapleItem): boolean {
  return item.category === "frozen" || FROZEN_BAG_IDS.has(item.id);
}

/** Clamshells / each produce — cheapest pack by $/kg, pack qty on the card. */
export function isPackedProduceItem(item: StapleItem): boolean {
  if (isSoldByWeightItem(item) || isEggPackItem(item)) return false;
  if (isFrozenBagItem(item)) return false;
  return (
    item.category === "produce" ||
    PACK_COMPARE_IDS.has(item.id) ||
    PRODUCE_IDS.has(item.id)
  );
}

export function defaultNeededGrams(item: StapleItem): number {
  if (isSoldByWeightItem(item)) return 1000;
  if (usesNeededWeightPick(item)) return 500;
  return 0;
}

/**
 * Grams for packed SKU pick / purchase plan.
 * Loose produce does not use this (sold by kg). Packed and frozen only
 * when the user typed grams — never inject 500 g on the homepage.
 */
export function explicitNeededGrams(
  item: StapleItem,
  rawGrams?: number | null,
): number | undefined {
  if (isSoldByWeightItem(item) || isEggPackItem(item)) return undefined;
  if (!usesNeededWeightPick(item)) return undefined;
  if (rawGrams != null && Number.isFinite(rawGrams) && rawGrams > 0) {
    return rawGrams;
  }
  return undefined;
}

export interface CatalogOffer {
  productId: string;
  name: string;
  price: number;
  packageSize?: string;
  parsedMassKg?: number;
  brand?: string;
  unitPrice?: number;
  wasPrice?: number;
  onSale?: boolean;
  availability?: string;
  confidence?: string;
  checkedAt?: string;
  sourceUrl?: string;
  /** Retailer product photo (Rapid CDN for category A). */
  image?: string;
  /** Category B: Shopify/PCX type + department tags from the live hit. */
  taxonomyText?: string;
}

export interface MatchLogEntry {
  at: string;
  itemId: string;
  retailer: string;
  queries: string[];
  accepted?: { productId: string; name: string; price: number };
  rejected: Array<{ productId?: string; name?: string; price?: number; reason: string }>;
  status: OfferStatus;
}

export type ConfirmedMap = Record<
  string,
  { productId: string; confirmedAt: string; label?: string }
>;

export const PINNED_IDS = [
  "simply_egg_whites",
  "large_eggs_dozen",
  "tomatoes_grape",
  "lemons_2lb",
  "pear_bosc_kg",
  "eggplant_kg",
  "tomato_gh_red_kg",
  "oat_beverage_original",
  "red_peppers_kg",
  "sweet_potatoes_kg",
  "pineapple_whole",
  "almond_original",
  "bananas_kg",
  "kiwi_kg",
  "cucumber_english",
  "garlic_1kg",
  "blueberries",
  "strawberries",
  "milk_2pct_2l",
  "homo_milk_2l",
  "butter_454g",
  "orange_juice_pulp",
  "realemon_440ml",
  "jello_vanilla_instant",
  "ziploc_sandwich",
  "frozen_apple",
  "frozen_banana",
  "frozen_blueberry",
  "frozen_strawberry",
  "frozen_spinach",
  "ice_cubes",
] as const;

export { RECEIPT_STAPLE_IDS };

export function isShownStaple(item: { id: string; custom?: boolean }): boolean {
  return (
    item.custom === true ||
    (PINNED_IDS as readonly string[]).includes(item.id) ||
    (RECEIPT_STAPLE_IDS as readonly string[]).includes(item.id)
  );
}

export function applyRemovedStapleIds<T extends { id: string }>(
  items: T[],
  removedIds: Iterable<string>,
): T[] {
  const gone = new Set(removedIds);
  return items.filter((item) => !gone.has(item.id));
}

export const CACHE_STALE_HOURS = Number(
  process.env.STAPLES_CACHE_STALE_HOURS ?? "72",
);

const DATA_CATALOG = path.join(process.cwd(), "data", "catalog");

export type ReceiptSkuMap = {
  updatedAt: string;
  preferredByStapleId: Record<
    string,
    { productId?: string; upc?: string; store: string; name: string }
  >;
};

export async function loadReceiptSkuMap(): Promise<ReceiptSkuMap | null> {
  try {
    const raw = await readFile(
      path.join(DATA_CATALOG, "receipt_sku_map.json"),
      "utf8",
    );
    return JSON.parse(raw) as ReceiptSkuMap;
  } catch {
    return null;
  }
}

const CUSTOM_STAPLES = path.join(process.cwd(), "config", "custom-staples.json");
const CAFE_STAPLES = path.join(process.cwd(), "config", "cafe-staples.json");

export async function loadCustomStaples(): Promise<StapleItem[]> {
  try {
    const raw = await readFile(CUSTOM_STAPLES, "utf8");
    const data = JSON.parse(raw) as { items?: StapleItem[] };
    return Array.isArray(data.items) ? data.items.filter((i) => i?.id) : [];
  } catch {
    return [];
  }
}

export async function saveCustomStaples(items: StapleItem[]): Promise<void> {
  await mkdir(path.dirname(CUSTOM_STAPLES), { recursive: true });
  await writeFile(
    CUSTOM_STAPLES,
    JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2),
    "utf8",
  );
}

export async function saveCustomStaple(item: StapleItem): Promise<void> {
  const items = await loadCustomStaples();
  const idx = items.findIndex((x) => x.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  await saveCustomStaples(items);
}

export async function deleteStaplesCompletely(ids: string[]): Promise<{
  deleted: string[];
  skipped: string[];
}> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return { deleted: [], skipped: [] };

  const raw = await readFile(CAFE_STAPLES, "utf8");
  const cafe = JSON.parse(raw) as { items: StapleItem[]; [k: string]: unknown };
  const custom = await loadCustomStaples();
  const known = new Set(
    [...cafe.items, ...custom].map((item) => item.id).filter(Boolean),
  );
  const deleted = unique.filter((id) => known.has(id));
  const skipped = unique.filter((id) => !known.has(id));
  if (!deleted.length) return { deleted, skipped };

  const gone = new Set(deleted);
  cafe.items = cafe.items.filter((item) => !gone.has(item.id));
  await mkdir(path.dirname(CAFE_STAPLES), { recursive: true });
  await writeFile(CAFE_STAPLES, JSON.stringify(cafe, null, 2) + "\n", "utf8");
  await saveCustomStaples(custom.filter((item) => !gone.has(item.id)));

  const wm = await loadWalmartCatalog();
  if (wm) {
    wm.items = wm.items.filter((row) => !gone.has(row.id));
    await saveWalmartCatalog(wm);
  }
  const nf = await loadNoFrillsCatalog();
  if (nf) {
    nf.items = nf.items.filter((row) => !gone.has(row.id));
    await saveNoFrillsCatalog(nf);
  }
  const { loadSobeysCatalog, saveSobeysCatalog } = await import(
    "@/lib/sobeys-catalog"
  );
  const sobeys = await loadSobeysCatalog();
  if (sobeys) {
    sobeys.items = sobeys.items.filter((row) => !gone.has(row.id));
    await saveSobeysCatalog(sobeys);
  }
  const { loadWholesaleClubCatalog, saveWholesaleClubCatalog } = await import(
    "@/lib/wholesaleclub-catalog"
  );
  const wc = await loadWholesaleClubCatalog();
  if (wc) {
    wc.items = wc.items.filter((row) => !gone.has(row.id));
    await saveWholesaleClubCatalog(wc);
  }
  const { loadMvrCatalog, saveMvrCatalog } = await import("@/lib/mvr-catalog");
  const mvr = await loadMvrCatalog();
  if (mvr) {
    mvr.items = mvr.items.filter((row) => !gone.has(row.id));
    await saveMvrCatalog(mvr);
  }

  const confirmed = await loadConfirmed();
  let confirmedChanged = false;
  for (const id of deleted) {
    if (confirmed[id]) {
      delete confirmed[id];
      confirmedChanged = true;
    }
  }
  if (confirmedChanged) await saveConfirmed(confirmed);

  try {
    const mappings = await loadRetailerMappings();
    let mappingChanged = false;
    for (const id of deleted) {
      if (mappings.products[id]) {
        delete mappings.products[id];
        mappingChanged = true;
      }
    }
    if (mappingChanged) await saveRetailerMappings(mappings);
  } catch {
    /* mappings optional */
  }

  return { deleted, skipped };
}

export async function upsertWalmartCatalogItem(input: {
  id: string;
  label?: string;
  status: OfferStatus;
  offer: CatalogOffer | null;
  image?: string;
  notes?: string;
  alternates?: CatalogOffer[];
}): Promise<void> {
  const existing =
    (await loadWalmartCatalog()) ??
    ({
      type: "walmart-staples-catalog",
      checkedAt: new Date().toISOString(),
      items: [],
    } as NonNullable<Awaited<ReturnType<typeof loadWalmartCatalog>>>);

  const idx = existing.items.findIndex((x) => x.id === input.id);
  const prev = idx >= 0 ? existing.items[idx] : undefined;
  const row = {
    id: input.id,
    label: input.label,
    status: input.status,
    offer: input.offer,
    image: input.image,
    notes: input.notes,
    alternates: input.alternates ?? prev?.alternates ?? [],
  };
  if (idx >= 0) existing.items[idx] = { ...prev, ...row };
  else existing.items.push(row);
  existing.checkedAt = new Date().toISOString();
  await saveWalmartCatalog(existing);
}

export async function loadStaplesConfig(): Promise<{
  store: { externalStoreId: string; name: string; address: string };
  items: StapleItem[];
}> {
  const raw = await readFile(CAFE_STAPLES, "utf8");
  const cfg = JSON.parse(raw) as {
    store: { externalStoreId: string; name: string; address: string };
    items: StapleItem[];
  };
  const custom = await loadCustomStaples();
  const seen = new Set(cfg.items.map((i) => i.id));
  for (const item of custom) {
    if (seen.has(item.id)) continue;
    cfg.items.push(item);
    seen.add(item.id);
  }
  const receipts = await loadReceiptSkuMap();
  if (receipts?.preferredByStapleId) {
    for (const item of cfg.items) {
      // Produce: never lock receipt brand/SKU — cheapest in-store wins
      if (resolveMatchMode(item) === "cheapest") continue;
      const pref = receipts.preferredByStapleId[item.id];
      if (!pref) continue;
      if (pref.productId && !item.preferredProductId) {
        item.preferredProductId = pref.productId;
      }
      if (pref.upc) {
        const upcQ = pref.upc;
        if (!item.queries.includes(upcQ)) {
          item.queries = [upcQ, ...item.queries];
        }
      }
    }
  }
  return cfg;
}

export async function loadWalmartCatalog(): Promise<{
  checkedAt?: string;
  items: Array<{
    id: string;
    status: string;
    offer: CatalogOffer | null;
    image?: string;
    rejected?: unknown;
    notes?: string;
    alternates?: CatalogOffer[];
  }>;
} | null> {
  try {
    const raw = await readFile(
      path.join(DATA_CATALOG, "walmart_5831_latest.json"),
      "utf8",
    );
    const catalog = JSON.parse(raw) as {
      checkedAt?: string;
      items: Array<{
        id: string;
        status: string;
        offer: CatalogOffer | null;
        image?: string;
        rejected?: unknown;
        notes?: string;
        alternates?: CatalogOffer[];
      }>;
    };
    const shelf = await loadShelfOverrides();
    catalog.items = catalog.items.map((row) => {
      const override = shelfOverrideFor(shelf, "walmart_5831", row.id);
      if (!override) return row;
      return {
        ...row,
        offer: applyShelfOverrideToOffer(row.offer, override) ?? null,
        alternates: (row.alternates ?? []).map(
          (alt) => applyShelfOverrideToOffer(alt, override) ?? alt,
        ),
      };
    });
    return catalog;
  } catch {
    return null;
  }
}

export async function saveWalmartCatalog(catalog: unknown): Promise<void> {
  try {
    await mkdir(DATA_CATALOG, { recursive: true });
    await writeFile(
      path.join(DATA_CATALOG, "walmart_5831_latest.json"),
      JSON.stringify(catalog, null, 2),
      "utf8",
    );
  } catch {
    // Serverless read-only FS
  }
}

export type StoreCatalog = {
  checkedAt?: string;
  updatedAt?: string;
  storeId?: string;
  items: Array<{
    id: string;
    status: string;
    offer: CatalogOffer | null;
    image?: string;
    notes?: string;
    alternates?: CatalogOffer[];
  }>;
};

export async function loadNoFrillsCatalog(): Promise<StoreCatalog | null> {
  try {
    const raw = await readFile(
      path.join(DATA_CATALOG, "nofrills_3660_latest.json"),
      "utf8",
    );
    return JSON.parse(raw) as StoreCatalog;
  } catch {
    return null;
  }
}

export async function saveNoFrillsCatalog(catalog: unknown): Promise<void> {
  try {
    await mkdir(DATA_CATALOG, { recursive: true });
    await writeFile(
      path.join(DATA_CATALOG, "nofrills_3660_latest.json"),
      JSON.stringify(catalog, null, 2),
      "utf8",
    );
  } catch {
    // Serverless read-only FS
  }
}

/** Merge one No Frills offer into the on-disk cache (avoids re-hitting NF API). */
export async function upsertNoFrillsCatalogItem(input: {
  id: string;
  label?: string;
  status: OfferStatus;
  offer: CatalogOffer | null;
  notes?: string;
  alternates?: CatalogOffer[];
}): Promise<void> {
  const existing =
    (await loadNoFrillsCatalog()) ??
    ({
      storeId: "3660",
      checkedAt: new Date().toISOString(),
      items: [],
    } as StoreCatalog);

  const idx = existing.items.findIndex((x) => x.id === input.id);
  const row = {
    id: input.id,
    label: input.label,
    status: input.status,
    offer: input.offer,
    notes: input.notes,
    alternates: input.alternates,
  };
  if (idx >= 0) {
    const prev = existing.items[idx];
    existing.items[idx] = {
      ...prev,
      ...row,
      alternates: input.alternates ?? prev.alternates,
    };
  } else existing.items.push(row);

  existing.checkedAt = new Date().toISOString();
  existing.updatedAt = existing.checkedAt;
  await saveNoFrillsCatalog(existing);
}

export async function loadConfirmed(): Promise<ConfirmedMap> {
  try {
    const raw = await readFile(
      path.join(DATA_CATALOG, "confirmed.json"),
      "utf8",
    );
    const data = JSON.parse(raw) as { confirmed?: ConfirmedMap } & ConfirmedMap;
    return data.confirmed ?? (data as ConfirmedMap);
  } catch {
    return {};
  }
}

export async function saveConfirmed(map: ConfirmedMap): Promise<void> {
  try {
    await mkdir(DATA_CATALOG, { recursive: true });
    await writeFile(
      path.join(DATA_CATALOG, "confirmed.json"),
      JSON.stringify(
        { updatedAt: new Date().toISOString(), confirmed: map },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Vercel / read-only FS — confirmation is in-memory for the request only
  }
}

export async function appendMatchLog(entries: MatchLogEntry[]): Promise<string> {
  const id = `match-${Date.now()}`;
  try {
    await mkdir(path.join(process.cwd(), "data", "runs"), { recursive: true });
    await writeFile(
      path.join(process.cwd(), "data", "runs", `${id}.json`),
      JSON.stringify({ id, at: new Date().toISOString(), entries }, null, 2),
      "utf8",
    );
  } catch {
    // Serverless: skip disk log; still return id for UI
  }
  return id;
}

function matchQueryForPick(item: StapleItem): string {
  return staplePickQuery(item, resolveMatchMode(item) === "cheapest");
}

function passesFilters(
  offer: {
    productId?: string;
    name: string;
    brand?: string;
    packageSize?: string;
    sourceUrl?: string;
    parsedMassKg?: number;
    raw?: unknown;
  },
  item: StapleItem,
): boolean {
  if (offerFailsStapleOfferFilters(item, offer) != null) {
    return false;
  }
  if (!eggCartonCountOk(item, offer.name, offer.packageSize)) {
    return false;
  }
  if (!usesCategoryBIdentity(item)) return true;
  return isActualCategoryBOffer(item, {
    productId: offer.productId ?? offer.name,
    name: offer.name,
    brand: offer.brand,
    packageSize: offer.packageSize,
    parsedMassKg: offer.parsedMassKg,
    sourceUrl: offer.sourceUrl,
    raw: offer.raw,
  });
}

function expectedPackFor(item: StapleItem): number | undefined {
  if (item.expectedPackKg != null) return item.expectedPackKg;
  if (item.targetMassKg != null) return item.targetMassKg;
  if (
    item.id === "milk_2pct" ||
    item.id === "homo_milk" ||
    item.id === "milk_2pct_2l" ||
    item.id === "milk_1pct_2l" ||
    item.id === "homo_milk_2l"
  )
    return 2;
  if (item.id === "oat_beverage_original") return 1.75;
  return undefined;
}

export function evaluateOfferStatus(
  item: StapleItem,
  offer: CatalogOffer | null | undefined,
  opts?: { unavailable?: boolean; catalogStatus?: string },
): { status: OfferStatus; reason?: string; ageHours?: number; ageLabel: string | null } {
  if (opts?.unavailable || item.unavailableAtWalmart) {
    return { status: "unavailable", reason: "not sold at this store", ageLabel: null };
  }
  if (!offer) {
    const st = opts?.catalogStatus;
    if (st === "wrong_pack" || st === "wrong_size") {
      return { status: st, reason: "rejected by catalog", ageLabel: null };
    }
    return { status: "no_match", reason: "no offer", ageLabel: null };
  }
  if (offer.availability === "out_of_stock") {
    return {
      status: "unavailable",
      reason: "not on the shelf at this store",
      ageLabel: formatAge(ageHours(offer.checkedAt)),
    };
  }

  const sanity = sanityCheckOffer({
    itemId: item.id,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    unitPrice: offer.unitPrice,
    expectedPackKg: expectedPackFor(item),
    allowCompose: expectedPackFor(item) != null,
    minPlausiblePrice: item.minPlausiblePrice,
    maxPlausiblePrice: item.maxPlausiblePrice,
    checkedAt: offer.checkedAt,
    staleAfterHours: CACHE_STALE_HOURS,
  });

  return {
    status: sanity.status,
    reason: sanity.reason,
    ageHours: sanity.ageHours ?? ageHours(offer.checkedAt),
    ageLabel: formatAge(sanity.ageHours ?? ageHours(offer.checkedAt)),
  };
}

export type StapleRefreshOpts = {
  /** Re-search from queries/filters; do not pin the previous mapped SKU. */
  skipIdentityLock?: boolean;
  /** Confirmed in-app SKU — fetch even when the mapping is needs_review. */
  pinSku?: string | null;
};

export function refreshSkipIdentityLock(
  item: StapleItem,
  opts?: StapleRefreshOpts,
  pinSku?: string | null,
): boolean {
  if (pinSku) return false;
  if (!opts?.skipIdentityLock) return false;
  return resolveMatchMode(item) === "cheapest";
}

/** Live PCX hits that pass staple filters. Category B uses the full pool as pack sizes. */
export async function searchNoFrillsPool(
  item: StapleItem,
  log?: MatchLogEntry,
  opts?: StapleRefreshOpts,
): Promise<ProductOffer[]> {
  const nf = new NoFrillsConnector();
  const seen = new Map<string, ProductOffer>();
  const mappings = await loadRetailerMappings();
  const nfLink = mappings.products[item.id]?.retailers.nofrills;
  const lockedNfSku =
    opts?.pinSku ||
    (refreshSkipIdentityLock(item, opts, opts?.pinSku)
      ? null
      : nfLink && isLockedIdentityLink(nfLink)
        ? nfLink.retailerProductId
        : null);
  const queries = categoryBSearchQueries(item, 6);
  if (log) log.queries = lockedNfSku ? [lockedNfSku, ...queries] : [...queries];

  if (lockedNfSku) {
    try {
      const direct = await nf.getProduct(lockedNfSku, "3660");
      if (direct) seen.set(direct.productId, direct);
    } catch (e) {
      log?.rejected.push({
        productId: lockedNfSku,
        reason: `locked SKU: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`,
      });
    }
  }

  for (const q of queries) {
    try {
      const hits = await nf.searchProducts(q, "3660");
      for (const h of hits) {
        if (!seen.has(h.productId)) seen.set(h.productId, h);
      }
    } catch (e) {
      log?.rejected.push({
        reason: `search error: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`,
      });
    }
  }

  const all = [...seen.values()];
  for (const o of all) {
    if (!passesFilters(o, item)) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason:
          offerFailsStapleOfferFilters(item, o) != null
            ? "filter mustInclude/mustNotInclude"
            : "not the actual category B item",
      });
    }
  }

  return all.filter((o) => {
    if (lockedNfSku && o.productId === lockedNfSku) return true;
    if (!passesFilters(o, item)) return false;
    const priceFail = offerFailsPlausibleShelfPrice(item, o);
    if (priceFail) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: priceFail,
      });
      return false;
    }
    return true;
  });
}

export function pickStapleSearchWinner(
  item: StapleItem,
  pool: ProductOffer[],
  log?: MatchLogEntry,
  preferredId?: string | null,
): ProductOffer | null {
  const usable = pool.filter((o) =>
    eggCartonCountOk(item, o.name, o.packageSize),
  );
  let best: ProductOffer | null = null;
  if (usable.length) {
    const mode = resolveMatchMode(item);
    best =
      pickBestOffer(
        usable,
        matchQueryForPick(item),
        mode === "cheapest" ? undefined : (preferredId ?? item.preferredProductId),
        {
          targetMassKg: item.targetMassKg ?? expectedPackFor(item),
          mode,
          preferNameIncludes: item.preferNameIncludes,
          byEach: isEggPackItem(item),
          preferLargerPack: preferLargerEggPack(item),
          preferredUpc: itemPreferredUpc(item),
          requireQueryMatch: false,
        },
      ) ?? (mode === "cheapest" ? usable[0] ?? null : null);
  }

  if (best) {
    const sanity = sanityCheckOffer({
      itemId: item.id,
      name: best.name,
      price: best.price,
      packageSize: best.packageSize,
      unitPrice: best.unitPrice,
      expectedPackKg: expectedPackFor(item),
      allowCompose: expectedPackFor(item) != null,
      minPlausiblePrice: item.minPlausiblePrice,
      maxPlausiblePrice: item.maxPlausiblePrice,
      checkedAt: best.checkedAt,
    });
    if (!sanity.ok && sanity.status !== "stale") {
      log?.rejected.push({
        productId: best.productId,
        name: best.name,
        price: best.price,
        reason: sanity.reason ?? sanity.status,
      });
      const expected = expectedPackFor(item);
      const packKg = sanity.inferredPackKg;
      const keepDifferentPack =
        sanity.status === "wrong_size" &&
        isComparablePackKg(packKg, expected);
      if (!keepDifferentPack) {
        if (log) log.status = sanity.status;
        return null;
      }
      if (log) {
        log.accepted = {
          productId: best.productId,
          name: best.name,
          price: best.price,
        };
        log.status = "ok";
      }
      return best;
    }
    if (log) {
      log.accepted = {
        productId: best.productId,
        name: best.name,
        price: best.price,
      };
      log.status = sanity.status;
    }
    return best;
  }
  if (log) {
    log.status = "no_match";
    log.rejected.push({ reason: "no relevant hits after filters" });
  }
  return null;
}

export async function searchNoFrills(
  item: StapleItem,
  log?: MatchLogEntry,
): Promise<ProductOffer | null> {
  const mappings = await loadRetailerMappings();
  const nfLink = mappings.products[item.id]?.retailers.nofrills;
  const lockedNfSku =
    nfLink && isLockedIdentityLink(nfLink) ? nfLink.retailerProductId : null;
  const pool = await searchNoFrillsPool(item, log);
  return pickStapleSearchWinner(item, pool, log, lockedNfSku);
}

/** Search Walmart #5831 by staple queries. Category A and B both use this for fallbacks. */
export async function searchWalmartQueryPool(
  item: StapleItem,
  log?: MatchLogEntry,
): Promise<ProductOffer[]> {
  if (item.unavailableAtWalmart) return [];
  let wm: ReturnType<typeof createWalmartConnector>;
  try {
    wm = createWalmartConnector("L4J0A7");
  } catch (e) {
    log?.rejected.push({
      reason: e instanceof Error ? e.message.slice(0, 120) : String(e),
    });
    return [];
  }
  const seen = new Map<string, ProductOffer>();
  const queries = categoryBSearchQueries(item, 6);
  if (log) log.queries = [...queries];
  for (const q of queries) {
    try {
      const hits = await wm.searchProducts(q, "5831");
      for (const h of hits) {
        if (!seen.has(h.productId)) seen.set(h.productId, h);
      }
    } catch (e) {
      log?.rejected.push({
        reason: `search error: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`,
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const shelf = await loadShelfOverrides();
  const ov = shelfOverrideFor(shelf, "walmart_5831", item.id);
  return [...seen.values()].filter((o) => {
    if (!passesFilters(o, item)) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: "name filter",
      });
      return false;
    }
    if (
      ov?.availability === "out_of_stock" &&
      ov.productId &&
      offerMatchesRetailerSku(o, ov.productId)
    ) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: "not on the shelf — skip for nearest alternate",
      });
      return false;
    }
    if (offerFailsPlausibleShelfPrice(item, o)) return false;
    return true;
  });
}

/** Category B pack-size expand. Same search as fallback, cheapest staples only. */
export async function searchWalmartPackPool(
  item: StapleItem,
  log?: MatchLogEntry,
): Promise<ProductOffer[]> {
  if (resolveMatchMode(item) !== "cheapest") return [];
  return searchWalmartQueryPool(item, log);
}

export interface SummarizedOffer {
  name: string;
  productId: string;
  shelfPrice: number;
  /** Fair compare amount (1 kg for weight items; pack/composed otherwise). */
  lineTotal: number | null;
  pack?: string;
  note?: string;
  confidence?: string;
  compareUnit: CompareUnit;
  compareUnitLabel: string;
  status: OfferStatus;
  statusReason?: string;
  /** Always present when mass/unit known — for apples-to-apples delta. */
  pricePerKg?: number;
  pricePerLb?: number;
  /** Eggs: dollars per egg. Not stored in pricePerKg. */
  pricePerEach?: number;
  /** Store-native display: Walmart $/kg, No Frills $/lb. */
  nativeUnit?: WeightPriceUnit;
  nativeUnitPrice?: number;
  nativeUnitLabel?: string;
  nativeUnitPriceLabel?: string;
}

export function summarizeOffer(
  item: StapleItem,
  offer: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    parsedMassKg?: number;
    unitPrice?: number;
    confidence?: string;
    checkedAt?: string;
    retailer?: string;
  } | null,
  qty = 1,
  retailer: "walmart_ca" | "no_frills" | "wholesale_club" | "mvr" = "walmart_ca",
): SummarizedOffer | null {
  if (!offer) return null;

  const displayUnit = defaultWeightUnit(retailer);
  const asProduct: ProductOffer = {
    retailer,
    storeId: "x",
    productId: offer.productId,
    name: offer.name,
    packageSize: offer.packageSize,
    price: offer.price,
    unitPrice: offer.unitPrice,
    availability: "unknown",
    confidence: "exact",
    checkedAt: offer.checkedAt ?? new Date().toISOString(),
  };

  const byWeight = isProduceWeightItem(item);
  const eggPack = isEggPackItem(item);
  const eggParsed = eggPack
    ? parseCountPack(offer.name, offer.packageSize)
    : null;
  const eggCount = eggParsed?.totalCount ?? null;
  const eggInner = eggParsed?.innerCount ?? null;
  const pricePerEgg =
    eggCount && eggCount > 0 ? round2(offer.price / eggCount) : null;
  const eggFields =
    pricePerEgg != null
      ? {
          pricePerEach: pricePerEgg,
          nativeUnitPrice: pricePerEgg,
          nativeUnitLabel: `за ${eggCount} шт`,
          nativeUnitPriceLabel: formatMoneyPerEach(pricePerEgg),
        }
      : {};
  const units = byWeight
    ? resolveUnitPrices(asProduct, {
        displayUnit,
        // Only force sold-by-weight when we cannot derive from pack mass
        // (e.g. Loblaw *_KG / *_LB with no size). Singles like "240 g pepper"
        // must use pack math — shelf $ is NOT already $/kg.
        forceSoldByWeight: !(
          parseMassFromText(offer.packageSize ?? "") ??
          parseMassFromText(offer.name)
        ),
      })
    : null;

  // kg/lb labels only for produce — never milk, flour, eggs, etc.
  const unitFields =
    byWeight && units
      ? {
          pricePerKg: units.pricePerKg,
          pricePerLb: units.pricePerLb,
          nativeUnit: units.nativeUnit,
          nativeUnitPrice: units.nativePrice,
          nativeUnitLabel: weightUnitLabel(units.nativeUnit),
          nativeUnitPriceLabel: formatMoneyPerWeight(
            units.nativePrice,
            units.nativeUnit,
          ),
        }
      : eggFields;

  const sanity = sanityCheckOffer({
    itemId: item.id,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    unitPrice: offer.unitPrice,
    expectedPackKg: expectedPackFor(item),
    allowCompose: expectedPackFor(item) != null,
    minPlausiblePrice: item.minPlausiblePrice,
    maxPlausiblePrice: item.maxPlausiblePrice,
    checkedAt: offer.checkedAt,
    staleAfterHours: CACHE_STALE_HOURS,
  });

  if (!sanity.ok && sanity.status !== "stale") {
    return {
      name: offer.name,
      productId: offer.productId,
      shelfPrice: offer.price,
      lineTotal: null,
      pack: offer.packageSize,
      compareUnit: "per_pack",
      compareUnitLabel: compareUnitLabel("per_pack"),
      status: sanity.status,
      statusReason: sanity.reason,
      note: sanity.reason,
      ...unitFields,
    };
  }

  const typicalEach = typicalEachGramsOf(item);
  const eachKg =
    typicalEach && isEachSoldOffer(offer) ? typicalEach / 1000 : null;
  const massKg = offerMassKg(item, offer) ?? eachKg;
  const mass = massKg != null && massKg > 0 ? { kg: massKg } : null;
  const pack =
    offer.packageSize ??
    (mass
      ? eachKg && Math.abs(mass.kg - eachKg) < 1e-9
        ? `1 ea ≈ ${typicalEach} g`
        : formatMass(mass.kg)
      : undefined);

  if (item.targetMassKg != null || expectedPackFor(item) != null) {
    const composeNeedKg = item.targetMassKg ?? expectedPackFor(item)!;
    const need = composeNeedKg * qty;
    const asPacks = priceByPackCount(asProduct, need);
    if (asPacks) {
      const sameSize =
        Math.abs(asPacks.packKg - composeNeedKg) / composeNeedKg <= 0.2;
      const unit: CompareUnit = sameSize ? "per_pack" : "composed_packs";
      return {
        name: offer.name,
        productId: offer.productId,
        shelfPrice: offer.price,
        lineTotal: asPacks.lineTotal,
        pack,
        note: sameSize
          ? `${asPacks.basis}`
          : `${asPacks.basis} → ${formatMass(asPacks.coveredKg)}`,
        confidence: offer.confidence,
        compareUnit: unit,
        compareUnitLabel: compareUnitLabel(unit),
        status: sanity.status,
        statusReason: sanity.reason,
        pricePerKg: asPacks.pricePerKg,
        pricePerLb: round2(asPacks.pricePerKg * 0.45359237),
        ...unitFields,
      };
    }
  }

  if (eggPack && pricePerEgg != null) {
    const requestedEggs = qty > 0 ? qty : (eggCount ?? 1);
    const caseHint =
      eggInner && eggCount && eggInner !== eggCount
        ? ` (${eggParsed!.outerCount}×${eggInner})`
        : "";
    return {
      name: offer.name,
      productId: offer.productId,
      shelfPrice: offer.price,
      lineTotal: round2(pricePerEgg * requestedEggs),
      pack: pack ?? `${eggCount} шт`,
      note: `${eggCount} шт у пачці${caseHint} · ${formatMoneyPerEach(pricePerEgg)} · треба ${requestedEggs} шт`,
      confidence: offer.confidence,
      compareUnit: "per_pack",
      compareUnitLabel: "за 1 яйце",
      status: sanity.status,
      statusReason: sanity.reason,
      ...unitFields,
    };
  }

  if (PACK_COMPARE_IDS.has(item.id)) {
    const packKg = mass?.kg;
    const packPerKg =
      packKg && packKg > 0 ? round2(offer.price / packKg) : undefined;
    return {
      name: offer.name,
      productId: offer.productId,
      shelfPrice: offer.price,
      lineTotal: round2(offer.price * qty),
      pack,
      note: pack
        ? packPerKg
          ? eachKg && typicalEach
            ? `1 шт ≈ ${typicalEach} g · $${packPerKg.toFixed(2)}/kg`
            : `пачка ${pack} · $${packPerKg.toFixed(2)}/kg`
          : `пачка ${pack}`
        : undefined,
      confidence: offer.confidence,
      compareUnit: "per_pack",
      compareUnitLabel: compareUnitLabel("per_pack"),
      status: sanity.status,
      statusReason: sanity.reason,
      pricePerKg: packPerKg,
      pricePerLb: packPerKg ? round2(packPerKg * 0.45359237) : undefined,
      ...unitFields,
    };
  }

  if (byWeight && units) {
    const kg = qty > 0 ? qty : 1;
    const compareUnit: CompareUnit =
      units.nativeUnit === "lb" ? "per_lb" : "per_kg";
    const grams = Math.round(kg * 1000);
    return {
      name: offer.name,
      productId: offer.productId,
      shelfPrice: offer.price,
      lineTotal: round2(units.pricePerKg * kg),
      pack,
      note:
        kg === 1
          ? `${formatMoneyPerWeight(units.nativePrice, units.nativeUnit)} · також ${formatMoneyPerWeight(
              units.nativeUnit === "lb" ? units.pricePerKg : units.pricePerLb,
              units.nativeUnit === "lb" ? "kg" : "lb",
            )}`
          : `${grams} g`,
      confidence: offer.confidence,
      compareUnit,
      compareUnitLabel:
        kg === 1
          ? weightUnitLabel(units.nativeUnit)
          : `за ${grams} g`,
      status: sanity.status,
      statusReason: sanity.reason,
      ...unitFields,
    };
  }

  return {
    name: offer.name,
    productId: offer.productId,
    shelfPrice: offer.price,
    lineTotal: round2(offer.price * qty),
    pack,
    note: pack ? `пачка ${pack}` : undefined,
    confidence: offer.confidence,
    compareUnit: "per_pack",
    compareUnitLabel: compareUnitLabel("per_pack"),
    status: sanity.status,
    statusReason: sanity.reason,
  };
}

function offerDisplayName(o: { name: string; brand?: string }): string {
  const brand = (o.brand ?? "").replace(/\s+Foods$/i, "").trim();
  if (brand && !o.name.toLowerCase().includes(brand.toLowerCase())) {
    return `${brand} ${o.name}`;
  }
  return o.name;
}

export function catalogOfferFromLive(o: ProductOffer): CatalogOffer {
  const mass =
    parseMassFromText(o.packageSize ?? "") ?? parseMassFromText(o.name);
  const fromPack = mass && mass.kg > 0 && o.price > 0 ? o.price / mass.kg : null;
  const unitPrice =
    o.unitPrice != null &&
    o.unitPrice > 0 &&
    !(fromPack != null && o.unitPrice > fromPack * 20) &&
    !(o.price > 0 && o.unitPrice > Math.max(o.price * 50, 80))
      ? o.unitPrice
      : undefined;
  return {
    productId: o.productId,
    name: offerDisplayName(o),
    brand: o.brand,
    packageSize: o.packageSize ?? (mass ? formatMass(mass.kg) : undefined),
    parsedMassKg: mass?.kg,
    price: o.price,
    unitPrice,
    wasPrice: o.wasPrice,
    onSale: o.onSale || (o.wasPrice != null && o.wasPrice > o.price + 0.005) || undefined,
    availability: o.availability,
    confidence: o.confidence,
    checkedAt: o.checkedAt,
    sourceUrl: o.sourceUrl,
    image: o.image ?? extractRetailerImage(o.raw),
    taxonomyText: retailerTaxonomyText(o.raw) || undefined,
  };
}

/** Rapid/PCX often omit pack size on the locked SKU — stamp expected size on that SKU only. */
export function withExpectedPackSize(item: StapleItem, offer: CatalogOffer): CatalogOffer {
  if (offer.parsedMassKg != null && offer.parsedMassKg > 0) return offer;
  if (item.expectedPackKg == null || !(item.expectedPackKg > 0)) return offer;
  const locked =
    Boolean(item.preferredProductId) && offer.productId === item.preferredProductId;
  if (!locked) return offer;
  const unit = inferUnit(item);
  const kg = item.expectedPackKg;
  const stamped =
    unit === "l" || unit === "ml"
      ? `${kg} L`
      : unit === "g"
        ? `${Math.round(kg * 1000)} g`
        : `${kg} kg`;
  return {
    ...offer,
    packageSize: offer.packageSize ?? stamped,
    parsedMassKg: kg,
  };
}

function walmartRematchLink(item: StapleItem, offer: ProductOffer): RetailerSkuLink {
  const cheapest = resolveMatchMode(item) === "cheapest";
  return {
    retailer: "walmart_ca",
    storeId: "5831",
    retailerProductId: offer.productId,
    name: offer.name,
    upc: offer.upc,
    matchMethod: "seed_catalog",
    matchConfidence: cheapest ? 0.85 : 0.9,
    verified: false,
    decision: "auto_linked",
    kind: cheapest ? "staple_winner" : "identity",
    skippedRematch: false,
    updatedAt: new Date().toISOString(),
  };
}

function applyWalmartRematchMapping(
  store: RetailerMappingStore,
  item: StapleItem,
  offer: ProductOffer | null,
): void {
  const existing = store.products[item.id];
  if (!existing) return;
  const prev = existing.retailers.walmart_ca;
  if (prev?.verified) return;
  if (!offer) {
    if (prev) {
      existing.retailers.walmart_ca = {
        ...prev,
        decision: "needs_review",
        skippedRematch: false,
        updatedAt: new Date().toISOString(),
      };
    }
    return;
  }
  existing.retailers.walmart_ca = walmartRematchLink(item, offer);
}

/** Live-refresh Walmart catalog rows for selected staple ids only. */
export async function refreshWalmartSelected(
  ids: string[],
  overrides?: Record<string, ProductOverride>,
  opts?: StapleRefreshOpts,
): Promise<{
  updated: string[];
  logId: string;
  entries: MatchLogEntry[];
}> {
  const cfg = await loadStaplesConfig();
  const confirmed = await loadConfirmed();
  const catalog =
    (await loadWalmartCatalog()) ??
    ({
      type: "walmart-staples-catalog",
      checkedAt: new Date().toISOString(),
      items: [],
    } as {
      checkedAt: string;
      items: Array<Record<string, unknown>>;
    });

  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const mappings = await loadRetailerMappings();
  const wm = createWalmartConnector("L4J0A7");
  const entries: MatchLogEntry[] = [];
  const updated: string[] = [];

  for (const id of ids) {
    const raw = byId.get(id);
    if (!raw) continue;
    const item = stapleWithClientOverride(raw, overrides?.[id]);

    const log: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "walmart_ca",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    if (item.unavailableAtWalmart) {
      log.status = "unavailable";
      log.rejected.push({ reason: "marked unavailableAtWalmart" });
      entries.push(log);
      const row = (catalog.items as Array<Record<string, unknown>>).find(
        (r) => r.id === id,
      );
      if (row) {
        row.status = "unavailable";
        row.offer = null;
      }
      updated.push(id);
      continue;
    }

    const mappedWm = mappings.products[id]?.retailers.walmart_ca;
    const pinWm =
      confirmedStoreSku(overrides?.[id], "walmart_ca") ?? item.preferredProductId;
    const skipLock = refreshSkipIdentityLock(item, opts, pinWm);
    const lockedId = skipLock
      ? null
      : ((isLockedIdentityLink(mappedWm) ? mappedWm.retailerProductId : null) ??
        lookupConfirmed(confirmed, id)?.productId ??
        pinWm ??
        null);
    const mode = resolveMatchMode(item);
    // Produce (cheapest): never pin preferred brand SKU — only 👍 confirmed locks
    const preferred =
      lockedId ??
      (mode === "cheapest" ? null : item.preferredProductId ?? null);
    const pinId = lockedId ?? preferred;
    const queries = lockedId
      ? [lockedId]
      : [
          ...(preferred && mode !== "cheapest" ? [preferred] : []),
          ...(mode === "cheapest"
            ? categoryBSearchQueries(item, 6)
            : item.queries.filter(Boolean).slice(0, 4)),
        ];
    log.queries = pinId ? [pinId, ...queries.filter((q) => q !== pinId)] : queries;

    const seen = new Map<string, ProductOffer>();
    // Category A: product_id + store first. Search trips PerimeterX and is not needed
    // when the locked SKU already resolves.
    if (pinId) {
      try {
        const direct = await wm.getProduct(pinId, "5831");
        if (direct && offerMatchesRetailerSku(direct, pinId)) {
          seen.set(direct.productId, direct);
        }
      } catch (e) {
        log.rejected.push({
          productId: pinId,
          reason: `getProduct: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`,
        });
      }
    }

    const pinAlreadySeen =
      pinId != null &&
      [...seen.values()].some((o) => offerMatchesRetailerSku(o, pinId));
    const shelf = await loadShelfOverrides();
    const ov = shelfOverrideFor(shelf, "walmart_5831", id);
    const pinHitEarly =
      pinId != null
        ? [...seen.values()].find((o) => offerMatchesRetailerSku(o, pinId))
        : undefined;
    const pinNotOnShelf = Boolean(
      pinHitEarly &&
        ov?.availability === "out_of_stock" &&
        ov.productId &&
        offerMatchesRetailerSku(pinHitEarly, ov.productId),
    );
    if (!pinAlreadySeen || pinNotOnShelf) {
      const extra = opts?.skipIdentityLock
        ? queries.filter((q) => q && !/^\d+$/.test(q)).slice(0, 6)
        : item.queries.filter(Boolean).slice(0, 4);
      for (const q of extra) {
        try {
          const hits = await wm.searchProducts(q, "5831");
          for (const h of hits) {
            if (!seen.has(h.productId)) seen.set(h.productId, h);
          }
        } catch (e) {
          log.rejected.push({
            reason: `search error: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`,
          });
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    let best: ProductOffer | null = null;
    const pinHit =
      pinId != null
        ? [...seen.values()].find((o) => offerMatchesRetailerSku(o, pinId))
        : undefined;
    if ((lockedId || pinHit) && pinHit && !pinNotOnShelf) {
      const pin = lockedId ?? preferred!;
      best = pinHit;
      for (const o of seen.values()) {
        if (!offerMatchesRetailerSku(o, pin)) {
          log.rejected.push({
            productId: o.productId,
            name: o.name,
            price: o.price,
            reason: "ignored — match confirmed, no fuzzy",
          });
        }
      }
    } else {
      const pool = [...seen.values()].filter((o) => {
        if (!passesFilters(o, item)) return false;
        if (
          ov?.availability === "out_of_stock" &&
          ov.productId &&
          offerMatchesRetailerSku(o, ov.productId)
        ) {
          return false;
        }
        return true;
      });
      for (const o of seen.values()) {
        if (!passesFilters(o, item)) {
          log.rejected.push({
            productId: o.productId,
            name: o.name,
            price: o.price,
            reason: "name filter",
          });
        } else if (
          ov?.availability === "out_of_stock" &&
          ov.productId &&
          offerMatchesRetailerSku(o, ov.productId)
        ) {
          log.rejected.push({
            productId: o.productId,
            name: o.name,
            price: o.price,
            reason: "not on the shelf — nearest alternate",
          });
        }
      }
      best =
        pickBestOffer(
          pool,
          matchQueryForPick(item),
          pinNotOnShelf ? undefined : (preferred ?? undefined),
          {
          targetMassKg: item.targetMassKg ?? expectedPackFor(item),
          mode,
          preferNameIncludes: item.preferNameIncludes,
          byEach: isEggPackItem(item),
          preferLargerPack: preferLargerEggPack(item),
          preferredUpc: itemPreferredUpc(item),
          requireQueryMatch: false,
        },
        ) ?? (mode === "cheapest" ? pool[0] ?? null : null);
      if (best && mode === "cheapest") {
        log.rejected.push({
          reason: `cheapest produce pick among ${pool.length} filtered hits`,
        });
      }
    }

    if (best) {
      const sanity = sanityCheckOffer({
        itemId: item.id,
        name: best.name,
        price: best.price,
        packageSize: best.packageSize,
        unitPrice: best.unitPrice,
        expectedPackKg: expectedPackFor(item),
        allowCompose: expectedPackFor(item) != null,
        minPlausiblePrice: item.minPlausiblePrice,
        maxPlausiblePrice: item.maxPlausiblePrice,
        checkedAt: best.checkedAt,
      });
      if (!sanity.ok && sanity.status !== "stale") {
        log.rejected.push({
          productId: best.productId,
          name: best.name,
          price: best.price,
          reason: sanity.reason ?? sanity.status,
        });
        log.status = sanity.status;
        best = null;
      } else {
        log.accepted = {
          productId: best.productId,
          name: best.name,
          price: best.price,
        };
        log.status = sanity.status;
      }
    }

    let row = (catalog.items as Array<Record<string, unknown>>).find(
      (r) => r.id === id,
    );
    if (!row) {
      row = { id, label: item.label };
      (catalog.items as Array<Record<string, unknown>>).push(row);
    }
    row.label = item.label;
    row.image = item.image;
    row.queriesTried = queries;
    if (best) {
      row.status = log.status === "stale" ? "ok" : log.status;
      row.offer = withExpectedPackSize(item, catalogOfferFromLive(best));
      row.notes = item.notes;
      delete row.rejected;
      if (
        resolveMatchMode(item) === "cheapest" &&
        usesNeededWeightPick(item) &&
        !isSoldByWeightItem(item)
      ) {
        const sizes = mergeDistinctPackSizes(
          samePackedItemCandidates(
            item,
            [...seen.values()].map(catalogOfferFromLive),
            catalogOfferFromLive(best),
          ),
        );
        row.alternates = splitOfferAndAlternates(
          sizes,
          best.productId,
        ).alternates;
      }
    } else {
      const previous = row.offer as CatalogOffer | null | undefined;
      if (previous && previous.price > 0) {
        const why =
          log.rejected.at(-1)?.reason ?? "live WM refresh missed";
        log.status = "stale";
        row.status = "ok";
        row.rejected = {
          reason: `kept last price — ${why}`.slice(0, 180),
        };
        row.notes = `${item.notes ?? ""} · kept last WM price`.trim();
      } else {
        row.status = log.status;
        row.offer = null;
        row.rejected = log.rejected[log.rejected.length - 1] ?? {
          reason: "no_match",
        };
        row.notes = item.notes;
      }
    }
    if (opts?.skipIdentityLock) {
      applyWalmartRematchMapping(
        mappings,
        item,
        best && row.offer ? best : null,
      );
    }
    updated.push(id);
    entries.push(log);
  }

  (catalog as { checkedAt: string }).checkedAt = new Date().toISOString();
  await saveWalmartCatalog(catalog);
  if (opts?.skipIdentityLock) {
    try {
      await saveRetailerMappings(mappings);
    } catch {
      /* Serverless read-only FS */
    }
  }
  const logId = await appendMatchLog(entries);
  await closeWalmartBrowser().catch(() => undefined);
  return { updated, logId, entries };
}

/** Live-refresh No Frills offers into nofrills_3660_latest.json (skips TTL cache). */
export async function refreshNoFrillsSelected(
  ids: string[],
  overrides?: Record<string, ProductOverride>,
  opts?: StapleRefreshOpts,
): Promise<{
  updated: string[];
  logId: string;
  entries: MatchLogEntry[];
}> {
  const cfg = await loadStaplesConfig();
  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const entries: MatchLogEntry[] = [];
  const updated: string[] = [];

  for (const id of ids) {
    const raw = byId.get(id);
    if (!raw) continue;
    const item = stapleWithClientOverride(raw, overrides?.[id]);

    const log: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "no_frills",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    const pinNf = confirmedStoreSku(overrides?.[id], "no_frills");
    const pool = await searchNoFrillsPool(item, log, {
      ...opts,
      skipIdentityLock: refreshSkipIdentityLock(item, opts, pinNf),
      pinSku: pinNf,
    });
    const offer = pickStapleSearchWinner(item, pool, log, pinNf);
    entries.push(log);
    updated.push(id);

    if (offer) {
      const sizes = mergeDistinctPackSizes(
        samePackedItemCandidates(
          item,
          pool.map(catalogOfferFromLive),
          catalogOfferFromLive(offer),
        ),
      );
      const split = splitOfferAndAlternates(sizes, offer.productId);
      await upsertNoFrillsCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: split.offer ?? catalogOfferFromLive(offer),
        alternates:
          usesNeededWeightPick(item) && !isSoldByWeightItem(item)
            ? split.alternates
            : [],
        notes: `Live NF refresh (TTL ${CACHE_STALE_HOURS}h)`,
      });
    } else {
      await upsertNoFrillsCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: null,
        alternates: [],
        notes: log.rejected.at(-1)?.reason,
      });
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  const logId = await appendMatchLog(entries);
  return { updated, logId, entries };
}

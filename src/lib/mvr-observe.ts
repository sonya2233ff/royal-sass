/**
 * Live MVR Plus Shopify → catalog + master mappings.
 * Case / wholesale packs are kept; fair-compare converts them by unit.
 */
import { MvrConnector, MVR_STORE_ID, hydrateMvrOffer } from "@/connectors/mvr";
import type { ProductOffer } from "@/connectors/types";
import { offerFailsStapleOfferFilters, nameMatchesFilterToken, categoryBSearchQueries } from "@/domain/catalog-normalize";
import {
  isActualCategoryBOffer,
  usesCategoryBIdentity,
} from "@/domain/same-packed-item";
import { persistObservation } from "@/lib/persistence";
import {
  loadRetailerMappings,
  saveRetailerMappings,
  type MappedPrice,
  type MasterProductMapping,
  type RetailerMappingStore,
  type RetailerSkuLink,
} from "@/lib/retailer-mappings";
import {
  appendMatchLog,
  catalogOfferFromLive,
  eggCartonCountOk,
  isShownStaple,
  isSoldByWeightItem,
  loadStaplesConfig,
  pickStapleSearchWinner,
  resolveMatchMode,
  type MatchLogEntry,
  type StapleItem,
} from "@/lib/staples";
import {
  mergeDistinctPackSizes,
  splitOfferAndAlternates,
} from "@/domain/pack-size-candidates";
import { samePackedItemCandidates } from "@/domain/same-packed-item";
import { upsertMvrCatalogItem } from "@/lib/mvr-catalog";

export const MVR_RETAILER = "mvr";
export const MVR_PRICE_SOURCE = "catalog_mvr_weston_latest";
const MVR_CONNECTOR_LABEL = "mvr";

function isWholesaleCaseTitle(name: string): boolean {
  return /\bcase\b/i.test(name) || /\b\d+\s*x\s*\d+/i.test(name);
}

function passesMvrFilters(offer: ProductOffer, item: StapleItem): boolean {
  if (offerFailsStapleOfferFilters(item, offer) != null) {
    return false;
  }
  if (!eggCartonCountOk(item, offer.name, offer.packageSize)) {
    return false;
  }
  if (resolveMatchMode(item) === "preferred") {
    const token = item.preferNameIncludes?.find((t) => t.trim().length > 0);
    if (token && !/\d/.test(token)) {
      const hay = `${offer.brand ?? ""} ${offer.name} ${offer.packageSize ?? ""}`;
      if (!nameMatchesFilterToken(hay, token)) return false;
    }
  }
  if (!usesCategoryBIdentity(item)) return true;
  return isActualCategoryBOffer(item, offer);
}

export async function searchMvrPool(
  item: StapleItem,
  log?: MatchLogEntry,
): Promise<ProductOffer[]> {
  const mvr = new MvrConnector();
  const seen = new Map<string, ProductOffer>();
  const mappings = await loadRetailerMappings();
  const link = mappings.products[item.id]?.retailers.mvr;
  const lockedSku = link?.verified ? link.retailerProductId : null;
  const queries = categoryBSearchQueries(item, 6);
  if (log) log.queries = lockedSku ? [lockedSku, ...queries] : [...queries];

  if (lockedSku) {
    try {
      const direct = await mvr.getProduct(lockedSku, MVR_STORE_ID);
      if (direct) seen.set(direct.productId, direct);
    } catch (e) {
      log?.rejected.push({
        productId: lockedSku,
        reason: `locked SKU: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`,
      });
    }
  }

  for (const q of queries) {
    try {
      const hits = await mvr.searchProducts(q, MVR_STORE_ID);
      for (const h of hits) {
        if (!seen.has(h.productId)) seen.set(h.productId, h);
      }
    } catch (e) {
      log?.rejected.push({
        reason: `search error: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`,
      });
    }
  }

  return [...seen.values()].filter((o) => {
    const verifiedLock =
      Boolean(lockedSku) &&
      o.productId === lockedSku &&
      Boolean(link?.verified);
    if (verifiedLock) return true;
    if (!passesMvrFilters(o, item)) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason:
          offerFailsStapleOfferFilters(item, o) != null
            ? "filter mustInclude/mustNotInclude"
            : "not the actual category B item",
      });
      return false;
    }
    const casePack = isWholesaleCaseTitle(o.name);
    if (
      !casePack &&
      item.minPlausiblePrice != null &&
      o.price < item.minPlausiblePrice
    ) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: `price $${o.price} < min plausible $${item.minPlausiblePrice}`,
      });
      return false;
    }
    if (
      !casePack &&
      item.maxPlausiblePrice != null &&
      o.price > item.maxPlausiblePrice
    ) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: `price $${o.price} > max plausible $${item.maxPlausiblePrice}`,
      });
      return false;
    }
    return true;
  });
}

function mvrLinkFor(item: StapleItem, offer: ProductOffer): RetailerSkuLink {
  const cheapest = resolveMatchMode(item) === "cheapest";
  return {
    retailer: MVR_RETAILER,
    storeId: MVR_STORE_ID,
    retailerProductId: offer.productId,
    name: offer.name,
    upc: offer.upc,
    matchMethod: "seed_catalog",
    matchConfidence: cheapest ? 0.85 : 0.9,
    verified: false,
    decision: "auto_linked",
    kind: cheapest ? "staple_winner" : "identity",
    updatedAt: new Date().toISOString(),
  };
}

function mvrPrice(offer: ProductOffer): MappedPrice {
  return {
    retailer: MVR_RETAILER,
    storeId: MVR_STORE_ID,
    retailerProductId: offer.productId,
    price: offer.price,
    availability: offer.availability,
    checkedAt: offer.checkedAt,
    source: MVR_PRICE_SOURCE,
    priceConfidence:
      offer.confidence === "exact" ? "LIVE_VERIFIED" : "ESTIMATED",
  };
}

function applyMvrMapping(
  store: RetailerMappingStore,
  item: StapleItem,
  offer: ProductOffer | null,
): void {
  const existed = Boolean(store.products[item.id]);
  const existing: MasterProductMapping = store.products[item.id] ?? {
    masterId: item.id,
    label: item.label,
    category: item.category,
    retailers: {},
    prices: [],
  };
  const prev = existing.retailers.mvr;
  const prices = existing.prices.filter(
    (p) => !(p.retailer === MVR_RETAILER && p.storeId === MVR_STORE_ID),
  );

  if (!offer) {
    if (!existed) return;
    if (!prev?.verified) delete existing.retailers.mvr;
    existing.prices = prices;
    store.products[item.id] = existing;
    return;
  }

  if (!prev?.verified) {
    existing.retailers.mvr = mvrLinkFor(item, offer);
  }
  prices.push(mvrPrice(offer));
  existing.prices = prices;
  existing.label = existing.label || item.label;
  existing.category = existing.category || item.category;
  store.products[item.id] = existing;
}

export async function refreshMvrSelected(ids: string[]): Promise<{
  updated: string[];
  unmatched: string[];
  logId: string;
  storeId: string;
  entries: MatchLogEntry[];
}> {
  const cfg = await loadStaplesConfig();
  const byId = new Map(cfg.items.filter(isShownStaple).map((i) => [i.id, i]));
  const entries: MatchLogEntry[] = [];
  const updated: string[] = [];
  const unmatched: string[] = [];
  const mappings = await loadRetailerMappings();

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;

    const log: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: MVR_CONNECTOR_LABEL,
      queries: [],
      rejected: [],
      status: "no_match",
    };

    const pool = await searchMvrPool(item, log);
    let picked = pickStapleSearchWinner(item, pool, log);
    if (picked) {
      if (isSoldByWeightItem(item)) {
        const perKg = pool.find((o) => /per\s*kg/i.test(`${o.name} ${o.packageSize ?? ""}`));
        if (perKg) picked = perKg;
      } else {
        const singles = pool.filter((o) => !isWholesaleCaseTitle(o.name));
        if (singles.length && isWholesaleCaseTitle(picked.name)) {
          picked = pickStapleSearchWinner(item, singles, log) ?? picked;
        }
      }
    }
    const offer = picked ? await hydrateMvrOffer(picked) : null;
    if (offer && log.status === "ok") {
      log.accepted = {
        productId: offer.productId,
        name: offer.name,
        price: offer.price,
      };
    }
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
      const seen = new Set([
        offer.productId,
        ...(split.alternates ?? []).map((a) => a.productId),
      ]);
      const extra = pool
        .filter((o) => !seen.has(o.productId))
        .map(catalogOfferFromLive);
      const alternates = [...(split.alternates ?? []), ...extra].slice(0, 8);
      await upsertMvrCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: split.offer ?? catalogOfferFromLive(offer),
        alternates,
        notes: "Live MVR Plus Shopify INSTOREPRICE · 3655 Weston Rd",
      });
      applyMvrMapping(mappings, item, offer);
      try {
        await persistObservation({
          storeKey: "mvr_weston",
          itemId: id,
          offer,
        });
      } catch {
        /* optional */
      }
    } else {
      unmatched.push(id);
      await upsertMvrCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: null,
        alternates: [],
        notes: log.rejected.at(-1)?.reason ?? "no_match",
      });
      applyMvrMapping(mappings, item, null);
    }
  }

  await saveRetailerMappings(mappings);
  const logId = await appendMatchLog(entries);
  return {
    updated,
    unmatched,
    logId,
    storeId: MVR_STORE_ID,
    entries,
  };
}

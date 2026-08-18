import {
  SobeysConnector,
  flyerMeta,
  resetSobeysFlyerCache,
  SOBEYS_CLARK_HILDA_STORE_CODE,
} from "@/connectors/sobeys";
import type { ProductOffer } from "@/connectors/types";
import { SOBEYS_RETAILER, offerFailsStapleOfferFilters } from "@/domain/catalog-normalize";
import {
  isActualCategoryBOffer,
  usesCategoryBIdentity,
} from "@/domain/same-packed-item";
import { persistObservation } from "@/lib/persistence";
import {
  isLockedIdentityLink,
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
  isShownStaple,
  loadStaplesConfig,
  pickStapleSearchWinner,
  type MatchLogEntry,
  type StapleItem,
} from "@/lib/staples";
import {
  SOBEYS_CLARK_HILDA_STORE,
  SOBEYS_FLYER_SOURCE,
  upsertSobeysCatalogItem,
} from "@/lib/sobeys-catalog";

function textQueries(item: StapleItem): string[] {
  const qs = item.queries.filter((q) => q && !/^\d{8,14}$/.test(q));
  const out = [...qs];
  if (item.label && !out.includes(item.label)) out.unshift(item.label);
  return out.slice(0, 4);
}

function passesSobeysFilters(offer: ProductOffer, item: StapleItem): boolean {
  if (offerFailsStapleOfferFilters(item, offer) != null) {
    return false;
  }
  // Flyer search is bag-of-words over the whole weekly ad. Frozen staples
  // must say frozen — otherwise a fresh pint wins "frozen blueberries".
  if (item.category === "frozen") {
    const hay = `${offer.name} ${offer.packageSize ?? ""}`.toLowerCase();
    if (!hay.includes("frozen")) return false;
  }
  if (!usesCategoryBIdentity(item)) return true;
  return isActualCategoryBOffer(item, {
    productId: offer.productId,
    name: offer.name,
    brand: offer.brand,
    packageSize: offer.packageSize,
    sourceUrl: offer.sourceUrl,
  });
}

async function searchSobeysPool(
  item: StapleItem,
  log?: MatchLogEntry,
): Promise<ProductOffer[]> {
  const sb = new SobeysConnector();
  const seen = new Map<string, ProductOffer>();
  const queries = textQueries(item);
  if (log) log.queries = [...queries];

  for (const q of queries) {
    try {
      const hits = await sb.searchProducts(q, SOBEYS_CLARK_HILDA_STORE_CODE);
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
    if (!passesSobeysFilters(o, item)) {
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
    if (item.minPlausiblePrice != null && o.price < item.minPlausiblePrice) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: `price $${o.price} < min plausible $${item.minPlausiblePrice}`,
      });
      return false;
    }
    if (item.maxPlausiblePrice != null && o.price > item.maxPlausiblePrice) {
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

function sobeysLink(item: StapleItem, offer: ProductOffer): RetailerSkuLink {
  return {
    retailer: SOBEYS_RETAILER,
    storeId: SOBEYS_CLARK_HILDA_STORE,
    retailerProductId: offer.productId,
    name: offer.name,
    upc: offer.upc,
    matchMethod: "seed_catalog",
    matchConfidence: 0.7,
    verified: false,
    decision: "auto_linked",
    kind: "staple_winner",
    updatedAt: new Date().toISOString(),
  };
}

function sobeysPrice(offer: ProductOffer): MappedPrice {
  return {
    retailer: SOBEYS_RETAILER,
    storeId: SOBEYS_CLARK_HILDA_STORE,
    retailerProductId: offer.productId,
    price: offer.price,
    availability: offer.availability,
    checkedAt: offer.checkedAt,
    source: SOBEYS_FLYER_SOURCE,
    priceConfidence: "ESTIMATED",
  };
}

function applySobeysMapping(
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
  const prev = existing.retailers.sobeys;
  const prices = existing.prices.filter(
    (p) => !(p.retailer === SOBEYS_RETAILER && p.storeId === SOBEYS_CLARK_HILDA_STORE),
  );

  if (!offer) {
    if (!existed) return;
    if (!isLockedIdentityLink(prev)) {
      delete existing.retailers.sobeys;
    }
    existing.prices = prices;
    store.products[item.id] = existing;
    return;
  }

  if (!isLockedIdentityLink(prev)) {
    existing.retailers.sobeys = sobeysLink(item, offer);
  }
  prices.push(sobeysPrice(offer));
  existing.prices = prices;
  existing.label = existing.label || item.label;
  existing.category = existing.category || item.category;
  store.products[item.id] = existing;
}

/** Match weekly flyer items onto cafe staples. Does not rematch WM/NF. */
export async function refreshSobeysSelected(ids: string[]): Promise<{
  updated: string[];
  unmatched: string[];
  logId: string;
  flyer: ReturnType<typeof flyerMeta>;
  entries: MatchLogEntry[];
}> {
  const cfg = await loadStaplesConfig();
  const byId = new Map(cfg.items.filter(isShownStaple).map((i) => [i.id, i]));
  const entries: MatchLogEntry[] = [];
  const updated: string[] = [];
  const unmatched: string[] = [];

  resetSobeysFlyerCache();
  const mappings = await loadRetailerMappings();

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;

    const log: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: SOBEYS_RETAILER,
      queries: [],
      rejected: [],
      status: "no_match",
    };

    const pool = await searchSobeysPool(item, log);
    const offer = pickStapleSearchWinner(item, pool, log);
    entries.push(log);
    updated.push(id);

    const meta = flyerMeta();
    if (offer) {
      await upsertSobeysCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: catalogOfferFromLive(offer),
        notes: `Weekly Ontario flyer ${meta?.flyerId ?? "?"} — ESTIMATED, not shelf`,
        flyerId: meta?.flyerId ?? null,
        flyerName: meta?.flyerName ?? null,
        flyerValidFrom: meta?.validFrom ?? null,
        flyerValidTo: meta?.validTo ?? null,
      });
      applySobeysMapping(mappings, item, offer);
      try {
        await persistObservation({
          storeKey: "sobeys_clark_hilda",
          itemId: id,
          offer,
        });
      } catch {
        // Serverless / missing data dir
      }
    } else {
      unmatched.push(id);
      await upsertSobeysCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: null,
        notes: log.rejected.at(-1)?.reason ?? "not on this week's Ontario flyer",
        flyerId: meta?.flyerId ?? null,
        flyerName: meta?.flyerName ?? null,
        flyerValidFrom: meta?.validFrom ?? null,
        flyerValidTo: meta?.validTo ?? null,
      });
      applySobeysMapping(mappings, item, null);
    }
  }

  await saveRetailerMappings(mappings);
  const logId = await appendMatchLog(entries);
  return {
    updated,
    unmatched,
    logId,
    flyer: flyerMeta(),
    entries,
  };
}

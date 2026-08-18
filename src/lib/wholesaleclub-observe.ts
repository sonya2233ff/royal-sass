import {
  WholesaleClubConnector,
  WHOLESALECLUB_STORE_ID,
} from "@/connectors/wholesaleclub";
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
  isShownStaple,
  isSoldByWeightItem,
  isProduceWeightItem,
  loadStaplesConfig,
  pickStapleSearchWinner,
  resolveMatchMode,
  usesNeededWeightPick,
  type MatchLogEntry,
  type StapleItem,
} from "@/lib/staples";
import {
  mergeDistinctPackSizes,
  splitOfferAndAlternates,
} from "@/domain/pack-size-candidates";
import { samePackedItemCandidates } from "@/domain/same-packed-item";
import { upsertWholesaleClubCatalogItem } from "@/lib/wholesaleclub-catalog";

export const WHOLESALECLUB_RETAILER = "wholesaleclub";
export const WHOLESALECLUB_PRICE_SOURCE = "catalog_wholesaleclub_3724_latest";
const WHOLESALECLUB_CONNECTOR_LABEL = "wholesale_club";

function isCasePackSku(productId: string): boolean {
  return /_C\d+$/i.test(productId);
}

function passesWcFilters(offer: ProductOffer, item: StapleItem): boolean {
  if (isCasePackSku(offer.productId)) return false;
  if (offerFailsStapleOfferFilters(item, offer) != null) {
    return false;
  }
  if (isProduceWeightItem(item) || isSoldByWeightItem(item)) {
    const blob = `${offer.name} ${offer.packageSize ?? ""}`;
    if (/\b\d+(\.\d+)?\s*ml\b/i.test(blob) || /\bcanned\b/i.test(blob)) {
      return false;
    }
  }
  // Preferred staples: do not auto-link a different Earth's Own / brand SKU
  // (WC search for almond can return barista oat that still passes mustInclude).
  if (resolveMatchMode(item) === "preferred") {
    const token = item.preferNameIncludes?.find((t) => t.trim().length > 0);
    if (token) {
      const hay = `${offer.brand ?? ""} ${offer.name} ${offer.packageSize ?? ""}`;
      if (!nameMatchesFilterToken(hay, token)) return false;
    }
  }
  if (!usesCategoryBIdentity(item)) return true;
  return isActualCategoryBOffer(item, {
    productId: offer.productId,
    name: offer.name,
    brand: offer.brand,
    packageSize: offer.packageSize,
    sourceUrl: offer.sourceUrl,
    raw: offer.raw,
  });
}

export async function searchWholesaleClubPool(
  item: StapleItem,
  log?: MatchLogEntry,
): Promise<ProductOffer[]> {
  const wc = new WholesaleClubConnector();
  const seen = new Map<string, ProductOffer>();
  const mappings = await loadRetailerMappings();
  const wcLink = mappings.products[item.id]?.retailers.wholesaleclub;
  const lockedSku = wcLink?.verified ? wcLink.retailerProductId : null;
  const queries = categoryBSearchQueries(item, 6);
  if (log) log.queries = lockedSku ? [lockedSku, ...queries] : [...queries];

  if (lockedSku) {
    try {
      const direct = await wc.getProduct(lockedSku, WHOLESALECLUB_STORE_ID);
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
      const hits = await wc.searchProducts(q, WHOLESALECLUB_STORE_ID);
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
      Boolean(wcLink?.verified);
    if (verifiedLock) return true;
    if (isCasePackSku(o.productId)) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: "Wholesale Club case pack — skip for consumer compare",
      });
      return false;
    }
    if (!passesWcFilters(o, item)) {
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

function wcLinkFor(item: StapleItem, offer: ProductOffer): RetailerSkuLink {
  const cheapest = resolveMatchMode(item) === "cheapest";
  return {
    retailer: WHOLESALECLUB_RETAILER,
    storeId: WHOLESALECLUB_STORE_ID,
    retailerProductId: offer.productId,
    name: offer.name,
    upc: offer.upc,
    matchMethod: "seed_catalog",
    matchConfidence: 0.85,
    verified: false,
    decision: "auto_linked",
    kind: cheapest ? "staple_winner" : "identity",
    updatedAt: new Date().toISOString(),
  };
}

function wcPrice(offer: ProductOffer): MappedPrice {
  return {
    retailer: WHOLESALECLUB_RETAILER,
    storeId: WHOLESALECLUB_STORE_ID,
    retailerProductId: offer.productId,
    price: offer.price,
    availability: offer.availability,
    checkedAt: offer.checkedAt,
    source: WHOLESALECLUB_PRICE_SOURCE,
    priceConfidence:
      offer.confidence === "exact" ? "LIVE_VERIFIED" : "ESTIMATED",
  };
}

function applyWcMapping(
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
  const prev = existing.retailers.wholesaleclub;
  const prices = existing.prices.filter(
    (p) =>
      !(
        p.retailer === WHOLESALECLUB_RETAILER &&
        p.storeId === WHOLESALECLUB_STORE_ID
      ),
  );

  if (!offer) {
    if (!existed) return;
    if (!prev?.verified) delete existing.retailers.wholesaleclub;
    existing.prices = prices;
    store.products[item.id] = existing;
    return;
  }

  if (!prev?.verified) {
    existing.retailers.wholesaleclub = wcLinkFor(item, offer);
  }
  prices.push(wcPrice(offer));
  existing.prices = prices;
  existing.label = existing.label || item.label;
  existing.category = existing.category || item.category;
  store.products[item.id] = existing;
}

export async function refreshWholesaleClubSelected(ids: string[]): Promise<{
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
      retailer: WHOLESALECLUB_CONNECTOR_LABEL,
      queries: [],
      rejected: [],
      status: "no_match",
    };

    const pool = await searchWholesaleClubPool(item, log);
    const offer = pickStapleSearchWinner(item, pool, log);
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
      await upsertWholesaleClubCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: split.offer ?? catalogOfferFromLive(offer),
        alternates:
          usesNeededWeightPick(item) && !isSoldByWeightItem(item)
            ? split.alternates
            : [],
        notes: "Live Wholesale Club PCX #3724",
      });
      applyWcMapping(mappings, item, offer);
      try {
        await persistObservation({
          storeKey: "wholesaleclub_3724",
          itemId: id,
          offer,
        });
      } catch {
        /* optional */
      }
    } else {
      unmatched.push(id);
      await upsertWholesaleClubCatalogItem({
        id,
        label: item.label,
        status: log.status,
        offer: null,
        alternates: [],
        notes: log.rejected.at(-1)?.reason ?? "no_match",
      });
      applyWcMapping(mappings, item, null);
    }
  }

  await saveRetailerMappings(mappings);
  const logId = await appendMatchLog(entries);
  return {
    updated,
    unmatched,
    logId,
    storeId: WHOLESALECLUB_STORE_ID,
    entries,
  };
}

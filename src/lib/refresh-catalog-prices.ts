/**
 * Re-fetch shelf prices for SKUs already in the catalog / mapping.
 * Does not rematch by search query (avoids grape-tomato seeds, etc.).
 */
import { NoFrillsConnector } from "@/connectors/nofrills";
import type { ProductOffer, RetailerConnector } from "@/connectors/types";
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import {
  resolveWalmartSource,
  WALMART_RAPID_MISSING_KEY,
} from "@/connectors/walmart-source";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import { offerMatchesRetailerSku } from "@/domain/compare-resolve";
import { formatMass, parseMassFromText } from "@/domain/units";
import { sanityCheckOffer } from "@/domain/sanity";
import {
  isLockedIdentityLink,
  loadRetailerMappings,
  lookupConfirmed,
} from "@/lib/retailer-mappings";
import {
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  saveWalmartCatalog,
  upsertNoFrillsCatalogItem,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";

const WM_STORE = "5831";
const NF_STORE = "3660";

export type PriceRefreshFailure = { id: string; reason: string };
export type PriceRefreshHit = {
  id: string;
  productId: string;
  name: string;
  previousPrice?: number;
  price: number;
};

export type CatalogPriceRefreshResult = {
  walmart: {
    source: string;
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
  };
  noFrills: {
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
    blocked?: string;
  };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slimOffer(o: ProductOffer): CatalogOffer {
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
  const brand = (o.brand ?? "").replace(/\s+Foods$/i, "").trim();
  return {
    productId: o.productId,
    name:
      brand && !o.name.toLowerCase().includes(brand.toLowerCase())
        ? `${brand} ${o.name}`
        : o.name,
    brand: o.brand,
    packageSize: o.packageSize ?? (mass ? formatMass(mass.kg) : undefined),
    parsedMassKg: mass?.kg,
    price: o.price,
    unitPrice,
    wasPrice: o.wasPrice,
    onSale:
      o.onSale ||
      (o.wasPrice != null && o.wasPrice > o.price + 0.005) ||
      undefined,
    confidence: o.confidence,
    checkedAt: o.checkedAt,
    sourceUrl: o.sourceUrl,
  };
}

function numericAliasIds(sku: string): string[] {
  if (!/^\d+$/.test(sku) || sku.length < 6) return [sku];
  try {
    const n = BigInt(sku);
    const aliases = [sku, String(n - 1n), String(n + 1n)];
    return [...new Set(aliases)];
  } catch {
    return [sku];
  }
}

function priceJumpTooBig(previous: number | undefined, next: number): boolean {
  if (previous == null || previous <= 0 || next <= 0) return false;
  const ratio = next > previous ? next / previous : previous / next;
  return ratio >= 4;
}

async function fetchMatchingSku(
  connector: RetailerConnector,
  sku: string,
  storeId: string,
  previousPrice?: number,
): Promise<ProductOffer | null> {
  const tryIds = [sku];
  for (const alias of numericAliasIds(sku)) {
    if (alias !== sku) tryIds.push(alias);
  }

  let blocked: unknown = null;
  for (const [i, id] of tryIds.entries()) {
    try {
      const offer = await connector.getProduct(id, storeId);
      if (!offer) {
        await sleep(250);
        continue;
      }
      const exact = offer.productId === sku || Boolean(offer.sourceUrl?.includes(sku));
      const aliasOk =
        i > 0 &&
        offerMatchesRetailerSku(offer, sku) &&
        !priceJumpTooBig(previousPrice, offer.price);
      if (exact || aliasOk) {
        if (priceJumpTooBig(previousPrice, offer.price)) return null;
        return offer;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/401|403|blocked|unauthorized|invalid_client|PerimeterX/i.test(msg)) {
        blocked = e;
        break;
      }
    }
    await sleep(250);
  }
  if (blocked) throw blocked;
  return null;
}

function wmSkuFor(
  id: string,
  item: StapleItem,
  confirmed: Awaited<ReturnType<typeof loadConfirmed>>,
  mappings: Awaited<ReturnType<typeof loadRetailerMappings>>,
  row?: { offer?: CatalogOffer | null } | null,
): string | null {
  const link = mappings.products[id]?.retailers.walmart_ca;
  if (link?.retailerProductId && isLockedIdentityLink(link)) {
    return link.retailerProductId;
  }
  const conf = lookupConfirmed(confirmed, id);
  if (conf?.productId) return conf.productId;
  if (row?.offer?.productId) return row.offer.productId;
  if (item.preferredProductId) return item.preferredProductId;
  return null;
}

function nfSkuFor(
  id: string,
  mappings: Awaited<ReturnType<typeof loadRetailerMappings>>,
  row?: { offer?: CatalogOffer | null } | null,
): string | null {
  const link = mappings.products[id]?.retailers.nofrills;
  if (link?.retailerProductId && isLockedIdentityLink(link)) {
    return link.retailerProductId;
  }
  if (row?.offer?.productId) return row.offer.productId;
  return null;
}

function looksLikeTomatoSeeds(itemId: string, name: string): boolean {
  return itemId === "tomatoes_grape" && /\bseeds?\b/i.test(name);
}

/** Live price refresh for known SKUs. Keeps identity; skips rows with no SKU. */
export async function refreshCatalogPrices(
  ids: string[],
): Promise<CatalogPriceRefreshResult> {
  const cfg = await loadStaplesConfig();
  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const confirmed = await loadConfirmed();
  const mappings = await loadRetailerMappings();
  const wmCatalog =
    (await loadWalmartCatalog()) ??
    ({
      type: "walmart-staples-catalog",
      checkedAt: new Date().toISOString(),
      items: [],
    } as {
      checkedAt: string;
      items: Array<Record<string, unknown>>;
    });
  const nfCatalog =
    (await loadNoFrillsCatalog()) ??
    ({
      storeId: NF_STORE,
      checkedAt: new Date().toISOString(),
      items: [],
    } as Awaited<ReturnType<typeof loadNoFrillsCatalog>>);

  const result: CatalogPriceRefreshResult = {
    walmart: { source: "ssr_or_rapid", updated: [], failed: [], skipped: [] },
    noFrills: { updated: [], failed: [], skipped: [] },
  };

  const wmSource = resolveWalmartSource();
  const wm =
    wmSource === "missing_key" ? null : createWalmartConnector("L4J0A7");
  result.walmart.source = wm?.id ?? wmSource;
  let wmBlocked: string | null =
    wmSource === "missing_key" ? WALMART_RAPID_MISSING_KEY : null;

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      result.walmart.skipped.push({ id, reason: "unknown staple" });
      continue;
    }
    if (item.unavailableAtWalmart) {
      result.walmart.skipped.push({ id, reason: "unavailable at Walmart" });
      continue;
    }
    const row = (wmCatalog.items as Array<Record<string, unknown>>).find(
      (r) => r.id === id,
    );
    const sku = wmSkuFor(
      id,
      item,
      confirmed,
      mappings,
      row as { offer?: CatalogOffer | null } | undefined,
    );
    if (!sku) {
      result.walmart.skipped.push({ id, reason: "no locked/catalog SKU" });
      continue;
    }
    if (!wm || wmBlocked) {
      result.walmart.failed.push({
        id,
        reason: wmBlocked ?? WALMART_RAPID_MISSING_KEY,
      });
      continue;
    }
    try {
      const prev = (row?.offer as CatalogOffer | undefined)?.price;
      const live = await fetchMatchingSku(wm, sku, WM_STORE, prev);
      if (!live) {
        result.walmart.failed.push({
          id,
          reason: `SKU ${sku} not found on refresh`,
        });
        continue;
      }
      if (looksLikeTomatoSeeds(id, live.name)) {
        result.walmart.failed.push({
          id,
          reason: `refused seed hit for grape tomatoes (${live.productId})`,
        });
        continue;
      }
      if (priceJumpTooBig(prev, live.price)) {
        result.walmart.failed.push({
          id,
          reason: `price jump $${prev} → $${live.price} rejected`,
        });
        continue;
      }
      const sanity = sanityCheckOffer({
        itemId: id,
        name: live.name,
        price: live.price,
        packageSize: live.packageSize,
        unitPrice: live.unitPrice,
        checkedAt: live.checkedAt,
        staleAfterHours: 24 * 7,
      });
      if (!sanity.ok && sanity.status !== "stale") {
        result.walmart.failed.push({
          id,
          reason: sanity.reason ?? sanity.status,
        });
        continue;
      }
      const offer = slimOffer(live);
      if (!row) {
        (wmCatalog.items as Array<Record<string, unknown>>).push({
          id,
          label: item.label,
          status: "ok",
          offer,
          notes: item.notes,
        });
      } else {
        row.status = "ok";
        row.offer = offer;
        row.label = item.label;
      }
      result.walmart.updated.push({
        id,
        productId: offer.productId,
        name: offer.name,
        previousPrice: prev,
        price: offer.price,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
      if (/blocked|PerimeterX|401|403/i.test(msg)) {
        wmBlocked = msg;
      }
      result.walmart.failed.push({ id, reason: msg });
    }
  }

  if (wm && result.walmart.updated.length > 0) {
    (wmCatalog as { checkedAt: string }).checkedAt = new Date().toISOString();
    await saveWalmartCatalog(wmCatalog);
  }
  await closeWalmartBrowser().catch(() => undefined);

  const nf = new NoFrillsConnector();
  let nfBlocked: string | null = null;

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      result.noFrills.skipped.push({ id, reason: "unknown staple" });
      continue;
    }
    const row = nfCatalog?.items.find((r) => r.id === id);
    const sku = nfSkuFor(id, mappings, row);
    if (!sku) {
      result.noFrills.skipped.push({ id, reason: "no locked/catalog SKU" });
      continue;
    }
    if (nfBlocked) {
      result.noFrills.failed.push({ id, reason: nfBlocked });
      continue;
    }
    try {
      const prev = row?.offer?.price;
      const live = await fetchMatchingSku(nf, sku, NF_STORE, prev);
      if (!live) {
        result.noFrills.failed.push({
          id,
          reason: `SKU ${sku} not found on refresh`,
        });
        continue;
      }
      const offer = slimOffer(live);
      await upsertNoFrillsCatalogItem({
        id,
        label: item.label,
        status: "ok",
        offer,
        notes: "Live NF SKU price refresh",
      });
      result.noFrills.updated.push({
        id,
        productId: offer.productId,
        name: offer.name,
        previousPrice: prev,
        price: offer.price,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 180) : String(e);
      if (/401|403|blocked|unauthorized|invalid_client/i.test(msg)) {
        nfBlocked = msg;
        result.noFrills.blocked = msg;
        result.noFrills.failed.push({ id, reason: msg });
      } else {
        result.noFrills.failed.push({ id, reason: msg });
      }
    }
    await sleep(200);
  }

  return result;
}

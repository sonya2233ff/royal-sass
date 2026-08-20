/**
 * Re-fetch shelf prices for SKUs already in the catalog / mapping.
 * Does not rematch by search query (avoids grape-tomato seeds, etc.).
 */
import { NoFrillsConnector } from "@/connectors/nofrills";
import { WholesaleClubConnector } from "@/connectors/wholesaleclub";
import { MvrConnector } from "@/connectors/mvr";
import type { ProductOffer, RetailerConnector } from "@/connectors/types";
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import {
  resolveWalmartSource,
  WALMART_RAPID_MISSING_KEY,
} from "@/connectors/walmart-source";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import {
  catalogSkuForPriceRefresh,
  offerMatchesRetailerSku,
  type CatalogRowRef,
} from "@/domain/compare-resolve";
import { offerFailsStapleOfferFilters } from "@/domain/catalog-normalize";
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
  resolveMatchMode,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";
import {
  loadWholesaleClubCatalog,
  upsertWholesaleClubCatalogItem,
} from "@/lib/wholesaleclub-catalog";
import { loadMvrCatalog, upsertMvrCatalogItem } from "@/lib/mvr-catalog";
import { extractRetailerImage, isHttpImageUrl } from "@/lib/product-image";

const WM_STORE = "5831";
const NF_STORE = "3660";
const WC_STORE = "3724";
const MVR_STORE = "weston";

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
  wholesaleClub: {
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
    blocked?: string;
  };
  mvr: {
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
    blocked?: string;
  };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function run() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
}

function isTimeoutError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = "name" in e ? String(e.name) : "";
  const msg = e instanceof Error ? e.message : String(e);
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /aborted|timeout/i.test(msg)
  );
}

function slimOffer(o: ProductOffer, previous?: CatalogOffer | null): CatalogOffer {
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
  const image =
    o.image ?? extractRetailerImage(o.raw) ?? previous?.image;
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
    image,
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
      if (isTimeoutError(e)) break;
    }
    await sleep(250);
  }
  if (blocked) throw blocked;
  return null;
}

type CatalogSkuRow = {
  offer?: CatalogOffer | null;
  alternates?: CatalogOffer[] | null;
};

function wmSkuFor(
  id: string,
  item: StapleItem,
  confirmed: Awaited<ReturnType<typeof loadConfirmed>>,
  mappings: Awaited<ReturnType<typeof loadRetailerMappings>>,
  row?: CatalogSkuRow | null,
): string | null {
  return catalogSkuForPriceRefresh({
    item,
    row: row as CatalogRowRef | null | undefined,
    link: mappings.products[id]?.retailers.walmart_ca,
    confirmedProductId: lookupConfirmed(confirmed, id)?.productId,
    preferredProductId: item.preferredProductId,
  });
}

function nfSkuFor(
  id: string,
  item: StapleItem,
  mappings: Awaited<ReturnType<typeof loadRetailerMappings>>,
  row?: CatalogSkuRow | null,
): string | null {
  return catalogSkuForPriceRefresh({
    item,
    row: row as CatalogRowRef | null | undefined,
    link: mappings.products[id]?.retailers.nofrills,
  });
}

function wcSkuFor(
  id: string,
  item: StapleItem,
  mappings: Awaited<ReturnType<typeof loadRetailerMappings>>,
  row?: CatalogSkuRow | null,
): string | null {
  return catalogSkuForPriceRefresh({
    item,
    row: row as CatalogRowRef | null | undefined,
    link: mappings.products[id]?.retailers.wholesaleclub,
  });
}

function mvrSkuFor(
  id: string,
  item: StapleItem,
  mappings: Awaited<ReturnType<typeof loadRetailerMappings>>,
  row?: CatalogSkuRow | null,
): string | null {
  return catalogSkuForPriceRefresh({
    item,
    row: row as CatalogRowRef | null | undefined,
    link: mappings.products[id]?.retailers.mvr,
  });
}

function looksLikeTomatoSeeds(itemId: string, name: string): boolean {
  return itemId === "tomatoes_grape" && /\bseeds?\b/i.test(name);
}

function refuseUnlockedImpostor(
  item: StapleItem,
  offer: CatalogOffer,
  locked: boolean,
): string | null {
  if (looksLikeTomatoSeeds(item.id, offer.name)) {
    return `refused seed hit for grape tomatoes (${offer.productId})`;
  }
  if (locked) return null;
  const fail = offerFailsStapleOfferFilters(item, offer);
  return fail ? `refreshed SKU fails ${fail} (${offer.name})` : null;
}

function logRefreshProgress(store: string, n: number, total: number, id: string) {
  if (n === 1 || n === total || n % 10 === 0) {
    console.error(`  ${store} ${n}/${total} ${id}`);
  }
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
    wholesaleClub: { updated: [], failed: [], skipped: [] },
    mvr: { updated: [], failed: [], skipped: [] },
  };

  const wmSource = resolveWalmartSource();
  const wm =
    wmSource === "missing_key" ? null : createWalmartConnector("L4J0A7");
  result.walmart.source = wm?.id ?? wmSource;
  let wmBlocked: string | null =
    wmSource === "missing_key" ? WALMART_RAPID_MISSING_KEY : null;

  let wmN = 0;
  await runPool(ids, 1, async (id) => {
    wmN += 1;
    logRefreshProgress("walmart", wmN, ids.length, id);
    const item = byId.get(id);
    if (!item) {
      result.walmart.skipped.push({ id, reason: "unknown staple" });
      return;
    }
    if (item.unavailableAtWalmart) {
      result.walmart.skipped.push({ id, reason: "unavailable at Walmart" });
      return;
    }
    const row = (wmCatalog.items as Array<Record<string, unknown>>).find(
      (r) => r.id === id,
    );
    const sku = wmSkuFor(
      id,
      item,
      confirmed,
      mappings,
      row as CatalogSkuRow | undefined,
    );
    if (!sku) {
      result.walmart.skipped.push({ id, reason: "no locked/catalog SKU" });
      return;
    }
    if (!wm || wmBlocked) {
      result.walmart.failed.push({
        id,
        reason: wmBlocked ?? WALMART_RAPID_MISSING_KEY,
      });
      return;
    }
    try {
      const prev = (row?.offer as CatalogOffer | undefined)?.price;
      const live = await fetchMatchingSku(wm, sku, WM_STORE, prev);
      if (!live) {
        result.walmart.failed.push({
          id,
          reason: `SKU ${sku} not found on refresh`,
        });
        return;
      }
      if (priceJumpTooBig(prev, live.price)) {
        result.walmart.failed.push({
          id,
          reason: `price jump $${prev} → $${live.price} rejected`,
        });
        return;
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
        return;
      }
      const prevOffer = row?.offer as CatalogOffer | undefined;
      const offer = slimOffer(live, prevOffer);
      const wmLocked =
        isLockedIdentityLink(mappings.products[id]?.retailers.walmart_ca) ||
        Boolean(lookupConfirmed(confirmed, id)?.productId);
      const refused = refuseUnlockedImpostor(item, offer, wmLocked);
      if (refused) {
        result.walmart.failed.push({ id, reason: refused });
        return;
      }
      if (!row) {
        (wmCatalog.items as Array<Record<string, unknown>>).push({
          id,
          label: item.label,
          status: "ok",
          offer,
          image: isHttpImageUrl(offer.image) ? offer.image : item.image,
          notes: item.notes,
        });
      } else {
        row.status = "ok";
        row.offer = offer;
        row.label = item.label;
        if (
          resolveMatchMode(item) === "preferred" &&
          isHttpImageUrl(offer.image)
        ) {
          row.image = offer.image;
        }
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
  });

  if (wm && result.walmart.updated.length > 0) {
    (wmCatalog as { checkedAt: string }).checkedAt = new Date().toISOString();
    await saveWalmartCatalog(wmCatalog);
  }
  await closeWalmartBrowser().catch(() => undefined);

  const nf = new NoFrillsConnector();
  let nfBlocked: string | null = null;

  let nfN = 0;
  for (const id of ids) {
    nfN += 1;
    logRefreshProgress("nofrills", nfN, ids.length, id);
    const item = byId.get(id);
    if (!item) {
      result.noFrills.skipped.push({ id, reason: "unknown staple" });
      continue;
    }
    const row = nfCatalog?.items.find((r) => r.id === id);
    const sku = nfSkuFor(id, item, mappings, row);
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
      const offer = slimOffer(live, row?.offer);
      const refused = refuseUnlockedImpostor(
        item,
        offer,
        isLockedIdentityLink(mappings.products[id]?.retailers.nofrills),
      );
      if (refused) {
        result.noFrills.failed.push({ id, reason: refused });
        continue;
      }
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

  const wc = new WholesaleClubConnector();
  let wcBlocked: string | null = null;
  const wcCatalog =
    (await loadWholesaleClubCatalog()) ??
    ({
      storeId: WC_STORE,
      checkedAt: new Date().toISOString(),
      items: [],
    } as Awaited<ReturnType<typeof loadWholesaleClubCatalog>>);

  let wcN = 0;
  for (const id of ids) {
    wcN += 1;
    logRefreshProgress("wholesaleclub", wcN, ids.length, id);
    const item = byId.get(id);
    if (!item) {
      result.wholesaleClub.skipped.push({ id, reason: "unknown staple" });
      continue;
    }
    const row = wcCatalog?.items.find((r) => r.id === id);
    const sku = wcSkuFor(id, item, mappings, row);
    if (!sku) {
      result.wholesaleClub.skipped.push({ id, reason: "no locked/catalog SKU" });
      continue;
    }
    if (wcBlocked) {
      result.wholesaleClub.failed.push({ id, reason: wcBlocked });
      continue;
    }
    try {
      const prev = row?.offer?.price;
      const live = await fetchMatchingSku(wc, sku, WC_STORE, prev);
      if (!live) {
        result.wholesaleClub.failed.push({
          id,
          reason: `SKU ${sku} not found on refresh`,
        });
        continue;
      }
      const offer = slimOffer(live, row?.offer);
      const refused = refuseUnlockedImpostor(
        item,
        offer,
        isLockedIdentityLink(mappings.products[id]?.retailers.wholesaleclub),
      );
      if (refused) {
        result.wholesaleClub.failed.push({ id, reason: refused });
        continue;
      }
      await upsertWholesaleClubCatalogItem({
        id,
        label: item.label,
        status: "ok",
        offer,
        notes: "Live WC SKU price refresh",
      });
      result.wholesaleClub.updated.push({
        id,
        productId: offer.productId,
        name: offer.name,
        previousPrice: prev,
        price: offer.price,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 180) : String(e);
      if (/401|403|blocked|unauthorized|invalid_client/i.test(msg)) {
        wcBlocked = msg;
        result.wholesaleClub.blocked = msg;
        result.wholesaleClub.failed.push({ id, reason: msg });
      } else {
        result.wholesaleClub.failed.push({ id, reason: msg });
      }
    }
    await sleep(200);
  }

  const mvr = new MvrConnector();
  let mvrBlocked: string | null = null;
  const mvrCatalog =
    (await loadMvrCatalog()) ??
    ({
      storeId: MVR_STORE,
      checkedAt: new Date().toISOString(),
      items: [],
    } as Awaited<ReturnType<typeof loadMvrCatalog>>);

  let mvrN = 0;
  for (const id of ids) {
    mvrN += 1;
    logRefreshProgress("mvr", mvrN, ids.length, id);
    const item = byId.get(id);
    if (!item) {
      result.mvr.skipped.push({ id, reason: "unknown staple" });
      continue;
    }
    const row = mvrCatalog?.items.find((r) => r.id === id);
    const sku = mvrSkuFor(id, item, mappings, row);
    if (!sku) {
      result.mvr.skipped.push({ id, reason: "no locked/catalog SKU" });
      continue;
    }
    if (mvrBlocked) {
      result.mvr.failed.push({ id, reason: mvrBlocked });
      continue;
    }
    try {
      const prev = row?.offer?.price;
      const live = await fetchMatchingSku(mvr, sku, MVR_STORE, prev);
      if (!live) {
        result.mvr.failed.push({
          id,
          reason: `SKU ${sku} not found on refresh`,
        });
        continue;
      }
      const offer = slimOffer(live, row?.offer);
      const refused = refuseUnlockedImpostor(
        item,
        offer,
        isLockedIdentityLink(mappings.products[id]?.retailers.mvr),
      );
      if (refused) {
        result.mvr.failed.push({ id, reason: refused });
        continue;
      }
      await upsertMvrCatalogItem({
        id,
        label: item.label,
        status: "ok",
        offer,
        notes: "Live MVR SKU price refresh",
      });
      result.mvr.updated.push({
        id,
        productId: offer.productId,
        name: offer.name,
        previousPrice: prev,
        price: offer.price,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 180) : String(e);
      if (/401|403|blocked|unauthorized/i.test(msg)) {
        mvrBlocked = msg;
        result.mvr.blocked = msg;
        result.mvr.failed.push({ id, reason: msg });
      } else {
        result.mvr.failed.push({ id, reason: msg });
      }
    }
    await sleep(150);
  }

  return result;
}

import { NextResponse } from "next/server";
import { resolveWalmartSource } from "@/connectors/walmart-source";
import {
  appendMatchLog,
  CACHE_STALE_HOURS,
  evaluateOfferStatus,
  isShownStaple,
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  searchNoFrills,
  upsertNoFrillsCatalogItem,
  isSoldByWeightItem,
  resolveMatchMode,
  type CatalogOffer,
  type MatchLogEntry,
} from "@/lib/staples";
import { parseMassFromText } from "@/domain/units";
import { resolveCatalogOffer } from "@/domain/compare-resolve";
import { buildStapleCompareRow } from "@/lib/staple-compare-row";
import {
  loadRetailerMappings,
  lookupConfirmed,
  type RetailerSkuLink,
} from "@/lib/retailer-mappings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toCatalogOffer(
  offer: {
    productId: string;
    name: string;
    price: number;
    packageSize?: string;
    unitPrice?: number;
    wasPrice?: number;
    onSale?: boolean;
    confidence?: string;
    checkedAt?: string;
    sourceUrl?: string;
    brand?: string;
  } | null,
): CatalogOffer | null {
  if (!offer) return null;
  return {
    productId: offer.productId,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    unitPrice: offer.unitPrice,
    wasPrice: offer.wasPrice,
    onSale: offer.onSale,
    confidence: offer.confidence,
    checkedAt: offer.checkedAt,
    sourceUrl: offer.sourceUrl,
    brand: offer.brand,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    /** If true, always hit No Frills live API (skip NF cache). */
    refreshNoFrills?: boolean;
    /** Grams needed for sold-by-weight items (id → grams). */
    grams?: Record<string, number>;
  };
  const cfg = await loadStaplesConfig();
  const allowed = new Set(cfg.items.filter(isShownStaple).map((i) => i.id));
  const wanted = (body.ids?.length ? body.ids : [...allowed]).filter((id) =>
    allowed.has(id),
  );

  const catalog = await loadWalmartCatalog();
  const nfCatalog = await loadNoFrillsCatalog();
  const confirmed = await loadConfirmed();
  const mappings = await loadRetailerMappings();
  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const catById = new Map(catalog?.items.map((i) => [i.id, i]) ?? []);
  const nfById = new Map(nfCatalog?.items.map((i) => [i.id, i]) ?? []);

  const entries: MatchLogEntry[] = [];
  const rows = [];
  let nfLiveHits = 0;
  let nfCacheHits = 0;

  for (const id of wanted) {
    const item = byId.get(id);
    if (!item) continue;

    const conf = lookupConfirmed(confirmed, id);
    if (conf?.productId) {
      item.preferredProductId = conf.productId;
    }

    const mode = resolveMatchMode(item);
    const productMap = mappings.products[id];
    const wmLink: RetailerSkuLink | undefined =
      productMap?.retailers.walmart_ca;
    const nfLink: RetailerSkuLink | undefined =
      productMap?.retailers.nofrills;

    const cat = catById.get(id);
    const wmResolved = resolveCatalogOffer({
      item,
      row: cat,
      link: wmLink,
      matchMode: mode,
    });
    const wmOffer = toCatalogOffer(wmResolved.offer);
    const wmEval = evaluateOfferStatus(item, wmOffer, {
      unavailable: item.unavailableAtWalmart,
      catalogStatus:
        wmResolved.reason === "mapped_sku_missing" ||
        wmResolved.reason === "rejected_filter"
          ? "no_match"
          : cat?.status,
    });
    if (wmResolved.reason === "mapped_sku_missing") {
      wmEval.status = "no_match";
      wmEval.reason = wmResolved.detail;
    } else if (wmResolved.reason === "rejected_filter") {
      wmEval.status = "rejected";
      wmEval.reason = wmResolved.detail;
    }

    const wmUsable =
      Boolean(wmOffer) &&
      (wmEval.status === "ok" || wmEval.status === "stale") &&
      cat?.status !== "wrong_pack" &&
      cat?.status !== "wrong_size" &&
      cat?.status !== "unavailable";

    const nfCached = nfById.get(id);
    const nfResolved = resolveCatalogOffer({
      item,
      row: nfCached,
      link: nfLink,
      matchMode: mode,
    });
    const nfCacheEval = evaluateOfferStatus(item, nfResolved.offer, {
      catalogStatus:
        nfResolved.reason === "rejected_filter"
          ? "no_match"
          : nfCached?.status,
    });
    const nfCacheUsable =
      !body.refreshNoFrills &&
      Boolean(nfResolved.offer) &&
      (nfCacheEval.status === "ok" || nfCacheEval.status === "stale") &&
      nfCached?.status !== "wrong_pack" &&
      nfCached?.status !== "wrong_size";

    const nfLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "no_frills",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    let nfOffer = null as Awaited<ReturnType<typeof searchNoFrills>>;
    const cacheRowExists = Boolean(nfCached?.offer);
    if (nfCacheUsable && nfResolved.offer) {
      nfCacheHits += 1;
      nfOffer = {
        retailer: "no_frills",
        storeId: "3660",
        productId: nfResolved.offer.productId,
        name: nfResolved.offer.name,
        packageSize: nfResolved.offer.packageSize,
        price: nfResolved.offer.price,
        unitPrice: nfResolved.offer.unitPrice,
        availability: "unknown",
        confidence: (nfResolved.offer.confidence as "exact") ?? "exact",
        checkedAt: nfResolved.offer.checkedAt ?? new Date().toISOString(),
      };
      nfLog.queries = ["catalog_cache"];
      nfLog.status = nfCacheEval.status;
      nfLog.accepted = {
        productId: nfOffer.productId,
        name: nfOffer.name,
        price: nfOffer.price,
      };
    } else if (body.refreshNoFrills || !cacheRowExists) {
      nfOffer = await searchNoFrills(item, nfLog);
      nfLiveHits += 1;
      if (nfOffer) {
        const mass =
          parseMassFromText(nfOffer.packageSize ?? "") ??
          parseMassFromText(nfOffer.name);
        await upsertNoFrillsCatalogItem({
          id,
          label: item.label,
          status: nfLog.status,
          offer: {
            productId: nfOffer.productId,
            name: nfOffer.name,
            price: nfOffer.price,
            packageSize: nfOffer.packageSize,
            parsedMassKg: mass?.kg,
            unitPrice: nfOffer.unitPrice,
            confidence: nfOffer.confidence,
            checkedAt: nfOffer.checkedAt,
            sourceUrl: nfOffer.sourceUrl,
          },
          notes: `Cached from live NF search (TTL ${CACHE_STALE_HOURS}h)`,
        });
      } else {
        await upsertNoFrillsCatalogItem({
          id,
          label: item.label,
          status: nfLog.status,
          offer: null,
          notes: nfLog.rejected.at(-1)?.reason,
        });
      }
    } else {
      nfLog.queries = ["catalog_cache"];
      nfLog.status = "rejected";
      nfLog.rejected.push({
        productId: nfCached?.offer?.productId,
        name: nfCached?.offer?.name,
        price: nfCached?.offer?.price,
        reason: nfResolved.detail ?? "filter",
      });
    }
    entries.push(nfLog);

    const wmLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "walmart_ca",
      queries: cat ? ["catalog_cache"] : [],
      rejected: [],
      status: wmEval.status,
    };
    if (wmUsable && wmOffer) {
      wmLog.accepted = {
        productId: wmOffer.productId,
        name: wmOffer.name,
        price: wmOffer.price,
      };
    } else {
      wmLog.rejected.push({
        reason: wmEval.reason ?? wmResolved.detail ?? wmEval.status,
        productId: cat?.offer?.productId,
        name: cat?.offer?.name,
        price: cat?.offer?.price,
      });
    }
    entries.push(wmLog);

    const rawGrams = Number(body.grams?.[id]);
    const soldByWeight = isSoldByWeightItem(item);
    const grams =
      soldByWeight && Number.isFinite(rawGrams) && rawGrams > 0
        ? rawGrams
        : soldByWeight
          ? 1000
          : null;

    const nfEval = nfCacheUsable
      ? nfCacheEval
      : {
          status: nfLog.status,
          reason: nfLog.rejected.at(-1)?.reason,
          ageLabel: null as string | null,
        };

    const nfCatalogOffer: CatalogOffer | null = nfOffer
      ? {
          productId: nfOffer.productId,
          name: nfOffer.name,
          price: nfOffer.price,
          packageSize: nfOffer.packageSize,
          unitPrice: nfOffer.unitPrice,
          confidence: nfOffer.confidence,
          checkedAt: nfOffer.checkedAt,
          sourceUrl: nfOffer.sourceUrl,
        }
      : null;
    const nfUsable = Boolean(
      nfCatalogOffer &&
        (nfEval.status === "ok" || nfEval.status === "stale"),
    );

    rows.push(
      buildStapleCompareRow({
        item,
        wmOffer: wmUsable ? wmOffer : null,
        nfOffer: nfUsable ? nfCatalogOffer : null,
        wmEval,
        nfEval,
        wmUsable,
        nfUsable,
        grams,
        confirmed: Boolean(conf),
        mappingDecision: wmLink?.decision,
        resolveReason: {
          walmart: wmResolved.reason,
          noFrills: nfCacheUsable ? nfResolved.reason : undefined,
        },
        nfUpc: nfOffer?.upc,
      }),
    );
  }

  const complete = rows.filter((r) => r.cheaper !== "incomplete");
  const wmSum = complete.reduce((s, r) => s + (r.basketWalmart ?? 0), 0);
  const nfSum = complete.reduce((s, r) => s + (r.basketNoFrills ?? 0), 0);

  const logId = await appendMatchLog(entries);

  return NextResponse.json({
    ok: true,
    comparedAt: new Date().toISOString(),
    walmartSource: resolveWalmartSource(),
    noFrillsSource:
      nfLiveHits === 0 && nfCacheHits > 0
        ? "catalog_cache"
        : nfCacheHits > 0
          ? "cache_and_live"
          : nfLiveHits > 0
            ? "live_api"
            : "catalog_cache",
    nfCacheHits,
    nfLiveHits,
    stores: ["walmart_5831", "nofrills_3660"],
    sobeysEnabled: false,
    matchLogId: logId,
    rows,
    totals: {
      completeCount: complete.length,
      walmart: Math.round(wmSum * 100) / 100,
      noFrills: Math.round(nfSum * 100) / 100,
      cheaper:
        complete.length === 0
          ? "incomplete"
          : wmSum < nfSum
            ? "walmart"
            : nfSum < wmSum
              ? "nofrills"
              : "tie",
      note: "Порівнянна сума: різні пачки → $/kg, яйця → 30 шт, схожі пачки → ціна полиці. Відхилена identity (різний товар) не входить у кошик.",
    },
  });
}

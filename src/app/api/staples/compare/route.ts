import { NextResponse } from "next/server";
import { walmartSourceApiFields } from "@/connectors/walmart-source";
import {
  appendMatchLog,
  CACHE_STALE_HOURS,
  evaluateOfferStatus,
  isShownStaple,
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  pickStapleSearchWinner,
  searchNoFrillsPool,
  searchWalmartPackPool,
  defaultNeededGrams,
  isSoldByWeightItem,
  resolveMatchMode,
  usesNeededWeightPick,
  type CatalogOffer,
  type MatchLogEntry,
} from "@/lib/staples";
import { resolveCatalogOffer } from "@/domain/compare-resolve";
import { buildStapleCompareRow } from "@/lib/staple-compare-row";
import {
  mergeLivePackSizes,
  packSizeNotes,
  persistPackSizeRow,
  shouldExpandPackSizes,
} from "@/lib/expand-pack-sizes";
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
    image?: string;
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
    image: offer.image,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    /** If true, always hit No Frills live API (skip NF cache). */
    refreshNoFrills?: boolean;
    /** Grams needed for sold-by-weight items (id → grams). */
    grams?: Record<string, number>;
    /** Pack / carton count for other staples (id → qty). Default 1. */
    qty?: Record<string, number>;
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

    const rawGrams = Number(body.grams?.[id]);
    const neededPick = usesNeededWeightPick(item);
    const soldByWeight = isSoldByWeightItem(item);
    const grams =
      neededPick && Number.isFinite(rawGrams) && rawGrams > 0
        ? rawGrams
        : neededPick
          ? defaultNeededGrams(item)
          : null;
    const packPickGrams =
      neededPick && !soldByWeight && grams != null ? grams : undefined;

    let wmRow = catById.get(id) ?? null;
    let wmResolved = resolveCatalogOffer({
      item,
      row: wmRow,
      link: wmLink,
      matchMode: mode,
      neededGrams: packPickGrams,
    });

    const wmLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "walmart_ca",
      queries: wmRow ? ["catalog_cache"] : [],
      rejected: [],
      status: "no_match",
    };
    if (
      shouldExpandPackSizes({
        item,
        neededGrams: packPickGrams,
        link: wmLink,
        row: wmRow,
      })
    ) {
      const pool = await searchWalmartPackPool(item, wmLog);
      if (pool.length) {
        const merged = mergeLivePackSizes({
          item,
          row: wmRow,
          live: pool,
          keepProductId: wmRow?.offer?.productId,
        });
        await persistPackSizeRow({
          retailer: "walmart_ca",
          id,
          label: item.label,
          offer: merged.offer,
          alternates: merged.alternates,
          notes: packSizeNotes(
            "walmart_ca",
            1 + merged.alternates.length,
          ),
          image: item.image,
        });
        wmRow = {
          id,
          status: merged.offer ? "ok" : "no_match",
          offer: merged.offer,
          alternates: merged.alternates,
        };
        catById.set(id, wmRow);
        wmResolved = resolveCatalogOffer({
          item,
          row: wmRow,
          link: wmLink,
          matchMode: mode,
          neededGrams: packPickGrams,
        });
      }
    }

    const wmOffer = toCatalogOffer(wmResolved.offer);
    const wmEval = evaluateOfferStatus(item, wmOffer, {
      unavailable: item.unavailableAtWalmart,
      catalogStatus:
        wmResolved.reason === "mapped_sku_missing" ||
        wmResolved.reason === "rejected_filter"
          ? "no_match"
          : wmRow?.status,
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
      wmRow?.status !== "unavailable";
    wmLog.status = wmEval.status;
    if (wmUsable && wmOffer) {
      wmLog.accepted = {
        productId: wmOffer.productId,
        name: wmOffer.name,
        price: wmOffer.price,
      };
    } else {
      wmLog.rejected.push({
        reason: wmEval.reason ?? wmResolved.detail ?? wmEval.status,
        productId: wmRow?.offer?.productId,
        name: wmRow?.offer?.name,
        price: wmRow?.offer?.price,
      });
    }
    entries.push(wmLog);

    let nfRow = nfById.get(id) ?? null;
    let nfResolved = resolveCatalogOffer({
      item,
      row: nfRow,
      link: nfLink,
      matchMode: mode,
      neededGrams: packPickGrams,
    });
    const nfCacheEval = evaluateOfferStatus(item, nfResolved.offer, {
      catalogStatus:
        nfResolved.reason === "rejected_filter"
          ? "no_match"
          : nfRow?.status,
    });
    const needNfExpand = shouldExpandPackSizes({
      item,
      neededGrams: packPickGrams,
      link: nfLink,
      row: nfRow,
    });
    const nfCacheUsable =
      !body.refreshNoFrills &&
      !needNfExpand &&
      Boolean(nfResolved.offer) &&
      (nfCacheEval.status === "ok" || nfCacheEval.status === "stale");

    const nfLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "no_frills",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    let nfOfferUpc: string | undefined;
    let nfCatalogOffer: CatalogOffer | null = null;
    if (nfCacheUsable && nfResolved.offer) {
      nfCacheHits += 1;
      nfCatalogOffer = toCatalogOffer(nfResolved.offer);
      nfLog.queries = ["catalog_cache"];
      nfLog.status = nfCacheEval.status;
      nfLog.accepted = {
        productId: nfResolved.offer.productId,
        name: nfResolved.offer.name,
        price: nfResolved.offer.price,
      };
    } else if (body.refreshNoFrills || !nfRow?.offer || needNfExpand) {
      const pool = await searchNoFrillsPool(item, nfLog);
      nfLiveHits += 1;
      const best = pickStapleSearchWinner(item, pool, nfLog);
      if (pool.length || best) {
        const merged = mergeLivePackSizes({
          item,
          row: nfRow,
          live: pool,
          keepProductId: body.refreshNoFrills
            ? best?.productId
            : (nfRow?.offer?.productId ?? best?.productId),
        });
        const offer = merged.offer ?? (best ? {
          productId: best.productId,
          name: best.name,
          price: best.price,
          packageSize: best.packageSize,
          image: best.image,
        } : null);
        await persistPackSizeRow({
          retailer: "no_frills",
          id,
          label: item.label,
          offer,
          alternates: merged.alternates,
          notes:
            merged.alternates.length > 0
              ? packSizeNotes("no_frills", 1 + merged.alternates.length)
              : `Cached from live NF search (TTL ${CACHE_STALE_HOURS}h)`,
        });
        nfRow = {
          id,
          status: offer ? "ok" : "no_match",
          offer,
          alternates: merged.alternates,
        };
        nfById.set(id, nfRow);
        nfResolved = resolveCatalogOffer({
          item,
          row: nfRow,
          link: nfLink,
          matchMode: mode,
          neededGrams: packPickGrams,
        });
        nfCatalogOffer = toCatalogOffer(nfResolved.offer);
        nfOfferUpc = best?.upc;
      } else if (nfRow?.offer && !body.refreshNoFrills) {
        nfCatalogOffer = toCatalogOffer(nfResolved.offer);
        nfLog.rejected.push({
          reason: "pack-size search missed — kept catalog offer",
        });
        if (nfResolved.offer) {
          nfLog.status = nfCacheEval.status;
          nfLog.accepted = {
            productId: nfResolved.offer.productId,
            name: nfResolved.offer.name,
            price: nfResolved.offer.price,
          };
        }
      } else {
        await persistPackSizeRow({
          retailer: "no_frills",
          id,
          label: item.label,
          offer: null,
          alternates: [],
          notes: nfLog.rejected.at(-1)?.reason ?? "no_match",
        });
      }
    } else {
      nfLog.queries = ["catalog_cache"];
      nfLog.status = "rejected";
      nfLog.rejected.push({
        productId: nfRow?.offer?.productId,
        name: nfRow?.offer?.name,
        price: nfRow?.offer?.price,
        reason: nfResolved.detail ?? "filter",
      });
    }
    entries.push(nfLog);

    const rawQty = Number(body.qty?.[id]);
    const qty =
      !soldByWeight && Number.isFinite(rawQty) && rawQty > 0
        ? Math.max(1, Math.round(rawQty))
        : 1;

    const nfEval = nfCacheUsable
      ? nfCacheEval
      : nfCatalogOffer
        ? evaluateOfferStatus(item, nfCatalogOffer, {
            catalogStatus: nfRow?.status,
          })
        : {
            status: nfLog.status,
            reason: nfLog.rejected.at(-1)?.reason,
            ageLabel: null as string | null,
          };

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
        qty,
        confirmed: Boolean(conf),
        mappingDecision: wmLink?.decision,
        resolveReason: {
          walmart: wmResolved.reason,
          noFrills: nfResolved.reason,
        },
        nfUpc: nfOfferUpc,
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
    ...walmartSourceApiFields(),
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
      note: "Порівнянна сума: різні пачки → $/kg × кг, яйця → 30 шт × пачки, схожі пачки → ціна полиці × кількість. Відхилена identity не входить у кошик.",
    },
  });
}

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
  summarizeOffer,
  upsertNoFrillsCatalogItem,
  isSoldByWeightItem,
  isEggPackItem,
  resolveMatchMode,
  type MatchLogEntry,
} from "@/lib/staples";
import { parseMassFromText } from "@/domain/units";
import {
  basketAmountForSide,
  classifyMatchKind,
  extractBarcodes,
  fairCompareSides,
  packMassKg,
} from "@/domain/fair-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

    // Apply confirmed preferred id
    if (confirmed[id]?.productId) {
      item.preferredProductId = confirmed[id].productId;
    }

    const cat = catById.get(id);
    const wmEval = evaluateOfferStatus(item, cat?.offer ?? null, {
      unavailable: item.unavailableAtWalmart,
      catalogStatus: cat?.status,
    });

    const wmUsable =
      cat?.offer &&
      (wmEval.status === "ok" || wmEval.status === "stale") &&
      cat.status !== "wrong_pack" &&
      cat.status !== "wrong_size" &&
      cat.status !== "unavailable";

    const wmRaw = wmUsable
      ? {
          name: cat!.offer!.name,
          price: cat!.offer!.price,
          productId: cat!.offer!.productId,
          packageSize: cat!.offer!.packageSize,
          unitPrice: cat!.offer!.unitPrice,
          confidence: cat!.offer!.confidence,
          checkedAt: cat!.offer!.checkedAt,
        }
      : null;

    const nfCached = nfById.get(id);
    const nfCacheEval = evaluateOfferStatus(item, nfCached?.offer ?? null, {
      catalogStatus: nfCached?.status,
    });
    const nfCacheUsable =
      !body.refreshNoFrills &&
      nfCached?.offer &&
      (nfCacheEval.status === "ok" || nfCacheEval.status === "stale") &&
      nfCached.status !== "wrong_pack" &&
      nfCached.status !== "wrong_size";

    const nfLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "no_frills",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    let nfOffer = null as Awaited<ReturnType<typeof searchNoFrills>>;
    if (nfCacheUsable && nfCached?.offer) {
      nfCacheHits += 1;
      nfOffer = {
        retailer: "no_frills",
        storeId: "3660",
        productId: nfCached.offer.productId,
        name: nfCached.offer.name,
        packageSize: nfCached.offer.packageSize,
        price: nfCached.offer.price,
        unitPrice: nfCached.offer.unitPrice,
        availability: "unknown",
        confidence: (nfCached.offer.confidence as "exact") ?? "exact",
        checkedAt: nfCached.offer.checkedAt ?? new Date().toISOString(),
      };
      nfLog.queries = ["catalog_cache"];
      nfLog.status = nfCacheEval.status;
      nfLog.accepted = {
        productId: nfOffer.productId,
        name: nfOffer.name,
        price: nfOffer.price,
      };
    } else {
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
    if (wmRaw) {
      wmLog.accepted = {
        productId: wmRaw.productId,
        name: wmRaw.name,
        price: wmRaw.price,
      };
    } else {
      wmLog.rejected.push({
        reason: wmEval.reason ?? wmEval.status,
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
    const qtyKg = grams != null ? grams / 1000 : 1;

    const walmart = summarizeOffer(item, wmRaw, qtyKg, "walmart_ca");
    const noFrills = summarizeOffer(
      item,
      nfOffer
        ? {
            name: nfOffer.name,
            price: nfOffer.price,
            productId: nfOffer.productId,
            packageSize: nfOffer.packageSize,
            unitPrice: nfOffer.unitPrice,
            confidence: nfOffer.confidence,
            checkedAt: nfOffer.checkedAt,
            retailer: "no_frills",
          }
        : null,
      qtyKg,
      "no_frills",
    );

    const egg = isEggPackItem(item);
    const wmOk =
      walmart &&
      (walmart.status === "ok" || walmart.status === "stale") &&
      walmart.lineTotal != null;
    const nfOk =
      noFrills &&
      (noFrills.status === "ok" || noFrills.status === "stale") &&
      noFrills.lineTotal != null;

    const fair = fairCompareSides(
      {
        ok: Boolean(wmOk),
        shelfPrice: walmart?.shelfPrice,
        lineTotal: walmart?.lineTotal,
        pricePerKg: egg ? null : walmart?.pricePerKg,
        pricePerEach: walmart?.pricePerEach,
        packKg: packMassKg(walmart?.name, walmart?.pack),
        isEgg: egg,
      },
      {
        ok: Boolean(nfOk),
        shelfPrice: noFrills?.shelfPrice,
        lineTotal: noFrills?.lineTotal,
        pricePerKg: egg ? null : noFrills?.pricePerKg,
        pricePerEach: noFrills?.pricePerEach,
        packKg: packMassKg(noFrills?.name, noFrills?.pack),
        isEgg: egg,
      },
    );

    const wmBasket = basketAmountForSide(
      fair,
      "walmart",
      wmOk ? walmart!.lineTotal : null,
    );
    const nfBasket = basketAmountForSide(
      fair,
      "nofrills",
      nfOk ? noFrills!.lineTotal : null,
    );

    const matchKind = classifyMatchKind({
      mode: resolveMatchMode(item),
      preferredId: item.preferredProductId,
      productId: walmart?.productId ?? noFrills?.productId ?? "",
      upc: nfOffer?.upc,
      targetUpcs: extractBarcodes(...item.queries, item.preferredProductId),
    });

    rows.push({
      id: item.id,
      label: item.label,
      image: item.image ?? null,
      confirmed: Boolean(confirmed[id]),
      soldByWeight,
      grams,
      matchKind,
      fairBasis: fair.fairBasis,
      fairLabel: fair.fairLabel,
      walmart: walmart
        ? {
            ...walmart,
            ageLabel: wmEval.ageLabel,
            cardStatus: wmUsable ? wmEval.status : wmEval.status,
          }
        : {
            status: wmEval.status,
            statusReason: wmEval.reason,
            lineTotal: null,
            compareUnitLabel: null,
          },
      noFrills: noFrills
        ? {
            ...noFrills,
            ageLabel: nfCacheUsable ? nfCacheEval.ageLabel : null,
          }
        : {
            status: nfLog.status,
            statusReason: nfLog.rejected.at(-1)?.reason,
            lineTotal: null,
            compareUnitLabel: null,
          },
      cheaper: fair.cheaper,
      delta: fair.delta,
      basketWalmart: wmBasket,
      basketNoFrills: nfBasket,
    });
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
          : "live_api",
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
      note: "Порівнянна сума: різні пачки → $/kg, яйця → 30 шт, схожі пачки → ціна полиці.",
    },
  });
}

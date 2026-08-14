import { NextResponse } from "next/server";
import { resolveWalmartSource } from "@/connectors/walmart-source";
import {
  appendMatchLog,
  CACHE_STALE_HOURS,
  evaluateOfferStatus,
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  PINNED_IDS,
  searchNoFrills,
  summarizeOffer,
  upsertNoFrillsCatalogItem,
  type MatchLogEntry,
} from "@/lib/staples";
import { parseMassFromText } from "@/domain/units";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    /** If true, always hit No Frills live API (skip NF cache). */
    refreshNoFrills?: boolean;
  };
  const wanted = (body.ids?.length ? body.ids : [...PINNED_IDS]).filter((id) =>
    (PINNED_IDS as readonly string[]).includes(id),
  );

  const cfg = await loadStaplesConfig();
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

    const walmart = summarizeOffer(item, wmRaw, 1, "walmart_ca");
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
      1,
      "no_frills",
    );

    // Fair delta always on $/kg when both sides have weight prices; else pack lineTotal
    const wmFair =
      walmart?.pricePerKg ??
      (walmart && (walmart.status === "ok" || walmart.status === "stale")
        ? walmart.lineTotal
        : null);
    const nfFair =
      noFrills?.pricePerKg ??
      (noFrills && (noFrills.status === "ok" || noFrills.status === "stale")
        ? noFrills.lineTotal
        : null);

    const wmLine =
      walmart && (walmart.status === "ok" || walmart.status === "stale")
        ? (walmart.nativeUnitPrice ?? walmart.lineTotal)
        : null;
    const nfLine =
      noFrills && (noFrills.status === "ok" || noFrills.status === "stale")
        ? (noFrills.nativeUnitPrice ?? noFrills.lineTotal)
        : null;

    let cheaper: "walmart" | "nofrills" | "tie" | "incomplete" = "incomplete";
    if (wmFair != null && nfFair != null) {
      if (wmFair < nfFair) cheaper = "walmart";
      else if (nfFair < wmFair) cheaper = "nofrills";
      else cheaper = "tie";
    }

    rows.push({
      id: item.id,
      label: item.label,
      image: item.image ?? null,
      confirmed: Boolean(confirmed[id]),
      walmart: walmart
        ? {
            ...walmart,
            lineTotal: wmLine,
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
            lineTotal: nfLine,
            ageLabel: nfCacheUsable ? nfCacheEval.ageLabel : null,
          }
        : {
            status: nfLog.status,
            statusReason: nfLog.rejected.at(-1)?.reason,
            lineTotal: null,
            compareUnitLabel: null,
          },
      cheaper,
      delta:
        wmFair != null && nfFair != null
          ? Math.round((wmFair - nfFair) * 100) / 100
          : null,
      fairBasis: wmFair != null && nfFair != null ? "per_kg" : null,
    });
  }

  const complete = rows.filter((r) => r.cheaper !== "incomplete");
  const wmSum = complete.reduce((s, r) => {
    const w = r.walmart as {
      pricePerKg?: number;
      lineTotal?: number | null;
    };
    return s + (w.pricePerKg ?? w.lineTotal ?? 0);
  }, 0);
  const nfSum = complete.reduce((s, r) => {
    const n = r.noFrills as {
      pricePerKg?: number;
      lineTotal?: number | null;
    };
    return s + (n.pricePerKg ?? n.lineTotal ?? 0);
  }, 0);

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
    },
  });
}

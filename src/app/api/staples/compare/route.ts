import { NextResponse } from "next/server";
import {
  appendMatchLog,
  evaluateOfferStatus,
  loadConfirmed,
  loadStaplesConfig,
  loadWalmartCatalog,
  PINNED_IDS,
  searchNoFrills,
  summarizeOffer,
  type MatchLogEntry,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
  };
  const wanted = (body.ids?.length ? body.ids : [...PINNED_IDS]).filter((id) =>
    (PINNED_IDS as readonly string[]).includes(id),
  );

  const cfg = await loadStaplesConfig();
  const catalog = await loadWalmartCatalog();
  const confirmed = await loadConfirmed();
  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const catById = new Map(catalog?.items.map((i) => [i.id, i]) ?? []);

  const entries: MatchLogEntry[] = [];
  const rows = [];

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

    const nfLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "no_frills",
      queries: [],
      rejected: [],
      status: "no_match",
    };
    const nfOffer = await searchNoFrills(item, nfLog);
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

    const walmart = summarizeOffer(item, wmRaw);
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
          }
        : null,
    );

    const wmLine =
      walmart && (walmart.status === "ok" || walmart.status === "stale")
        ? walmart.lineTotal
        : null;
    const nfLine =
      noFrills && (noFrills.status === "ok" || noFrills.status === "stale")
        ? noFrills.lineTotal
        : null;

    let cheaper: "walmart" | "nofrills" | "tie" | "incomplete" = "incomplete";
    if (wmLine != null && nfLine != null) {
      if (wmLine < nfLine) cheaper = "walmart";
      else if (nfLine < wmLine) cheaper = "nofrills";
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
            ageLabel: wmEval.ageLabel,
            cardStatus: wmUsable ? wmEval.status : wmEval.status,
          }
        : {
            status: wmEval.status,
            statusReason: wmEval.reason,
            lineTotal: null,
            compareUnitLabel: null,
          },
      noFrills: noFrills ?? {
        status: nfLog.status,
        statusReason: nfLog.rejected.at(-1)?.reason,
        lineTotal: null,
        compareUnitLabel: null,
      },
      cheaper,
      delta:
        wmLine != null && nfLine != null
          ? Math.round((wmLine - nfLine) * 100) / 100
          : null,
    });
  }

  const complete = rows.filter((r) => r.cheaper !== "incomplete");
  const wmSum = complete.reduce(
    (s, r) => s + ((r.walmart as { lineTotal?: number | null }).lineTotal ?? 0),
    0,
  );
  const nfSum = complete.reduce(
    (s, r) =>
      s + ((r.noFrills as { lineTotal?: number | null }).lineTotal ?? 0),
    0,
  );

  const logId = await appendMatchLog(entries);

  return NextResponse.json({
    ok: true,
    comparedAt: new Date().toISOString(),
    walmartSource: "catalog_cache",
    noFrillsSource: "live_api",
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

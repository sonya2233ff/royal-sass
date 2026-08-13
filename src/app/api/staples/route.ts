import { NextResponse } from "next/server";
import {
  CACHE_STALE_HOURS,
  evaluateOfferStatus,
  loadConfirmed,
  loadStaplesConfig,
  loadWalmartCatalog,
  PINNED_IDS,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await loadStaplesConfig();
  const catalog = await loadWalmartCatalog();
  const confirmed = await loadConfirmed();
  const byId = new Map(catalog?.items.map((i) => [i.id, i]) ?? []);

  const items = cfg.items
    .filter((i) => (PINNED_IDS as readonly string[]).includes(i.id))
    .map((i) => {
      const cat = byId.get(i.id);
      const offer =
        cat?.status === "ok" || cat?.status === "stale" ? cat.offer : cat?.offer;
      const evalStatus = evaluateOfferStatus(i, offer ?? null, {
        unavailable: i.unavailableAtWalmart,
        catalogStatus: cat?.status,
      });

      // Prefer catalog rejected statuses when no usable offer
      let status = evalStatus.status;
      if (!offer && cat?.status === "wrong_pack") status = "wrong_pack";
      if (!offer && cat?.status === "wrong_size") status = "wrong_size";
      if (!offer && cat?.status === "unavailable") status = "unavailable";
      if (!offer && (cat?.status === "no_match" || !cat)) {
        status = i.unavailableAtWalmart ? "unavailable" : "no_match";
      }

      const usable =
        offer &&
        (status === "ok" || status === "stale") &&
        cat?.status !== "wrong_pack" &&
        cat?.status !== "wrong_size";

      return {
        id: i.id,
        label: i.label,
        image: i.image ?? null,
        notes: i.notes,
        status,
        statusReason: evalStatus.reason ?? null,
        ageLabel: evalStatus.ageLabel,
        ageHours: evalStatus.ageHours ?? null,
        confirmed: Boolean(confirmed[i.id]),
        confirmedProductId: confirmed[i.id]?.productId ?? null,
        preferredProductId: i.preferredProductId ?? confirmed[i.id]?.productId ?? null,
        walmartCached: usable
          ? {
              name: offer!.name,
              price: offer!.price,
              productId: offer!.productId,
              packageSize: offer!.packageSize,
              checkedAt: offer!.checkedAt ?? catalog?.checkedAt,
            }
          : null,
      };
    });

  return NextResponse.json({
    ok: true,
    stores: [
      { key: "walmart_5831", name: "Walmart #5831" },
      { key: "nofrills_3660", name: "No Frills #3660" },
    ],
    sobeysEnabled: false,
    cacheStaleHours: CACHE_STALE_HOURS,
    catalogCheckedAt: catalog?.checkedAt ?? null,
    items,
  });
}

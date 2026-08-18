import { NextResponse } from "next/server";
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";
import { refreshSobeysSelected } from "@/lib/sobeys-observe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Match the current Ontario weekly flyer onto selected staples (estimated). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  const cfg = await loadStaplesConfig();
  const allowed = new Set(cfg.items.filter(isShownStaple).map((i) => i.id));
  const ids = (body.ids?.length ? body.ids : [...allowed]).filter((id) =>
    allowed.has(id),
  );
  if (!ids.length) {
    return NextResponse.json(
      { ok: false, error: "ids required" },
      { status: 400 },
    );
  }

  try {
    const result = await refreshSobeysSelected(ids);
    return NextResponse.json({
      ok: true,
      retailer: "sobeys",
      storeId: "659",
      priceConfidence: "ESTIMATED",
      note: "Weekly Ontario flyer — not Clark & Hilda shelf",
      flyer: result.flyer,
      updated: result.updated,
      unmatched: result.unmatched,
      matchLogId: result.logId,
      entries: result.entries.map((e) => ({
        itemId: e.itemId,
        status: e.status,
        accepted: e.accepted ?? null,
        rejected: e.rejected.slice(-3),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

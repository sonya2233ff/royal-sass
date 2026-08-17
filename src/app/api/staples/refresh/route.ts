import { NextResponse } from "next/server";
import { resolveWalmartSource } from "@/connectors/walmart-source";
import {
  isShownStaple,
  loadStaplesConfig,
  refreshWalmartSelected,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Refresh Walmart prices for selected staple ids only. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  const cfg = await loadStaplesConfig();
  const allowed = new Set(cfg.items.filter(isShownStaple).map((i) => i.id));
  const ids = (body.ids ?? []).filter((id) => allowed.has(id));
  if (!ids.length) {
    return NextResponse.json(
      { ok: false, error: "ids required (selected SKUs only)" },
      { status: 400 },
    );
  }

  try {
    const result = await refreshWalmartSelected(ids);
    return NextResponse.json({
      ok: true,
      walmartSource: resolveWalmartSource(),
      updated: result.updated,
      matchLogId: result.logId,
      entries: result.entries,
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

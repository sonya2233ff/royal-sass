import { NextResponse } from "next/server";
import { PINNED_IDS, refreshWalmartSelected } from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Refresh Walmart prices for selected staple ids only. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  const ids = (body.ids ?? []).filter((id) =>
    (PINNED_IDS as readonly string[]).includes(id),
  );
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

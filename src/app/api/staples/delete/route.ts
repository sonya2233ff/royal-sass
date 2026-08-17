import { NextResponse } from "next/server";
import {
  deleteStaplesCompletely,
  isShownStaple,
  loadStaplesConfig,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remove staples from the shown list, catalogs, mappings, and confirmations. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  const cfg = await loadStaplesConfig();
  const allowed = new Set(cfg.items.filter(isShownStaple).map((item) => item.id));
  const ids = (body.ids ?? []).filter((id) => allowed.has(id));
  if (!ids.length) {
    return NextResponse.json(
      { ok: false, error: "ids required" },
      { status: 400 },
    );
  }

  try {
    const result = await deleteStaplesCompletely(ids);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

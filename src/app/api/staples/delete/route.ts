import { NextResponse } from "next/server";
import {
  deleteStaplesCompletely,
  isShownStaple,
  loadStaplesConfig,
} from "@/lib/staples";
import { parseCustomStapleDrafts } from "@/lib/product-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hide/remove shown cafe staples. Vercel disk may not persist; client localStorage does. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: unknown;
    customStaples?: unknown;
  };
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  if (!ids.length) {
    return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  }

  const extras = parseCustomStapleDrafts(body.customStaples);
  const cfg = await loadStaplesConfig(extras);
  const allowed = new Set(cfg.items.filter(isShownStaple).map((item) => item.id));
  const wanted = ids.filter((id) => allowed.has(id));
  if (!wanted.length) {
    return NextResponse.json({ ok: false, error: "no shown staples to delete" }, { status: 400 });
  }

  try {
    const result = await deleteStaplesCompletely(wanted, extras);
    return NextResponse.json({
      ok: true,
      deleted: result.deleted,
      skipped: result.skipped,
      persisted: result.persisted,
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

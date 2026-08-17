import { NextResponse } from "next/server";
import {
  loadRemovedStapleIds,
  restoreRemovedStaples,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  try {
    const result = await restoreRemovedStaples(
      body.ids?.length ? body.ids : undefined,
    );
    const remaining = await loadRemovedStapleIds();
    return NextResponse.json({
      ok: true,
      ...result,
      removedCount: remaining.length,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

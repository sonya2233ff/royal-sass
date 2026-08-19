import { NextResponse } from "next/server";
import { parseOverrideMap } from "@/lib/product-config";
import {
  isShownStaple,
  loadStaplesConfig,
  refreshNoFrillsSelected,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Force live No Frills refresh for selected staple ids (writes NF catalog cache). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    productOverrides?: unknown;
  };
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
    const result = await refreshNoFrillsSelected(
      ids,
      parseOverrideMap(body.productOverrides),
    );
    return NextResponse.json({
      ok: true,
      retailer: "no_frills",
      storeId: "3660",
      updated: result.updated,
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

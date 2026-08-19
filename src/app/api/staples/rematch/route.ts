import { NextResponse } from "next/server";
import { walmartSourceApiFields } from "@/connectors/walmart-source";
import { parseOverrideMap } from "@/lib/product-config";
import { rematchStaples } from "@/lib/rematch-staples";
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live rematch selected staples using in-app product settings. Not price-only. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    productOverrides?: unknown;
  };
  const cfg = await loadStaplesConfig();
  const allowed = new Set(cfg.items.filter(isShownStaple).map((i) => i.id));
  const ids = (body.ids ?? []).filter((id) => allowed.has(id));
  if (!ids.length) {
    return NextResponse.json(
      { ok: false, error: "ids required (selected SKUs only)" },
      { status: 400 },
    );
  }

  const overrides = parseOverrideMap(body.productOverrides);

  try {
    const result = await rematchStaples(ids, overrides);
    const failed = [
      result.walmart.error,
      result.noFrills.error,
      result.wholesaleClub.error,
      result.mvr.error,
    ].filter(Boolean);
    const anyUpdated =
      result.walmart.updated.length +
        result.noFrills.updated.length +
        result.wholesaleClub.updated.length +
        result.mvr.updated.length >
      0;
    if (!anyUpdated && failed.length === 4 - (result.walmartSkipped ? 1 : 0)) {
      return NextResponse.json(
        {
          ok: false,
          error: failed[0] ?? "rematch failed",
          ...walmartSourceApiFields(),
          ...result,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      ...walmartSourceApiFields(),
      ...result,
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

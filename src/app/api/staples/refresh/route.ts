import { NextResponse } from "next/server";
import {
  resolveWalmartSource,
  WALMART_RAPID_MISSING_KEY,
  walmartSourceApiFields,
} from "@/connectors/walmart-source";
import { parseOverrideMap, parseCustomStapleDrafts } from "@/lib/product-config";
import {
  isShownStaple,
  loadStaplesConfig,
  refreshWalmartSelected,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Refresh Walmart prices for selected staple ids only. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    productOverrides?: unknown;
    customStaples?: unknown;
  };
  const extras = parseCustomStapleDrafts(body.customStaples);
  const cfg = await loadStaplesConfig(extras);
  const allowed = new Set(cfg.items.filter(isShownStaple).map((i) => i.id));
  const ids = (body.ids ?? []).filter((id) => allowed.has(id));
  if (!ids.length) {
    return NextResponse.json(
      { ok: false, error: "ids required (selected SKUs only)" },
      { status: 400 },
    );
  }

  if (resolveWalmartSource() === "missing_key") {
    return NextResponse.json(
      {
        ok: false,
        error: WALMART_RAPID_MISSING_KEY,
        ...walmartSourceApiFields(),
      },
      { status: 503 },
    );
  }

  try {
    const result = await refreshWalmartSelected(
      ids,
      parseOverrideMap(body.productOverrides),
      { extraItems: extras },
    );
    return NextResponse.json({
      ok: true,
      ...walmartSourceApiFields(),
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

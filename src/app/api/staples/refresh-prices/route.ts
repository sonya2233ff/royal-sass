import { NextResponse } from "next/server";
import { walmartSourceApiFields } from "@/connectors/walmart-source";
import { refreshCatalogPrices } from "@/lib/refresh-catalog-prices";
import { collectPriceRefreshIds, loadStaplesConfig } from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Re-fetch prices for already mapped/catalog SKUs. Does not rematch. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  const cfg = await loadStaplesConfig();
  const allowed = new Set(collectPriceRefreshIds(cfg.items));
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
    const result = await refreshCatalogPrices(ids);
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

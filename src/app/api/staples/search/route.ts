import { NextResponse } from "next/server";
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";
import {
  catalogSearchHay,
  searchShownCatalog,
} from "@/domain/staple-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Homepage typeahead. Shown cafe staples only — no live retailer search,
 * no adopt-other-product hits, no ranking by shelf titles.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({
      ok: true,
      q,
      staples: [],
      walmart: [],
      noFrills: [],
      wholesaleClub: [],
      mvr: [],
    });
  }

  const cfg = await loadStaplesConfig();
  const shown = cfg.items.filter(isShownStaple).map((item) => ({
    ...item,
    searchHay: catalogSearchHay(item),
  }));
  const staples = searchShownCatalog(shown, q, 12).map((item) => ({
    id: item.id,
    label: item.label,
    image: item.image ?? null,
  }));

  return NextResponse.json({
    ok: true,
    q,
    staples,
    walmart: [],
    noFrills: [],
    wholesaleClub: [],
    mvr: [],
  });
}

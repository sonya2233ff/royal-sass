import { NextResponse } from "next/server";
import { parseOverrideMap, parseCustomStapleDrafts } from "@/lib/product-config";
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";
import { refreshWholesaleClubSelected } from "@/lib/wholesaleclub-observe";
import { WHOLESALECLUB_STORE_ID } from "@/connectors/wholesaleclub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Force live Wholesale Club refresh for selected staple ids (writes WC catalog cache). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    productOverrides?: unknown;
    customStaples?: unknown;
  };
  const extras = parseCustomStapleDrafts(body.customStaples);
  const cfg = await loadStaplesConfig(extras);
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
    const result = await refreshWholesaleClubSelected(
      ids,
      parseOverrideMap(body.productOverrides),
      { extraItems: extras },
    );
    return NextResponse.json({
      ok: true,
      retailer: "wholesale_club",
      storeId: WHOLESALECLUB_STORE_ID,
      updated: result.updated,
      unmatched: result.unmatched,
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

import { NextResponse } from "next/server";
import { loadCompareStats } from "@/lib/compare-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UI_RUN_LIMIT = 40;

export async function GET() {
  const { runs, summary } = await loadCompareStats();
  return NextResponse.json({
    ok: true,
    summary,
    runs: runs.slice(0, UI_RUN_LIMIT),
  });
}

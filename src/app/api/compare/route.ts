import { NextResponse } from "next/server";
import {
  formatComparisonReport,
  runComparison,
} from "@/poc/run-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const useFixtures =
    searchParams.get("fixtures") === "1" ||
    searchParams.get("mode") === "fixtures";

  try {
    const result = await runComparison({ useFixtures });
    const report = formatComparisonReport({
      ...result,
      mode: useFixtures ? "fixtures" : "live",
    });

    return NextResponse.json({
      ok: true,
      report,
      runId: result.runId,
      comparison: result.comparison,
      fetches: result.fetches.map((f) => ({
        storeKey: f.storeKey,
        itemId: f.itemId,
        ok: f.ok,
        error: f.error,
        price: f.offer?.price,
        confidence: f.offer?.confidence,
        name: f.offer?.name,
        checkedAt: f.offer?.checkedAt,
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

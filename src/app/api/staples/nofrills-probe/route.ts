import { NextResponse } from "next/server";
import { probeNoFrillsSearch } from "@/connectors/nofrills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual No Frills PCX search probe.
 *
 * GET  /api/staples/nofrills-probe?q=bananas&storeId=3660&raw=1
 * POST { "q": "mehadrin milk", "storeId": "3660", "raw": true, "rawLimit": 5 }
 */
async function run(input: {
  q?: string;
  query?: string;
  storeId?: string;
  raw?: boolean | string | number;
  rawLimit?: number;
}) {
  const query = String(input.q ?? input.query ?? "").trim();
  const storeId = String(input.storeId ?? "3660");
  const includeRaw =
    input.raw === true ||
    input.raw === 1 ||
    input.raw === "1" ||
    input.raw === "true";
  const rawLimit =
    typeof input.rawLimit === "number" && Number.isFinite(input.rawLimit)
      ? input.rawLimit
      : 5;

  if (!query) {
    return NextResponse.json(
      {
        ok: false,
        error: "Pass q=... (search term)",
        example: "/api/staples/nofrills-probe?q=bananas&storeId=3660&raw=1",
      },
      { status: 400 },
    );
  }

  const result = await probeNoFrillsSearch({
    query,
    storeId,
    includeRaw,
    rawLimit,
  });

  return NextResponse.json({
    ...result,
    tip: "Compare mapped offers[].price vs rawTiles[].pricing — mismatches = mapper bugs.",
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return run({
    q: url.searchParams.get("q") ?? undefined,
    storeId: url.searchParams.get("storeId") ?? undefined,
    raw: url.searchParams.get("raw") ?? undefined,
    rawLimit: Number(url.searchParams.get("rawLimit") ?? "5") || 5,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    q?: string;
    query?: string;
    storeId?: string;
    raw?: boolean;
    rawLimit?: number;
  };
  return run(body);
}

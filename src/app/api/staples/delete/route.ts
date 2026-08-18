import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gone() {
  return NextResponse.json(
    { ok: false, error: "Deleting staples is disabled" },
    { status: 405 },
  );
}

/** Staple deletion is no longer available from the app. */
export async function GET() {
  return gone();
}

export async function POST() {
  return gone();
}

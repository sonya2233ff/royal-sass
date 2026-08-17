import { NextResponse } from "next/server";
import {
  inspectorEnabled,
  listInspectorStaples,
  runMatchInspect,
  type InspectorRetailer,
} from "@/lib/match-inspector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function deny() {
  return NextResponse.json(
    { ok: false, error: "Match inspector is disabled outside development" },
    { status: 404 },
  );
}

export async function GET() {
  if (!inspectorEnabled()) return deny();
  const staples = await listInspectorStaples();
  return NextResponse.json({ ok: true, staples });
}

export async function POST(request: Request) {
  if (!inspectorEnabled()) return deny();
  const body = (await request.json().catch(() => ({}))) as {
    query?: string;
    stapleId?: string;
    retailers?: InspectorRetailer[];
    live?: boolean;
    includeRaw?: boolean;
  };
  const result = await runMatchInspect(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

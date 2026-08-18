import { NextResponse } from "next/server";
import {
  applyInspectorMapping,
  inspectorEnabled,
  isInspectorRetailer,
  type InspectorRetailer,
  type MappingAction,
} from "@/lib/match-inspector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deny() {
  return NextResponse.json(
    { ok: false, error: "Match inspector is disabled outside development" },
    { status: 404 },
  );
}

export async function POST(request: Request) {
  if (!inspectorEnabled()) return deny();
  const body = (await request.json().catch(() => ({}))) as {
    action?: MappingAction;
    stapleId?: string;
    retailer?: InspectorRetailer;
    retailerProductId?: string;
    name?: string;
    storeId?: string;
  };
  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json(
      { ok: false, error: "action must be approve|reject" },
      { status: 400 },
    );
  }
  if (!body.retailer || !isInspectorRetailer(body.retailer)) {
    return NextResponse.json(
      {
        ok: false,
        error: "retailer must be walmart_ca|no_frills|wholesale_club|mvr",
      },
      { status: 400 },
    );
  }
  const result = await applyInspectorMapping({
    action: body.action,
    stapleId: String(body.stapleId ?? ""),
    retailer: body.retailer,
    retailerProductId: String(body.retailerProductId ?? ""),
    name: body.name,
    storeId: body.storeId,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

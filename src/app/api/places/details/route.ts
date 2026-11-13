import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/business-access";
import { placeDetails } from "@/lib/google-places";
import { allowRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function callerKey(request: Request, customerId: string | null): string {
  if (customerId) return customerId;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "guest";
}

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!allowRate(`details:${callerKey(request, customer?.id ?? null)}`, customer ? 20 : 8, 60_000)) {
    return NextResponse.json({ ok: false, error: "Забагато запитів. Зачекай хвилину." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { placeId?: string; sessionToken?: string };
  const result = await placeDetails(String(body.placeId ?? ""), body.sessionToken ? String(body.sessionToken) : null);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "invalid" ? 400 : result.code === "quota" ? 429 : 503;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, place: result.data });
}

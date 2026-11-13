import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/business-access";
import { geocodeAddress } from "@/lib/google-places";
import { allowRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function callerKey(request: Request, customerId: string | null): string {
  if (customerId) return customerId;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "guest";
}

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!allowRate(`geocode:${callerKey(request, customer?.id ?? null)}`, customer ? 15 : 8, 60_000)) {
    return NextResponse.json({ ok: false, error: "Забагато перевірок адреси. Зачекай хвилину." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    streetAddress?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
  const result = await geocodeAddress({
    streetAddress: String(body.streetAddress ?? ""),
    city: String(body.city ?? ""),
    province: String(body.province ?? ""),
    postalCode: String(body.postalCode ?? ""),
    country: String(body.country ?? "Canada"),
  });
  if (!result.ok) {
    const status = result.code === "invalid" ? 400 : result.code === "not_found" ? 404 : result.code === "quota" ? 429 : 503;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, place: result.data });
}

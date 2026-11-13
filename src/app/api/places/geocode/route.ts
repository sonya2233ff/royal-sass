import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/business-access";
import { geocodeAddress } from "@/lib/google-places";
import { allowRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Увійди." }, { status: 401 });
  if (!allowRate(`geocode:${customer.id}`, 15, 60_000)) {
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

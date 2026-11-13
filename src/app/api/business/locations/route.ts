import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/business-access";
import { addBusinessLocation } from "@/lib/business-location";
import { locationFromBody } from "@/lib/location-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Увійди." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    location?: unknown;
    makePrimary?: boolean;
    makeDefaultOrigin?: boolean;
  };
  const location = locationFromBody(body.location);
  if (!location) return NextResponse.json({ ok: false, error: "Потрібна підтверджена адреса." }, { status: 400 });
  const created = await addBusinessLocation(customer.id, {
    location,
    makePrimary: Boolean(body.makePrimary),
    makeDefaultOrigin: Boolean(body.makeDefaultOrigin),
  });
  if (!created.ok) return NextResponse.json(created, { status: created.status });
  return NextResponse.json(created);
}

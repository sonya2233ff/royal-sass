import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/business-access";
import { businessOverview, createBusinessWorkspace } from "@/lib/business-location";
import { locationFromBody } from "@/lib/location-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Увійди." }, { status: 401 });
  const overview = await businessOverview(customer.id);
  if (!overview.ok) return NextResponse.json(overview, { status: overview.status });
  return NextResponse.json(overview);
}

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Увійди." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    businessType?: string;
    useAsRouteOrigin?: boolean;
    location?: unknown;
  };
  const location = locationFromBody(body.location);
  if (!location) return NextResponse.json({ ok: false, error: "Потрібна підтверджена адреса." }, { status: 400 });
  try {
    const created = await createBusinessWorkspace(customer.id, {
      businessType: String(body.businessType ?? ""),
      useAsRouteOrigin: Boolean(body.useAsRouteOrigin),
      location,
    });
    if (!created.ok) return NextResponse.json(created, { status: created.status });
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося створити заклад." },
      { status: 500 },
    );
  }
}

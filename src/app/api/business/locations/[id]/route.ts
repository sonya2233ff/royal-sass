import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/business-access";
import { updateBusinessLocation, type LocationInput } from "@/lib/business-location";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Увійди." }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Partial<LocationInput> & {
    makePrimary?: boolean;
    makeDefaultOrigin?: boolean;
  };
  const updated = await updateBusinessLocation(customer.id, id, body);
  if (!updated.ok) return NextResponse.json(updated, { status: updated.status });
  return NextResponse.json(updated);
}

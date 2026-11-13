import { NextResponse } from "next/server";
import type { TransportSettingsInput } from "@/domain/transport-cost";
import { requireCustomer } from "@/lib/business-access";
import { updateTransportSettings } from "@/lib/business-location";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Увійди." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as Partial<TransportSettingsInput>;
  const patch: Partial<TransportSettingsInput> = {};
  if (body.fuelLitresPer100Km != null) patch.fuelLitresPer100Km = Number(body.fuelLitresPer100Km);
  if (body.fuelPricePerLitre != null) patch.fuelPricePerLitre = Number(body.fuelPricePerLitre);
  if (body.driverHourlyCost != null) patch.driverHourlyCost = Number(body.driverHourlyCost);
  if (body.vehicleCostPerKm === null) patch.vehicleCostPerKm = null;
  else if (body.vehicleCostPerKm != null) patch.vehicleCostPerKm = Number(body.vehicleCostPerKm);
  if (body.useInclusiveVehicleCost != null) patch.useInclusiveVehicleCost = Boolean(body.useInclusiveVehicleCost);
  if (body.parkingCost != null) patch.parkingCost = Number(body.parkingCost);
  if (body.tollCost != null) patch.tollCost = Number(body.tollCost);
  const saved = await updateTransportSettings(customer.id, patch);
  if (!saved.ok) return NextResponse.json(saved, { status: saved.status });
  return NextResponse.json(saved);
}

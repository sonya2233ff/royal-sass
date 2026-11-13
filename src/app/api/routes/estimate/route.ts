import { NextResponse } from "next/server";
import { STORES, type StoreId } from "@/app/driver/route-plan";
import { requireCustomer } from "@/lib/business-access";
import { estimateBusinessRoute } from "@/lib/business-location";
import { allowRate } from "@/lib/rate-limit";
import type { LatLngStop } from "@/lib/google-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_IDS = new Set<StoreId>(["walmart", "nofrills", "wholesaleclub", "mvr"]);

function asStop(value: unknown): LatLngStop | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { latitude?: number; longitude?: number; label?: string };
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, label: body.label ? String(body.label).slice(0, 120) : undefined };
}

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "Увійди." }, { status: 401 });
  if (!allowRate(`routes:${customer.id}`, 12, 60_000)) {
    return NextResponse.json({ ok: false, error: "Забагато розрахунків маршруту. Зачекай хвилину." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    kind?: "purchasing_loop" | "delivery" | "driver_leg";
    origin?: { mode?: string; locationId?: string; latitude?: number; longitude?: number; label?: string };
    stops?: unknown[];
    storeIds?: string[];
    returnToOrigin?: boolean;
    optimize?: boolean;
    baseline?: { distanceKm?: number; durationHours?: number };
  };
  const kind = body.kind;
  if (kind !== "purchasing_loop" && kind !== "delivery" && kind !== "driver_leg") {
    return NextResponse.json({ ok: false, error: "Невідомий тип маршруту." }, { status: 400 });
  }
  const stops: LatLngStop[] = [];
  for (const storeId of body.storeIds ?? []) {
    if (!STORE_IDS.has(storeId as StoreId)) {
      return NextResponse.json({ ok: false, error: "Невідомий магазин у маршруті." }, { status: 400 });
    }
    const store = STORES[storeId as StoreId];
    stops.push({ latitude: store.lat, longitude: store.lng, label: store.name });
  }
  for (const stop of body.stops ?? []) {
    const parsed = asStop(stop);
    if (!parsed) return NextResponse.json({ ok: false, error: "У зупинки мають бути координати." }, { status: 400 });
    stops.push(parsed);
  }
  const mode = body.origin?.mode;
  const origin =
    mode === "default"
      ? ({ mode: "default" } as const)
      : mode === "location"
        ? ({ mode: "location", locationId: String(body.origin?.locationId ?? "") } as const)
        : mode === "explicit"
          ? ({
              mode: "explicit",
              latitude: Number(body.origin?.latitude),
              longitude: Number(body.origin?.longitude),
              label: body.origin?.label,
            } as const)
          : null;
  if (!origin) return NextResponse.json({ ok: false, error: "Обери початкову точку." }, { status: 400 });
  const baseline =
    body.baseline && Number.isFinite(Number(body.baseline.distanceKm))
      ? { distanceKm: Number(body.baseline.distanceKm), durationHours: Number(body.baseline.durationHours ?? 0) }
      : undefined;
  const estimated = await estimateBusinessRoute(customer.id, {
    kind,
    origin,
    stops,
    returnToOrigin: Boolean(body.returnToOrigin),
    optimize: Boolean(body.optimize),
    baseline,
  });
  if (!estimated.ok) return NextResponse.json(estimated, { status: estimated.status });
  return NextResponse.json(estimated);
}

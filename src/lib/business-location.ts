import { compareTransportCost, type TransportCostBreakdown, type TransportSettingsInput } from "@/domain/transport-cost";
import { actorForCustomer, canEditLocations, type MemberRole } from "@/lib/business-access";
import { googleContentFresh, placeDetails } from "@/lib/google-places";
import { computeRoute, routeStops, type LatLngStop, type RouteLegResult } from "@/lib/google-routes";
import { prisma } from "@/lib/prisma";
import type { BusinessLocation, TransportSettings } from "@prisma/client";

export const BUSINESS_TYPES = ["restaurant", "cafe", "bakery", "other_food_service"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export type LocationInput = {
  locationName: string;
  formattedAddress: string;
  streetAddress: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  googlePlaceId: string | null;
  source: "google_places" | "manual";
};

export type PublicLocation = {
  id: string;
  locationName: string;
  formattedAddress: string | null;
  streetAddress: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  googlePlaceId: string | null;
  isPrimary: boolean;
  isDefaultRouteOrigin: boolean;
  source: string;
  needsRefresh: boolean;
  attribution: "google" | null;
};

const POSTAL = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

function isCanada(country: string): boolean {
  const value = country.trim().toLowerCase();
  return value === "ca" || value === "canada" || value === "канада";
}

let constraintsReady: Promise<void> | null = null;

export function ensureBusinessConstraints(): Promise<void> {
  const flag = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? "TRUE" : "1";
  constraintsReady ??= prisma
    .$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS business_location_one_primary ON "BusinessLocation" ("businessId") WHERE "isPrimary" = ${flag}`,
    )
    .then(() =>
      prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS business_location_one_default_origin ON "BusinessLocation" ("businessId") WHERE "isDefaultRouteOrigin" = ${flag}`,
      ),
    )
    .then(() =>
      prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS business_member_one_owned_workspace ON "BusinessMember" ("customerId") WHERE "role" = 'owner'`,
      ),
    )
    .then(() => undefined);
  return constraintsReady;
}

export function validateLocationInput(input: LocationInput): string | null {
  if (input.locationName.trim().length < 1) return "Вкажи назву закладу.";
  if (input.streetAddress.trim().length < 3) return "Вкажи вулицю і номер.";
  if (input.city.trim().length < 2) return "Вкажи місто.";
  if (input.province.trim().length < 2) return "Вкажи провінцію.";
  if (isCanada(input.country) && !POSTAL.test(input.postalCode.trim())) {
    return "Поштовий індекс Канади має вигляд A1A 1A1.";
  }
  if (input.postalCode.trim().length < 3) return "Вкажи поштовий індекс.";
  if (input.country.trim().length < 2) return "Вкажи країну.";
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    return "Потрібні координати адреси. Перевір адресу ще раз.";
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    return "Потрібні координати адреси. Перевір адресу ще раз.";
  }
  if (input.source !== "google_places" && input.source !== "manual") return "Невідоме джерело адреси.";
  return null;
}

function toPublic(row: BusinessLocation, now = Date.now()): PublicLocation {
  const google = row.source === "google_places";
  const fresh = !google || googleContentFresh(row.contentFetchedAt, now);
  return {
    id: row.id,
    locationName: row.locationName,
    formattedAddress: fresh ? row.formattedAddress : null,
    streetAddress: fresh ? row.streetAddress : null,
    city: fresh ? row.city : null,
    province: fresh ? row.province : null,
    postalCode: fresh ? row.postalCode : null,
    country: fresh ? row.country : null,
    latitude: fresh ? row.latitude : null,
    longitude: fresh ? row.longitude : null,
    googlePlaceId: row.googlePlaceId,
    isPrimary: row.isPrimary,
    isDefaultRouteOrigin: row.isDefaultRouteOrigin,
    source: row.source,
    needsRefresh: google && !fresh,
    attribution: google && fresh ? "google" : null,
  };
}

async function refreshIfStale(row: BusinessLocation): Promise<BusinessLocation> {
  if (row.source !== "google_places" || !row.googlePlaceId) return row;
  if (googleContentFresh(row.contentFetchedAt)) return row;
  const details = await placeDetails(row.googlePlaceId, null);
  if (!details.ok) return row;
  const now = new Date();
  return prisma.businessLocation.update({
    where: { id: row.id },
    data: {
      formattedAddress: details.data.formattedAddress || row.formattedAddress,
      streetAddress: details.data.streetAddress || row.streetAddress,
      city: details.data.city || row.city,
      province: details.data.province || row.province,
      postalCode: details.data.postalCode || row.postalCode,
      country: details.data.country || row.country,
      latitude: details.data.latitude,
      longitude: details.data.longitude,
      coordinatesFetchedAt: now,
      contentFetchedAt: now,
    },
  });
}

export function settingsFromRow(row: TransportSettings | null): TransportSettingsInput {
  return {
    fuelLitresPer100Km: row?.fuelLitresPer100Km ?? 8,
    fuelPricePerLitre: row?.fuelPricePerLitre ?? 1.6,
    driverHourlyCost: row?.driverHourlyCost ?? 20,
    vehicleCostPerKm: row?.vehicleCostPerKm ?? null,
    useInclusiveVehicleCost: row?.useInclusiveVehicleCost ?? false,
    parkingCost: row?.parkingCost ?? 0,
    tollCost: row?.tollCost ?? 0,
  };
}

async function requireOwner(customerId: string): Promise<{ businessId: string; role: MemberRole } | { error: string; status: 403 | 404 }> {
  const actor = await actorForCustomer(customerId);
  if (!actor) return { error: "Спочатку створи заклад.", status: 404 };
  if (!canEditLocations(actor.role)) return { error: "Лише власник може змінювати адресу і маршрути.", status: 403 };
  return actor;
}

export async function createBusinessWorkspace(
  customerId: string,
  input: { businessType: string; useAsRouteOrigin: boolean; location: LocationInput },
): Promise<{ ok: true; businessId: string; locationId: string } | { ok: false; error: string; status: number }> {
  if (!BUSINESS_TYPES.includes(input.businessType as BusinessType)) {
    return { ok: false, error: "Обери тип закладу.", status: 400 };
  }
  const locationError = validateLocationInput(input.location);
  if (locationError) return { ok: false, error: locationError, status: 400 };
  const existing = await actorForCustomer(customerId);
  if (existing) return { ok: false, error: "У цього акаунта вже є заклад.", status: 409 };
  await ensureBusinessConstraints();
  const now = new Date();
  const location = input.location;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: location.locationName.trim().slice(0, 120),
          businessType: input.businessType,
          members: { create: { customerId, role: "owner" } },
          transport: { create: {} },
          locations: {
            create: {
              locationName: location.locationName.trim().slice(0, 120),
              formattedAddress: location.formattedAddress.trim().slice(0, 300),
              streetAddress: location.streetAddress.trim().slice(0, 160),
              city: location.city.trim().slice(0, 80),
              province: location.province.trim().slice(0, 40),
              postalCode: location.postalCode.trim().toUpperCase().slice(0, 16),
              country: location.country.trim().slice(0, 40) || "CA",
              latitude: location.latitude,
              longitude: location.longitude,
              coordinatesFetchedAt: now,
              contentFetchedAt: location.source === "google_places" ? now : null,
              googlePlaceId: location.googlePlaceId,
              isPrimary: true,
              isDefaultRouteOrigin: input.useAsRouteOrigin,
              source: location.source,
            },
          },
        },
        include: { locations: true },
      });
      return business;
    });
    const saved = created.locations[0];
    if (!saved) return { ok: false, error: "Не вдалося зберегти адресу.", status: 500 };
    return { ok: true, businessId: created.id, locationId: saved.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/Unique constraint/i.test(message)) {
      return { ok: false, error: "У цього акаунта вже є заклад.", status: 409 };
    }
    throw error;
  }
}

export async function businessOverview(customerId: string): Promise<
  | {
      ok: true;
      business: { id: string; name: string; businessType: string };
      role: MemberRole;
      locations: PublicLocation[];
      transport: TransportSettingsInput;
    }
  | { ok: false; error: string; status: 404 }
> {
  const actor = await actorForCustomer(customerId);
  if (!actor) return { ok: false, error: "Заклад ще не створено.", status: 404 };
  const business = await prisma.business.findUnique({
    where: { id: actor.businessId },
    include: { locations: { orderBy: { createdAt: "asc" } }, transport: true },
  });
  if (!business) return { ok: false, error: "Заклад ще не створено.", status: 404 };
  const refreshed = await Promise.all(business.locations.map((row) => refreshIfStale(row)));
  return {
    ok: true,
    business: { id: business.id, name: business.name, businessType: business.businessType },
    role: actor.role,
    locations: refreshed.map((row) => toPublic(row)),
    transport: settingsFromRow(business.transport),
  };
}

export async function addBusinessLocation(
  customerId: string,
  input: { location: LocationInput; makePrimary?: boolean; makeDefaultOrigin?: boolean },
): Promise<{ ok: true; locationId: string } | { ok: false; error: string; status: number }> {
  const actor = await requireOwner(customerId);
  if ("error" in actor) return { ok: false, error: actor.error, status: actor.status };
  const locationError = validateLocationInput(input.location);
  if (locationError) return { ok: false, error: locationError, status: 400 };
  await ensureBusinessConstraints();
  const now = new Date();
  const location = input.location;
  const row = await prisma.$transaction(async (tx) => {
    if (input.makePrimary) {
      await tx.businessLocation.updateMany({
        where: { businessId: actor.businessId, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    if (input.makeDefaultOrigin) {
      await tx.businessLocation.updateMany({
        where: { businessId: actor.businessId, isDefaultRouteOrigin: true },
        data: { isDefaultRouteOrigin: false },
      });
    }
    return tx.businessLocation.create({
      data: {
        businessId: actor.businessId,
        locationName: location.locationName.trim().slice(0, 120),
        formattedAddress: location.formattedAddress.trim().slice(0, 300),
        streetAddress: location.streetAddress.trim().slice(0, 160),
        city: location.city.trim().slice(0, 80),
        province: location.province.trim().slice(0, 40),
        postalCode: location.postalCode.trim().toUpperCase().slice(0, 16),
        country: location.country.trim().slice(0, 40) || "CA",
        latitude: location.latitude,
        longitude: location.longitude,
        coordinatesFetchedAt: now,
        contentFetchedAt: location.source === "google_places" ? now : null,
        googlePlaceId: location.source === "google_places" ? location.googlePlaceId : null,
        isPrimary: Boolean(input.makePrimary),
        isDefaultRouteOrigin: Boolean(input.makeDefaultOrigin),
        source: location.source,
      },
    });
  });
  return { ok: true, locationId: row.id };
}

export async function updateBusinessLocation(
  customerId: string,
  locationId: string,
  patch: Partial<LocationInput> & { makePrimary?: boolean; makeDefaultOrigin?: boolean },
): Promise<{ ok: true; location: PublicLocation } | { ok: false; error: string; status: number }> {
  const actor = await requireOwner(customerId);
  if ("error" in actor) return { ok: false, error: actor.error, status: actor.status };
  const current = await prisma.businessLocation.findUnique({ where: { id: locationId } });
  if (!current || current.businessId !== actor.businessId) {
    return { ok: false, error: "Адресу не знайдено.", status: 404 };
  }
  const next: LocationInput = {
    locationName: patch.locationName ?? current.locationName,
    formattedAddress: patch.formattedAddress ?? current.formattedAddress,
    streetAddress: patch.streetAddress ?? current.streetAddress,
    city: patch.city ?? current.city,
    province: patch.province ?? current.province,
    postalCode: patch.postalCode ?? current.postalCode,
    country: patch.country ?? current.country,
    latitude: patch.latitude ?? current.latitude ?? Number.NaN,
    longitude: patch.longitude ?? current.longitude ?? Number.NaN,
    googlePlaceId: patch.googlePlaceId === undefined ? current.googlePlaceId : patch.googlePlaceId,
    source: patch.source ?? (current.source === "google_places" ? "google_places" : "manual"),
  };
  const locationError = validateLocationInput(next);
  if (locationError) return { ok: false, error: locationError, status: 400 };
  await ensureBusinessConstraints();
  const now = new Date();
  const addressChanged =
    next.formattedAddress !== current.formattedAddress ||
    next.latitude !== current.latitude ||
    next.longitude !== current.longitude ||
    next.googlePlaceId !== current.googlePlaceId;
  const saved = await prisma.$transaction(async (tx) => {
    if (patch.makePrimary) {
      await tx.businessLocation.updateMany({
        where: { businessId: actor.businessId, isPrimary: true, NOT: { id: locationId } },
        data: { isPrimary: false },
      });
    }
    if (patch.makeDefaultOrigin) {
      await tx.businessLocation.updateMany({
        where: { businessId: actor.businessId, isDefaultRouteOrigin: true, NOT: { id: locationId } },
        data: { isDefaultRouteOrigin: false },
      });
    }
    return tx.businessLocation.update({
      where: { id: locationId },
      data: {
        locationName: next.locationName.trim().slice(0, 120),
        formattedAddress: next.formattedAddress.trim().slice(0, 300),
        streetAddress: next.streetAddress.trim().slice(0, 160),
        city: next.city.trim().slice(0, 80),
        province: next.province.trim().slice(0, 40),
        postalCode: next.postalCode.trim().toUpperCase().slice(0, 16),
        country: next.country.trim().slice(0, 40),
        latitude: next.latitude,
        longitude: next.longitude,
        googlePlaceId: next.source === "google_places" ? next.googlePlaceId : null,
        source: next.source,
        coordinatesFetchedAt: addressChanged ? now : current.coordinatesFetchedAt,
        contentFetchedAt: next.source === "google_places" && addressChanged ? now : current.contentFetchedAt,
        isPrimary: patch.makePrimary === undefined ? current.isPrimary : Boolean(patch.makePrimary),
        isDefaultRouteOrigin:
          patch.makeDefaultOrigin === undefined ? current.isDefaultRouteOrigin : Boolean(patch.makeDefaultOrigin),
      },
    });
  });
  if (next.locationName.trim() && saved.isPrimary) {
    await prisma.business.update({
      where: { id: actor.businessId },
      data: { name: next.locationName.trim().slice(0, 120) },
    });
  }
  return { ok: true, location: toPublic(saved) };
}

export async function updateTransportSettings(
  customerId: string,
  patch: Partial<TransportSettingsInput>,
): Promise<{ ok: true; transport: TransportSettingsInput } | { ok: false; error: string; status: number }> {
  const actor = await requireOwner(customerId);
  if ("error" in actor) return { ok: false, error: actor.error, status: actor.status };
  const current = await prisma.transportSettings.findUnique({ where: { businessId: actor.businessId } });
  const next = { ...settingsFromRow(current), ...patch };
  if (next.fuelLitresPer100Km < 0 || next.fuelPricePerLitre < 0 || next.driverHourlyCost < 0) {
    return { ok: false, error: "Витрати не можуть бути від'ємними.", status: 400 };
  }
  if (next.parkingCost < 0 || next.tollCost < 0) {
    return { ok: false, error: "Витрати не можуть бути від'ємними.", status: 400 };
  }
  if (next.vehicleCostPerKm != null && next.vehicleCostPerKm < 0) {
    return { ok: false, error: "Витрати не можуть бути від'ємними.", status: 400 };
  }
  const saved = await prisma.transportSettings.upsert({
    where: { businessId: actor.businessId },
    create: { businessId: actor.businessId, ...next },
    update: next,
  });
  return { ok: true, transport: settingsFromRow(saved) };
}

export async function defaultOriginCoordinates(businessId: string): Promise<LatLngStop | null> {
  const row = await prisma.businessLocation.findFirst({
    where: { businessId, isDefaultRouteOrigin: true },
  });
  if (!row) return null;
  const fresh = await refreshIfStale(row);
  const view = toPublic(fresh);
  if (view.latitude == null || view.longitude == null) return null;
  return { latitude: view.latitude, longitude: view.longitude, label: view.locationName };
}

export async function estimateBusinessRoute(
  customerId: string,
  input: {
    kind: "purchasing_loop" | "delivery" | "driver_leg";
    origin: { mode: "default" } | { mode: "location"; locationId: string } | { mode: "explicit"; latitude: number; longitude: number; label?: string };
    stops: LatLngStop[];
    returnToOrigin: boolean;
    optimize?: boolean;
    baseline?: { distanceKm: number; durationHours: number };
    fetchImpl?: typeof fetch;
  },
): Promise<
  | {
      ok: true;
      route: RouteLegResult;
      transport: TransportCostBreakdown;
      incrementalTotal: number;
      snapshotId: string;
      origin: LatLngStop;
    }
  | { ok: false; error: string; status: number; code?: string }
> {
  const actor = await actorForCustomer(customerId);
  if (!actor) return { ok: false, error: "Заклад ще не створено.", status: 404 };
  let origin: LatLngStop | null = null;
  if (input.origin.mode === "default") {
    origin = await defaultOriginCoordinates(actor.businessId);
    if (!origin) {
      return { ok: false, error: "Початкову точку маршруту ще не обрано.", status: 400, code: "origin_not_configured" };
    }
  } else if (input.origin.mode === "location") {
    const row = await prisma.businessLocation.findUnique({ where: { id: input.origin.locationId } });
    if (!row || row.businessId !== actor.businessId) {
      return { ok: false, error: "Адресу не знайдено.", status: 404 };
    }
    const view = toPublic(await refreshIfStale(row));
    if (view.latitude == null || view.longitude == null) {
      return { ok: false, error: "Координати адреси застаріли. Онови адресу.", status: 409, code: "needs_refresh" };
    }
    origin = { latitude: view.latitude, longitude: view.longitude, label: view.locationName };
  } else {
    if (input.kind !== "driver_leg") {
      return { ok: false, error: "Власну точку старту можна задати лише для окремої поїздки водія.", status: 400 };
    }
    if (!Number.isFinite(input.origin.latitude) || !Number.isFinite(input.origin.longitude)) {
      return { ok: false, error: "Потрібні координати старту.", status: 400 };
    }
    origin = {
      latitude: input.origin.latitude,
      longitude: input.origin.longitude,
      label: input.origin.label?.slice(0, 120) || "Старт водія",
    };
  }
  const request = routeStops({
    origin,
    stops: input.stops,
    returnToOrigin: input.returnToOrigin,
    optimize: input.optimize,
  });
  if (!request) return { ok: false, error: "Додай хоча б одну зупинку.", status: 400 };
  const routed = await computeRoute(request, input.fetchImpl);
  if (!routed.ok) return { ok: false, error: routed.error, status: routed.code === "not_configured" ? 503 : 502, code: routed.code };
  const settingsRow = await prisma.transportSettings.findUnique({ where: { businessId: actor.businessId } });
  const settings = settingsFromRow(settingsRow);
  const compared = compareTransportCost({
    proposed: { distanceKm: routed.data.distanceKm, durationHours: routed.data.durationHours },
    baseline: input.baseline,
    settings,
  });
  const snapshot = await prisma.routeSnapshot.create({
    data: {
      businessId: actor.businessId,
      kind: input.kind,
      originLat: origin.latitude,
      originLng: origin.longitude,
      originLabel: origin.label ?? "",
      stopsJson: JSON.stringify(input.stops),
      distanceMeters: routed.data.distanceMeters,
      durationSeconds: Math.round(routed.data.durationSeconds),
      transportJson: JSON.stringify({
        transport: compared.proposed,
        incrementalTotal: compared.incrementalTotal,
        baseline: input.baseline ?? null,
      }),
    },
  });
  return {
    ok: true,
    route: routed.data,
    transport: compared.proposed,
    incrementalTotal: compared.incrementalTotal,
    snapshotId: snapshot.id,
    origin,
  };
}

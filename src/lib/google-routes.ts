/**
 * Google Routes API. Callers pass coordinates. This module does not know
 * which business or purchasing plan asked for the route.
 */

import { googleMapsKey, type PlacesOutcome } from "@/lib/google-places";

const ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = "routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex";

export type LatLngStop = {
  latitude: number;
  longitude: number;
  label?: string;
};

export type RouteLegRequest = {
  origin: LatLngStop;
  destination: LatLngStop;
  intermediates?: LatLngStop[];
  optimizeWaypointOrder?: boolean;
};

export type RouteLegResult = {
  distanceMeters: number;
  durationSeconds: number;
  distanceKm: number;
  durationHours: number;
  optimizedOrder: number[];
  provider: "google_routes";
};

type FetchLike = typeof fetch;

function latLng(stop: LatLngStop) {
  return { location: { latLng: { latitude: stop.latitude, longitude: stop.longitude } } };
}

export function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function routeStops(input: {
  origin: LatLngStop;
  stops: LatLngStop[];
  returnToOrigin: boolean;
  optimize?: boolean;
}): RouteLegRequest | null {
  if (!input.stops.length && !input.returnToOrigin) return null;
  if (input.returnToOrigin) {
    return {
      origin: input.origin,
      destination: input.origin,
      intermediates: input.stops,
      optimizeWaypointOrder: Boolean(input.optimize && input.stops.length > 1),
    };
  }
  const destination = input.stops[input.stops.length - 1];
  if (!destination) return null;
  const intermediates = input.stops.slice(0, -1);
  return {
    origin: input.origin,
    destination,
    intermediates,
    optimizeWaypointOrder: Boolean(input.optimize && intermediates.length > 1),
  };
}

export async function computeRoute(
  request: RouteLegRequest,
  fetchImpl: FetchLike = fetch,
): Promise<PlacesOutcome<RouteLegResult>> {
  const key = googleMapsKey();
  if (!key) {
    return { ok: false, code: "not_configured", error: "Маршрути не налаштовано. Додай GOOGLE_MAPS_API_KEY." };
  }
  let res: Response;
  try {
    res = await fetchImpl(ROUTES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origin: latLng(request.origin),
        destination: latLng(request.destination),
        intermediates: (request.intermediates ?? []).map(latLng),
        travelMode: "DRIVE",
        optimizeWaypointOrder: Boolean(request.optimizeWaypointOrder),
        units: "METRIC",
      }),
    });
  } catch {
    return { ok: false, code: "provider_failed", error: "Маршрут зараз недоступний." };
  }
  if (res.status === 429) {
    return { ok: false, code: "quota", error: "Ліміт маршрутів вичерпано. Спробуй пізніше." };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/RESOURCE_EXHAUSTED|quota/i.test(text)) {
      return { ok: false, code: "quota", error: "Ліміт маршрутів вичерпано. Спробуй пізніше." };
    }
    return { ok: false, code: "provider_failed", error: "Маршрут зараз недоступний." };
  }
  const body = (await res.json()) as {
    routes?: Array<{
      distanceMeters?: number;
      duration?: string;
      optimizedIntermediateWaypointIndex?: number[];
    }>;
  };
  const route = body.routes?.[0];
  const durationSeconds = parseDurationSeconds(route?.duration);
  if (!route || route.distanceMeters == null || durationSeconds == null) {
    return { ok: false, code: "not_found", error: "Маршрут між цими точками не знайдено." };
  }
  return {
    ok: true,
    data: {
      distanceMeters: route.distanceMeters,
      durationSeconds,
      distanceKm: Math.round((route.distanceMeters / 1000) * 1000) / 1000,
      durationHours: Math.round((durationSeconds / 3600) * 10000) / 10000,
      optimizedOrder: route.optimizedIntermediateWaypointIndex ?? [],
      provider: "google_routes",
    },
  };
}

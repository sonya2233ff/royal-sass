import type { LocationInput } from "@/lib/business-location";

export function locationFromBody(value: unknown): LocationInput | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const source = body.source === "google_places" ? "google_places" : body.source === "manual" ? "manual" : null;
  if (!source) return null;
  return {
    locationName: String(body.locationName ?? ""),
    formattedAddress: String(body.formattedAddress ?? ""),
    streetAddress: String(body.streetAddress ?? ""),
    city: String(body.city ?? ""),
    province: String(body.province ?? ""),
    postalCode: String(body.postalCode ?? ""),
    country: String(body.country ?? ""),
    latitude: Number(body.latitude),
    longitude: Number(body.longitude),
    googlePlaceId: body.googlePlaceId == null || body.googlePlaceId === "" ? null : String(body.googlePlaceId),
    source,
  };
}

/**
 * Google Places API (New) and Geocoding. The key stays on the server.
 * Autocomplete predictions are not stored. Place IDs may be stored.
 * Other Places content is kept at most 30 days and then refreshed.
 */

export const GOOGLE_CONTENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PLACES = "https://places.googleapis.com/v1";
const AUTOCOMPLETE_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text",
  "suggestions.placePrediction.structuredFormat",
].join(",");
const DETAILS_MASK = "id,displayName,formattedAddress,addressComponents,location";

export type PlaceSuggestion = {
  placeId: string;
  name: string;
  address: string;
};

export type ParsedAddress = {
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
};

export type PlacesOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: "not_configured" | "provider_failed" | "quota" | "not_found" | "invalid"; error: string };

type FetchLike = typeof fetch;

export function googleMapsKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key ? key : null;
}

export function googleContentFresh(fetchedAt: Date | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return false;
  return now - fetchedAt.getTime() < GOOGLE_CONTENT_TTL_MS;
}

type Component = { longText?: string; shortText?: string; long_name?: string; short_name?: string; types?: string[] };

function componentText(parts: Component[], type: string, short = false): string {
  const hit = parts.find((part) => part.types?.includes(type));
  if (!hit) return "";
  if (short) return hit.shortText || hit.short_name || hit.longText || hit.long_name || "";
  return hit.longText || hit.long_name || hit.shortText || hit.short_name || "";
}

export function parseAddressComponents(parts: Component[], formatted: string, name: string): Omit<ParsedAddress, "latitude" | "longitude" | "googlePlaceId"> {
  const streetNumber = componentText(parts, "street_number");
  const route = componentText(parts, "route");
  const street = [streetNumber, route].filter(Boolean).join(" ").trim();
  const city =
    componentText(parts, "locality") ||
    componentText(parts, "postal_town") ||
    componentText(parts, "sublocality") ||
    componentText(parts, "administrative_area_level_2");
  const province = componentText(parts, "administrative_area_level_1", true);
  const postalCode = componentText(parts, "postal_code");
  const country = componentText(parts, "country", true) || "CA";
  return {
    locationName: name.trim(),
    formattedAddress: formatted.trim() || [street, city, province, postalCode, country].filter(Boolean).join(", "),
    streetAddress: street,
    city,
    province,
    postalCode,
    country,
  };
}

async function readError(res: Response): Promise<"quota" | "provider_failed"> {
  if (res.status === 429) return "quota";
  const text = await res.text().catch(() => "");
  if (res.status === 403 && /RESOURCE_EXHAUSTED|quota/i.test(text)) return "quota";
  return "provider_failed";
}

export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<PlacesOutcome<PlaceSuggestion[]>> {
  const key = googleMapsKey();
  if (!key) {
    return {
      ok: false,
      code: "not_configured",
      error: "Пошук закладів не налаштовано. Введи адресу вручну.",
    };
  }
  const query = input.trim();
  if (query.length < 3) return { ok: true, data: [] };
  let res: Response;
  try {
    res = await fetchImpl(`${PLACES}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": AUTOCOMPLETE_MASK,
      },
      body: JSON.stringify({
        input: query.slice(0, 200),
        sessionToken,
        includedRegionCodes: ["ca"],
        languageCode: "uk",
      }),
    });
  } catch {
    return { ok: false, code: "provider_failed", error: "Пошук закладів зараз недоступний. Введи адресу вручну." };
  }
  if (!res.ok) {
    const code = await readError(res);
    return {
      ok: false,
      code,
      error:
        code === "quota"
          ? "Ліміт пошуку адрес вичерпано. Спробуй пізніше або введи адресу вручну."
          : "Пошук закладів зараз недоступний. Введи адресу вручну.",
    };
  }
  const body = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }>;
  };
  const data: PlaceSuggestion[] = [];
  for (const suggestion of body.suggestions ?? []) {
    const prediction = suggestion.placePrediction;
    const placeId = prediction?.placeId?.trim();
    if (!placeId) continue;
    data.push({
      placeId,
      name: prediction?.structuredFormat?.mainText?.text?.trim() || prediction?.text?.text?.trim() || placeId,
      address: prediction?.structuredFormat?.secondaryText?.text?.trim() || "",
    });
  }
  return { ok: true, data };
}

export async function placeDetails(
  placeId: string,
  sessionToken: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<PlacesOutcome<ParsedAddress>> {
  const key = googleMapsKey();
  if (!key) {
    return { ok: false, code: "not_configured", error: "Деталі адреси не налаштовано. Введи адресу вручну." };
  }
  if (!/^[A-Za-z0-9_-]{8,}$/.test(placeId)) {
    return { ok: false, code: "invalid", error: "Невірний ідентифікатор закладу." };
  }
  const url = new URL(`${PLACES}/places/${encodeURIComponent(placeId)}`);
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": DETAILS_MASK,
      },
    });
  } catch {
    return { ok: false, code: "provider_failed", error: "Не вдалося отримати адресу. Спробуй ще раз." };
  }
  if (res.status === 404) return { ok: false, code: "not_found", error: "Заклад не знайдено. Введи адресу вручну." };
  if (!res.ok) {
    const code = await readError(res);
    return { ok: false, code, error: "Не вдалося отримати адресу. Спробуй ще раз." };
  }
  const body = (await res.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    addressComponents?: Component[];
    location?: { latitude?: number; longitude?: number };
  };
  const latitude = body.location?.latitude;
  const longitude = body.location?.longitude;
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, code: "not_found", error: "У цього закладу немає координат. Введи адресу вручну." };
  }
  const parsed = parseAddressComponents(
    body.addressComponents ?? [],
    body.formattedAddress ?? "",
    body.displayName?.text ?? "",
  );
  return {
    ok: true,
    data: { ...parsed, latitude, longitude, googlePlaceId: body.id || placeId },
  };
}

export async function geocodeAddress(
  input: { streetAddress: string; city: string; province: string; postalCode: string; country: string },
  fetchImpl: FetchLike = fetch,
): Promise<PlacesOutcome<ParsedAddress>> {
  const key = googleMapsKey();
  if (!key) {
    return { ok: false, code: "not_configured", error: "Перевірка адреси не налаштована. Додай GOOGLE_MAPS_API_KEY." };
  }
  const country = input.country.trim() || "Canada";
  const address = [input.streetAddress, input.city, input.province, input.postalCode, country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  if (address.length < 8) {
    return { ok: false, code: "invalid", error: "Адреса надто коротка." };
  }
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  const countryCode = /^ca$|canada/i.test(country) ? "CA" : "";
  if (countryCode) url.searchParams.set("components", `country:${countryCode}`);
  url.searchParams.set("key", key);
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch {
    return { ok: false, code: "provider_failed", error: "Перевірка адреси зараз недоступна." };
  }
  if (!res.ok) {
    const code = await readError(res);
    return { ok: false, code, error: "Перевірка адреси зараз недоступна." };
  }
  const body = (await res.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      place_id?: string;
      address_components?: Component[];
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  if (body.status === "OVER_QUERY_LIMIT") {
    return { ok: false, code: "quota", error: "Ліміт перевірки адрес вичерпано. Спробуй пізніше." };
  }
  if (body.status === "ZERO_RESULTS" || !body.results?.length) {
    return { ok: false, code: "not_found", error: "Адресу не знайдено. Перевір вулицю, місто і поштовий індекс." };
  }
  if (body.status && body.status !== "OK") {
    return { ok: false, code: "provider_failed", error: "Перевірка адреси зараз недоступна." };
  }
  const top = body.results[0];
  const latitude = top.geometry?.location?.lat;
  const longitude = top.geometry?.location?.lng;
  if (latitude == null || longitude == null) {
    return { ok: false, code: "not_found", error: "Адресу не знайдено. Перевір вулицю, місто і поштовий індекс." };
  }
  const parsed = parseAddressComponents(top.address_components ?? [], top.formatted_address ?? address, "");
  return {
    ok: true,
    data: {
      ...parsed,
      latitude,
      longitude,
      googlePlaceId: top.place_id ?? null,
    },
  };
}

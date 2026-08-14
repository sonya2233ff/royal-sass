/**
 * Factory: Walmart source = rapid (OpenWeb Ninja / RapidAPI) | browser (Playwright).
 * Default: rapid when a key is set, else browser.
 */
import type { RetailerConnector } from "./types";
import { WalmartConnector } from "./walmart";
import {
  isWalmartRapidConfigured,
  WalmartRapidConnector,
} from "./walmart-rapid";

export type WalmartSource = "rapid" | "browser";

export function resolveWalmartSource(): WalmartSource {
  const raw = (process.env.WALMART_SOURCE ?? "").trim().toLowerCase();
  if (raw === "rapid" || raw === "browser") return raw;
  return isWalmartRapidConfigured() ? "rapid" : "browser";
}

export function createWalmartConnector(
  postalCode = process.env.WALMART_POSTAL_CODE ?? "L4J0A7",
): RetailerConnector {
  const source = resolveWalmartSource();
  if (source === "rapid") {
    if (!isWalmartRapidConfigured()) {
      throw new Error(
        "WALMART_SOURCE=rapid but OPENWEBNINJA_API_KEY / RAPIDAPI_KEY is missing",
      );
    }
    return new WalmartRapidConnector(postalCode);
  }
  return new WalmartConnector(postalCode);
}

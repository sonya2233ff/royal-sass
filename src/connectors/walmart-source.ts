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
  if (raw === "rapid") {
    return isWalmartRapidConfigured() ? "rapid" : "browser";
  }
  if (raw === "browser") return "browser";
  return isWalmartRapidConfigured() ? "rapid" : "browser";
}

export function createWalmartConnector(
  postalCode = process.env.WALMART_POSTAL_CODE ?? "L4J0A7",
): RetailerConnector {
  if (resolveWalmartSource() === "rapid") {
    return new WalmartRapidConnector(postalCode);
  }
  return new WalmartConnector(postalCode);
}

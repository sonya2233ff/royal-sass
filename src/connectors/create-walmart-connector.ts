/**
 * Instantiates the live Walmart connector (RapidAPI or walmart.ca SSR).
 * Keep this off GET /api/staples so the homepage does not load Playwright.
 */
import type { RetailerConnector } from "./types";
import { WalmartConnector } from "./walmart";
import { WalmartRapidConnector } from "./walmart-rapid";
import {
  assertWalmartLiveSourceReady,
  resolveWalmartSource,
} from "./walmart-source";

export function createWalmartConnector(
  postalCode = process.env.WALMART_POSTAL_CODE ?? "L4J0A7",
): RetailerConnector {
  assertWalmartLiveSourceReady();
  if (resolveWalmartSource() === "rapid") {
    return new WalmartRapidConnector(postalCode);
  }
  return new WalmartConnector(postalCode);
}

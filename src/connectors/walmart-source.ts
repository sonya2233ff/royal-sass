/**
 * Which Walmart live path is configured (RapidAPI vs walmart.ca SSR).
 * Does not import Playwright — homepage GET /api/staples only needs this file.
 *
 * WALMART_SOURCE=rapid with a blank key must not scrape walmart.ca (PerimeterX).
 * Unset WALMART_SOURCE still means: Rapid when a key is present, else browser.
 */
import { ConnectorError } from "./types";

export type WalmartSource = "rapid" | "browser" | "missing_key";
export type WalmartSourceRequest = "rapid" | "browser" | "auto";

export const WALMART_RAPID_MISSING_KEY =
  "WALMART_SOURCE=rapid but OPENWEBNINJA_API_KEY and RAPIDAPI_KEY are empty. Refusing to scrape walmart.ca (PerimeterX). Set a RapidAPI or OpenWeb Ninja key in .env and on Vercel.";

type EnvLike = Record<string, string | undefined>;

export function requestedWalmartSource(
  env: EnvLike = process.env,
): WalmartSourceRequest {
  const raw = (env.WALMART_SOURCE ?? "").trim().toLowerCase();
  if (raw === "rapid") return "rapid";
  if (raw === "browser") return "browser";
  return "auto";
}

export function rapidKeyPresent(env: EnvLike = process.env): boolean {
  return Boolean(env.OPENWEBNINJA_API_KEY?.trim() || env.RAPIDAPI_KEY?.trim());
}

export function resolveWalmartSource(
  env: EnvLike = process.env,
): WalmartSource {
  const requested = requestedWalmartSource(env);
  const hasKey = rapidKeyPresent(env);
  if (requested === "rapid") return hasKey ? "rapid" : "missing_key";
  if (requested === "browser") return "browser";
  return hasKey ? "rapid" : "browser";
}

export function walmartSourceWarning(
  env: EnvLike = process.env,
): string | null {
  return resolveWalmartSource(env) === "missing_key"
    ? WALMART_RAPID_MISSING_KEY
    : null;
}

export function walmartSourceApiFields(env: EnvLike = process.env) {
  return {
    walmartSource: resolveWalmartSource(env),
    walmartRapidConfigured: rapidKeyPresent(env),
    walmartSourceWarning: walmartSourceWarning(env),
  };
}

export function assertWalmartLiveSourceReady(
  env: EnvLike = process.env,
): void {
  if (resolveWalmartSource(env) === "missing_key") {
    throw new ConnectorError(
      WALMART_RAPID_MISSING_KEY,
      "walmart_ca",
      "unsupported",
    );
  }
}


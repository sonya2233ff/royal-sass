/**
 * PCX (No Frills / Wholesale Club) session helpers.
 *
 * The BFF body already mints a fresh cartId + sessionId per request. Akamai
 * still 403s some datacenter IPs unless the process first harvests Set-Cookie
 * from the banner homepage (and retries). Cookie values are never logged.
 */

export const PCX_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const JAR_TTL_MS = 20 * 60 * 1000;
const ATTR_NAMES = new Set([
  "expires",
  "max-age",
  "path",
  "domain",
  "secure",
  "httponly",
  "samesite",
  "partitioned",
]);

export type CookieJar = Map<string, string>;

type CachedJar = { jar: CookieJar; fetchedAt: number };

const jars = new Map<string, CachedJar>();

export function formatPcxFulfillmentDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}${get("month")}${get("year")}`;
}

export function parseSetCookieLine(
  line: string,
): { name: string; value: string } | null {
  const first = line.split(";")[0]?.trim() ?? "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name || ATTR_NAMES.has(name.toLowerCase())) return null;
  return { name, value };
}

export function applySetCookieHeader(jar: CookieJar, line: string): void {
  const parsed = parseSetCookieLine(line);
  if (!parsed) return;
  if (
    !parsed.value ||
    parsed.value === '""' ||
    parsed.value.toLowerCase() === "deleted"
  ) {
    jar.delete(parsed.name);
    return;
  }
  jar.set(parsed.name, parsed.value);
}

function setCookieLines(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const raw = res.headers.get("set-cookie");
  return raw ? [raw] : [];
}

export function applySetCookiesFromResponse(jar: CookieJar, res: Response): void {
  for (const line of setCookieLines(res)) applySetCookieHeader(jar, line);
}

export function cookieHeaderFromJar(jar: CookieJar): string | null {
  if (jar.size === 0) return null;
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function parseCookieHeader(raw: string): CookieJar {
  const jar: CookieJar = new Map();
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || !value || ATTR_NAMES.has(name.toLowerCase())) continue;
    jar.set(name, value);
  }
  return jar;
}

function seedJarFromEnv(): CookieJar {
  const raw =
    process.env.PCX_COOKIE?.trim() || process.env.NOFRILLS_COOKIE?.trim() || "";
  return raw ? parseCookieHeader(raw) : new Map();
}

export function pcxCookieCount(jar: CookieJar): number {
  return jar.size;
}

export function resetPcxSessionCache(): void {
  jars.clear();
}

export function invalidatePcxJar(originHost: string): void {
  jars.delete(originHost);
}

export function cachedPcxJar(originHost: string): CookieJar | null {
  const hit = jars.get(originHost);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt >= JAR_TTL_MS) {
    jars.delete(originHost);
    return null;
  }
  return hit.jar;
}

function rememberJar(originHost: string, jar: CookieJar): CookieJar {
  jars.set(originHost, { jar, fetchedAt: Date.now() });
  return jar;
}

export async function fetchWithPcxJar(
  url: string,
  jar: CookieJar,
  init: RequestInit,
  maxRedirects = 8,
): Promise<Response> {
  let current = url;
  const originalMethod = (init.method ?? "GET").toUpperCase();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const headers = new Headers(init.headers);
    const cookie = cookieHeaderFromJar(jar);
    if (cookie) headers.set("Cookie", cookie);
    const followRedirect = hop > 0;
    const res = await fetch(current, {
      ...init,
      method: followRedirect ? "GET" : originalMethod,
      body: followRedirect ? undefined : init.body,
      headers,
      redirect: "manual",
    });
    applySetCookiesFromResponse(jar, res);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).href;
      continue;
    }
    return res;
  }
  throw new Error(`too many redirects fetching ${url}`);
}

async function harvestHomepageCookies(
  originHost: string,
  jar: CookieJar,
): Promise<void> {
  await fetchWithPcxJar(`${originHost}/`, jar, {
    method: "GET",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-CA,en;q=0.9",
      "User-Agent": PCX_BROWSER_UA,
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
    },
  });
}

async function harvestApiHostCookies(jar: CookieJar): Promise<void> {
  const apiOrigin =
    process.env.NOFRILLS_SEARCH_URL?.trim() ||
    "https://api.pcexpress.ca/pcx-bff/api/v2/products/search";
  let host: string;
  try {
    host = new URL(apiOrigin).origin;
  } catch {
    host = "https://api.pcexpress.ca";
  }
  await fetchWithPcxJar(`${host}/`, jar, {
    method: "GET",
    headers: {
      Accept: "*/*",
      "User-Agent": PCX_BROWSER_UA,
      "Accept-Language": "en-CA,en;q=0.9",
    },
  }).catch(() => undefined);
}

export async function ensurePcxJar(
  originHost: string,
  force = false,
): Promise<CookieJar> {
  if (!force) {
    const cached = cachedPcxJar(originHost);
    if (cached && cached.size > 0) return cached;
  }
  const jar = seedJarFromEnv();
  try {
    await harvestHomepageCookies(originHost, jar);
    await harvestApiHostCookies(jar);
  } catch {
    // Keep whatever we harvested (including env cookies).
  }
  return rememberJar(originHost, jar);
}

function browserBootstrapEnabled(): boolean {
  return process.env.PCX_BOOTSTRAP_BROWSER === "1";
}

export function pcxShouldPrewarmCookies(): boolean {
  return (
    process.env.PCX_BOOTSTRAP_BROWSER === "1" ||
    process.env.PCX_PREWARM_COOKIES === "1"
  );
}

export async function bootstrapPcxJarWithBrowser(
  originHost: string,
): Promise<CookieJar> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: process.env.PCX_BOOTSTRAP_HEADED !== "1",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const context = await browser.newContext({
      locale: "en-CA",
      timezoneId: "America/Toronto",
      userAgent: PCX_BROWSER_UA,
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${originHost}/`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(1500);
    const cookies = await context.cookies();
    const jar = seedJarFromEnv();
    for (const cookie of cookies) {
      if (cookie.name && cookie.value) jar.set(cookie.name, cookie.value);
    }
    await context.close();
    return rememberJar(originHost, jar);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function refreshPcxJar(
  originHost: string,
  preferBrowser: boolean,
): Promise<CookieJar> {
  invalidatePcxJar(originHost);
  if (preferBrowser && browserBootstrapEnabled()) {
    try {
      const browserJar = await bootstrapPcxJarWithBrowser(originHost);
      if (browserJar.size > 0) return browserJar;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `pcx: browser cookie bootstrap failed for ${originHost} (${msg.slice(0, 120)}); trying HTTP`,
      );
    }
  }
  return ensurePcxJar(originHost, true);
}

export async function prewarmPcxJar(originHost: string): Promise<CookieJar> {
  if (browserBootstrapEnabled()) {
    return refreshPcxJar(originHost, true);
  }
  return ensurePcxJar(originHost, true);
}

export function initialPcxJar(originHost: string): CookieJar {
  const cached = cachedPcxJar(originHost);
  if (cached) return cached;
  const seeded = seedJarFromEnv();
  if (seeded.size > 0) return rememberJar(originHost, seeded);
  return new Map();
}

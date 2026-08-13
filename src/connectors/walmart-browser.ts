import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { ProductOffer } from "./types";
import { parseWalmartSearchNextData } from "./walmart-store";

const PROFILE_DIR = path.resolve(
  process.cwd(),
  process.env.WALMART_BROWSER_PROFILE ?? "data/walmart-profile",
);

let sharedContext: BrowserContext | null = null;
let launchPromise: Promise<BrowserContext> | null = null;

function browserEnabled(): boolean {
  return process.env.WALMART_USE_BROWSER !== "0";
}

function headlessMode(): boolean {
  // Headless is often flagged by PerimeterX; default headed for reliability.
  return process.env.WALMART_BROWSER_HEADLESS === "1";
}

function storeCookies(storeId: string) {
  const domain = ".walmart.ca";
  return [
    { name: "deliveryCatchment", value: storeId, domain, path: "/" },
    { name: "defaultNearestStoreId", value: storeId, domain, path: "/" },
    { name: "assortmentStoreId", value: storeId, domain, path: "/" },
    { name: "xptc", value: `assortmentStoreId%2B${storeId}`, domain, path: "/" },
  ];
}

export function walmartBrowserProfileDir(): string {
  return PROFILE_DIR;
}

export function isWalmartBrowserEnabled(): boolean {
  return browserEnabled();
}

export async function closeWalmartBrowser(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close().catch(() => undefined);
    sharedContext = null;
    launchPromise = null;
  }
}

/**
 * Launch (or reuse) a persistent Chromium context under data/walmart-profile.
 */
export async function getWalmartBrowserContext(opts?: {
  headed?: boolean;
}): Promise<BrowserContext> {
  if (sharedContext) return sharedContext;
  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const headed = opts?.headed ?? !headlessMode();
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: !headed,
      viewport: { width: 1365, height: 900 },
      locale: "en-CA",
      timezoneId: "America/Toronto",
      args: ["--disable-blink-features=AutomationControlled"],
    });
    sharedContext = context;
    context.on("close", () => {
      sharedContext = null;
      launchPromise = null;
    });
    return context;
  })();

  return launchPromise;
}

/**
 * Headed warm-up: open store page so user can pass PX / confirm store 5831.
 * Session cookies persist in the profile directory.
 */
export async function warmWalmartSession(storeId: string): Promise<void> {
  const context = await getWalmartBrowserContext({ headed: true });
  await context.addCookies(storeCookies(storeId));
  const page = await context.newPage();
  await page.goto(`https://www.walmart.ca/en/store/${storeId}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page
    .goto(
      `https://www.walmart.ca/en/search?q=milk&facet=fulfillment_method%3APickup`,
      { waitUntil: "domcontentloaded", timeout: 90_000 },
    )
    .catch(() => undefined);
}

function walkPresoItems(
  node: unknown,
  out: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) walkPresoItems(item, out);
    return out;
  }
  if (typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  if (
    (obj.usItemId || obj.id || obj.productId) &&
    (obj.name || obj.title) &&
    (obj.priceInfo || obj.price)
  ) {
    out.push(obj);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") walkPresoItems(value, out);
  }
  return out;
}

function parseMoney(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return parseMoney(o.price) ?? parseMoney(o.amount) ?? parseMoney(o.value);
  }
  return undefined;
}

function offersFromItems(
  items: Record<string, unknown>[],
  storeId: string,
): ProductOffer[] {
  const checkedAt = new Date().toISOString();
  const seen = new Set<string>();
  const offers: ProductOffer[] = [];
  for (const item of items) {
    const productId = String(item.usItemId ?? item.id ?? item.productId ?? "");
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    const priceInfo = (item.priceInfo ?? {}) as Record<string, unknown>;
    const current = (priceInfo.currentPrice ?? {}) as { price?: unknown };
    const price =
      parseMoney(current.price) ??
      parseMoney(priceInfo.linePrice) ??
      parseMoney(item.price) ??
      parseMoney(priceInfo.price);
    if (price == null) continue;
    const avail = String(
      item.availabilityStatus ?? item.availability ?? "",
    ).toUpperCase();
    offers.push({
      retailer: "walmart_ca",
      storeId,
      productId,
      name: String(item.name ?? item.title ?? "Unknown"),
      brand: typeof item.brand === "string" ? item.brand : undefined,
      price,
      unitPrice: parseMoney(priceInfo.unitPrice),
      availability: avail.includes("OUT")
        ? "out_of_stock"
        : avail.includes("IN_STOCK") || avail.includes("AVAILABLE")
          ? "in_stock"
          : "unknown",
      confidence: "exact",
      checkedAt,
      sourceUrl: `https://www.walmart.ca/en/ip/${productId}`,
      raw: { ...item, _pocNote: "playwright persistent session" },
    });
  }
  return offers;
}

async function collectFromNetwork(
  page: Page,
  storeId: string,
  timeoutMs: number,
): Promise<ProductOffer[]> {
  const collected: ProductOffer[] = [];
  const onResponse = async (res: import("playwright").Response) => {
    const url = res.url();
    if (
      !/getPreso|graphql|search/i.test(url) ||
      !url.includes("walmart.ca")
    ) {
      return;
    }
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("json") && !url.includes("graphql")) return;
    try {
      const body = await res.json();
      const items = walkPresoItems(body);
      if (items.length) {
        collected.push(...offersFromItems(items, storeId));
      }
    } catch {
      /* ignore non-json */
    }
  };
  page.on("response", onResponse);
  await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 8_000)));
  page.off("response", onResponse);
  return dedupe(collected);
}

function dedupe(offers: ProductOffer[]): ProductOffer[] {
  const seen = new Set<string>();
  return offers.filter((o) => {
    if (seen.has(o.productId)) return false;
    seen.add(o.productId);
    return true;
  });
}

function isBlocked(page: Page, html: string): boolean {
  const url = page.url();
  return (
    url.includes("/blocked") ||
    /Verify Your Identity/i.test(html) ||
    /px-captcha/i.test(html)
  );
}

/**
 * Search Walmart shelf via persistent browser session (store-scoped).
 */
export async function searchProductsInBrowser(
  query: string,
  storeId: string,
): Promise<ProductOffer[]> {
  if (!browserEnabled()) return [];

  const context = await getWalmartBrowserContext();
  await context.addCookies(storeCookies(storeId));
  const page = await context.newPage();

  try {
    const networkOffers: ProductOffer[] = [];
    const onResponse = async (res: import("playwright").Response) => {
      const url = res.url();
      if (!url.includes("walmart.ca")) return;
      if (!/getPreso|graphql/i.test(url)) return;
      try {
        const body = await res.json();
        const items = walkPresoItems(body);
        if (items.length) networkOffers.push(...offersFromItems(items, storeId));
      } catch {
        /* ignore */
      }
    };
    page.on("response", onResponse);

    const searchUrl = `https://www.walmart.ca/en/search?q=${encodeURIComponent(query)}&facet=fulfillment_method%3APickup`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    // Give GraphQL/SSR a moment to land
    await new Promise((r) => setTimeout(r, 5_000));
    await page
      .waitForSelector(
        "[data-testid='item-stack'], [data-item-id], a[href*='/en/ip/']",
        { timeout: 15_000 },
      )
      .catch(() => undefined);

    const html = await page.content();
    if (isBlocked(page, html)) {
      throw new Error(
        `Walmart browser session blocked (PX). Run: npm run walmart:warm (select store ${storeId}, pass Verify once)`,
      );
    }

    page.off("response", onResponse);

    const fromHtml = parseWalmartSearchNextData(html, storeId);
    const merged = dedupe([...fromHtml, ...networkOffers]);
    if (merged.length > 0) return merged;

    // One more soft wait for late XHR
    const late = await collectFromNetwork(page, storeId, 6_000);
    return dedupe([...merged, ...late]);
  } finally {
    await page.close().catch(() => undefined);
  }
}

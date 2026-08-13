/**
 * Parse Walmart store-finder HTML for #5831 / map store metadata.
 * Also try known store URL patterns that might SSR prices.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const STORE_ID = "5831";
const POSTAL = "L4J0A7";

async function fetchHtml(url: string, cookie?: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "follow",
  });
  const text = await res.text();
  return { status: res.status, url: res.url, text, px: /blocked|px-captcha|PerimeterX/i.test(text) };
}

function extractNextData(html: string): unknown | null {
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function findStoreMentions(obj: unknown, out: unknown[] = [], depth = 0) {
  if (!obj || depth > 12) return out;
  if (Array.isArray(obj)) {
    for (const x of obj) findStoreMentions(x, out, depth + 1);
    return out;
  }
  if (typeof obj !== "object") return out;
  const rec = obj as Record<string, unknown>;
  const id = String(rec.id ?? rec.storeId ?? rec.nodeId ?? "");
  const name = String(rec.displayName ?? rec.name ?? "");
  if (
    id.includes(STORE_ID) ||
    name.toLowerCase().includes("centre") ||
    JSON.stringify(rec).includes(STORE_ID)
  ) {
    if (rec.id || rec.storeId || rec.displayName || rec.address) {
      out.push({
        id: rec.id ?? rec.storeId,
        name: rec.displayName ?? rec.name,
        address: rec.address ?? rec.addressLineOne,
        postalCode: rec.postalCode,
        lat: rec.latitude ?? (rec.geoPoint as { latitude?: number } | undefined)?.latitude,
        lng: rec.longitude ?? (rec.geoPoint as { longitude?: number } | undefined)?.longitude,
        keys: Object.keys(rec).slice(0, 25),
      });
    }
  }
  for (const v of Object.values(rec)) findStoreMentions(v, out, depth + 1);
  return out;
}

async function main() {
  const cookie = [
    `deliveryCatchment=${STORE_ID}`,
    `defaultNearestStoreId=${STORE_ID}`,
    `assortmentStoreId=${STORE_ID}`,
    `walmart.nearestPostalCode=${POSTAL}`,
  ].join("; ");

  const urls = [
    `https://www.walmart.ca/en/store-finder?searchQuery=${POSTAL}`,
    `https://www.walmart.ca/en/stores/thornhill-supercentre/${STORE_ID}`,
    `https://www.walmart.ca/en/${STORE_ID}`,
    `https://www.walmart.ca/en/store/${STORE_ID}`,
    `https://www.walmart.ca/store/${STORE_ID}`,
  ];

  await mkdir(path.join(process.cwd(), "data", "walmart-probe"), {
    recursive: true,
  });

  for (const url of urls) {
    const page = await fetchHtml(url, cookie);
    console.log(
      JSON.stringify({
        url: page.url,
        status: page.status,
        px: page.px,
        len: page.text.length,
        hasNext: page.text.includes("__NEXT_DATA__"),
      }),
    );

    if (page.px) continue;

    const next = extractNextData(page.text);
    if (next) {
      const mentions = findStoreMentions(next).slice(0, 8);
      console.log("  storeMentions", JSON.stringify(mentions, null, 2));
      const outFile = path.join(
        process.cwd(),
        "data",
        "walmart-probe",
        `next-${STORE_ID}-${Buffer.from(url).toString("base64url").slice(0, 24)}.json`,
      );
      // Save trimmed keys only for debugging
      await writeFile(
        outFile,
        JSON.stringify(
          {
            source: page.url,
            topKeys:
              next && typeof next === "object"
                ? Object.keys(next as object)
                : [],
            mentions,
          },
          null,
          2,
        ),
      );
    } else {
      // Look for 5831 near address text
      const idx = page.text.indexOf(STORE_ID);
      if (idx >= 0) {
        console.log(
          "  raw5831context",
          page.text
            .slice(Math.max(0, idx - 100), idx + 200)
            .replace(/\s+/g, " ")
            .slice(0, 280),
        );
      }
    }
  }

  // Explain pricing model (static notes)
  console.log(
    JSON.stringify({
      pricingModel: {
        confirmed: [
          "Walmart CA consumer prices are fulfillment-node scoped (pickup store / deliveryCatchment)",
          "Same usItemId can have different priceInfo per store node",
          "Store context is carried by cookies: deliveryCatchment, defaultNearestStoreId, assortmentStoreId",
          "Map/locator FetchNearByNodes resolves postal/latlng → store node IDs",
        ],
        blockedHere: [
          "orchestra GraphQL (getPreso/search/FetchNearByNodes) → PerimeterX",
          "product HTML/search HTML → /blocked verify identity",
          "legacy find-in-store → 403",
        ],
        viableNextSteps: [
          "Browser session cookie export (user opens walmart.ca, selects store 5831, copies Cookie header)",
          "Playwright/puppeteer residential browser automation with manual PX solve once",
          "HTML __NEXT_DATA__ parse AFTER warm browser session (openweb approach)",
          "Do NOT use Flipp as shelf substitute",
        ],
      },
    }, null, 2),
  );
}

main();

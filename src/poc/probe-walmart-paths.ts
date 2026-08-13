/**
 * Walmart CA pricing-path probe for store #5831 / postal L4J0A7.
 * Prints statuses + small redacted snippets only (no secrets).
 */
const STORE_ID = "5831";
const POSTAL = "L4J0A7";
// Approx Centre St Thornhill
const LAT = 43.8155;
const LNG = -79.4505;

function cookieHeader(extra: Record<string, string> = {}) {
  const base: Record<string, string> = {
    deliveryCatchment: STORE_ID,
    defaultNearestStoreId: STORE_ID,
    assortmentStoreId: STORE_ID,
    "walmart.nearestPostalCode": POSTAL,
    "walmart.nearestLatLng": `${LAT},${LNG}`,
    ...extra,
  };
  return Object.entries(base)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function hit(
  label: string,
  url: string,
  init: RequestInit = {},
): Promise<void> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/json,text/html,*/*",
        ...(init.headers as Record<string, string>),
      },
      redirect: "follow",
    });
    const text = await res.text();
    const px =
      text.includes("px-captcha") ||
      text.includes("PerimeterX") ||
      res.status === 412;
    console.log(
      JSON.stringify({
        label,
        status: res.status,
        len: text.length,
        px,
        finalUrl: res.url.slice(0, 120),
        head: text.slice(0, 180).replace(/\s+/g, " "),
      }),
    );
  } catch (e) {
    console.log(JSON.stringify({ label, error: String(e) }));
  }
}

async function main() {
  const cookie = cookieHeader();

  // 1) Store page / map style URLs
  await hit(
    "store-page-html",
    `https://www.walmart.ca/en/stores/${STORE_ID}`,
    { headers: { Cookie: cookie, Accept: "text/html" } },
  );
  await hit(
    "store-finder-html",
    `https://www.walmart.ca/en/store-finder?searchQuery=${POSTAL}`,
    { headers: { Cookie: cookie, Accept: "text/html" } },
  );

  // 2) Nearby nodes (map/locator GraphQL persisted)
  const nearHash =
    "13cc7c54f667f47fc364643da028af42bb68c795ddf6da8733aca6559b41c53f";
  const nearVars = encodeURIComponent(
    JSON.stringify({
      checkInventoryFlow: false,
      input: {
        accessTypes: [
          "PICKUP_CURBSIDE",
          "PICKUP_INSTORE",
          "PICKUP_SPOKE",
          "PICKUP_POPUP",
        ],
        city: null,
        latitude: LAT,
        longitude: LNG,
        nodeTypes: ["STORE", "PICKUP_SPOKE", "PICKUP_POPUP"],
        partnerIds: null,
        postalCode: "L4J 0A7",
        stateOrProvince: null,
      },
    }),
  );
  await hit(
    "FetchNearByNodes",
    `https://www.walmart.ca/orchestra/cartxo/graphql/FetchNearByNodes/${nearHash}?variables=${nearVars}`,
    {
      headers: {
        Cookie: cookie,
        "x-o-bu": "WALMART-CA",
        "x-o-platform": "rweb",
      },
    },
  );

  // 3) Classic find-in-store (lat/lng + upc) — needs a real UPC; try milk-ish placeholder then empty
  await hit(
    "find-in-store-upc-probe",
    `https://www.walmart.ca/api/product-page/find-in-store?latitude=${LAT}&longitude=${LNG}&lang=en&upc=068700001053`,
    { headers: { Cookie: cookie } },
  );

  // 4) Search HTML with store cookies — hope for __NEXT_DATA__
  await hit(
    "search-html-milk",
    `https://www.walmart.ca/en/search?q=${encodeURIComponent("2% milk 4L")}&facet=fulfillment_method%3APickup`,
    {
      headers: {
        Cookie: cookie,
        Accept: "text/html",
      },
    },
  );

  // 5) Mobile-ish search endpoint variants
  await hit(
    "snb-graphql-search-get",
    `https://www.walmart.ca/orchestra/snb/graphql/search?query=milk&page=1`,
    {
      headers: {
        Cookie: cookie,
        "x-o-bu": "WALMART-CA",
        "x-o-platform": "rweb",
        "x-o-mart": "B2C",
      },
    },
  );

  // 6) Item page HTML for a known grocery pattern
  await hit(
    "ip-short-html",
    "https://www.walmart.ca/en/ip/6000195861686",
    { headers: { Cookie: cookie, Accept: "text/html" } },
  );

  // 7) Affiliate / public-looking endpoints (likely fail)
  await hit(
    "affinity-search",
    "https://www.walmart.ca/orchestra/search/graphql",
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "x-o-bu": "WALMART-CA",
      },
      body: JSON.stringify({ query: "{__typename}" }),
    },
  );
}

main();

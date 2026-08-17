/**
 * Isolated PC Express BFF banner probe (No Frills / Wholesale Club).
 * Uses the same public web X-Apikey as nofrills.ca if NOFRILLS_API_KEY is set.
 * Does not change the production No Frills connector.
 *
 *   $env:NOFRILLS_API_KEY='<public web client key from nofrills.ca Network tab>'
 *   npx tsx --env-file=.env.local src/poc/probe-pcx-banner.ts wholesaleclub 3724 milk
 */
const SEARCH_URL =
  process.env.NOFRILLS_SEARCH_URL ??
  "https://api.pcexpress.ca/pcx-bff/api/v2/products/search";

function todayDdmmyyyy(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getFullYear()}`;
}

async function main() {
  const banner = process.argv[2] ?? "wholesaleclub";
  const storeId = process.argv[3] ?? process.env.WHOLESALECLUB_STORE_ID ?? "3724";
  const query = process.argv[4] ?? "milk";
  const apiKey = process.env.NOFRILLS_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "Set NOFRILLS_API_KEY to the public X-Apikey sent by the banner website (see Network tab). Do not commit the value.",
    );
    process.exit(1);
  }

  const origin =
    banner === "nofrills"
      ? "https://www.nofrills.ca"
      : "https://www.wholesaleclub.ca";

  const payload = {
    cart: { cartId: crypto.randomUUID() },
    fulfillmentInfo: {
      storeId,
      pickupType: "STORE",
      offerType: "OG",
      date: todayDdmmyyyy(),
      timeSlot: null,
    },
    listingInfo: {
      filters: { "search-bar": [query] },
      sort: {},
      pagination: { from: 1 },
      includeFiltersInResponse: false,
    },
    banner,
    userData: {
      domainUserId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
    },
    device: { screenSize: 1358 },
    searchRelatedInfo: {
      term: query,
      options: [{ name: "rmp.unifiedSearchVariant", value: "Y" }],
    },
  };

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "X-Apikey": apiKey,
      "X-Application-Type": "Web",
      "X-Channel": "web",
      "X-Loblaw-Tenant-Id": "ONLINE_GROCERIES",
      "Business-User-Agent": "PCXWEB",
      "Site-Banner": banner,
      Origin: origin,
      Referer: `${origin}/`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(
    JSON.stringify(
      {
        banner,
        storeId,
        query,
        httpStatus: res.status,
        bodyPreview: text.slice(0, 800),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Find Flipp/Sobeys store_code for Clark & Hilda without printing secrets. */
async function main() {
  const res = await fetch(
    "https://flyers.sobeys.com/flyers/sobeys?type=2&locale=en&postal_code=L4J6W7",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
    },
  );
  const html = await res.text();

  // Collect script srcs
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(
    (m) => m[1],
  );
  console.log("script_count", scripts.length);

  // Inline dam.flippenterprise URLs (mask token)
  const flippUrls = [
    ...html.matchAll(/https?:\/\/[^"'\\s]*flippenterprise[^"'\\s]*/gi),
  ].map((m) =>
    m[0].replace(/access_token=[^&"']+/gi, "access_token=[REDACTED]"),
  );
  console.log("inline_flipp_urls", flippUrls.slice(0, 10));

  // Look for storefront JSON endpoints commonly used by Flipp hosted flyers
  const candidates = [
    "https://flyers.sobeys.com/flyer_data/stores?postal_code=L4J6W7",
    "https://flyers.sobeys.com/api/stores?postal_code=L4J6W7",
    "https://flyers.sobeys.com/stores.json?postal_code=L4J6W7",
  ];

  // Also parse data attributes / window config
  const dataStores = html.match(/data-stores=["']([^"']+)["']/i);
  if (dataStores) {
    console.log("data-stores present, length", dataStores[1].length);
  }

  // Search for Clark Ave with nearby digits
  const clarkIdx = html.toLowerCase().indexOf("441 clark");
  if (clarkIdx >= 0) {
    const snippet = html
      .slice(Math.max(0, clarkIdx - 400), clarkIdx + 400)
      .replace(/access_token=[^&"'\s]+/gi, "access_token=[REDACTED]")
      .replace(/[a-f0-9]{32,}/gi, "[HEX]");
    console.log("clark_html_snippet:\n", snippet);
  }

  // Try wishabi store list for merchant 2072 (Sobeys from earlier Flipp response)
  const merchantStores = await fetch(
    "https://backflipp.wishabi.com/flipp/merchants/2072/stores?postal_code=L4J6W7&locale=en-ca",
    { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
  );
  console.log(
    "merchant_stores",
    merchantStores.status,
    (await merchantStores.text()).slice(0, 500),
  );

  const storeSearch = await fetch(
    "https://backflipp.wishabi.com/flipp/stores?locale=en-ca&postal_code=L4J6W7&q=Sobeys",
    { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } },
  );
  console.log(
    "store_search",
    storeSearch.status,
    (await storeSearch.text()).slice(0, 800),
  );

  for (const u of candidates) {
    const r = await fetch(u, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    console.log(u, r.status, (await r.text()).slice(0, 200));
  }
}

main().catch(console.error);

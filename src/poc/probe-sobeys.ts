/**
 * Probe Sobeys store locator / Flipp / possible commerce APIs
 * for Sobeys Clark & Hilda (441 Clark Ave W, L4J 6W7).
 */
async function get(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/json,text/html,*/*",
        ...headers,
      },
    });
    const text = await res.text();
    return { status: res.status, text, url };
  } catch (e) {
    return { status: 0, text: String(e), url };
  }
}

async function main() {
  const postal = "L4J6W7";
  const notes: string[] = [];

  // 1) Store page HTML — look for store numbers / ids
  const page = await get("https://www.sobeys.com/en/stores/sobeys-clark-hilda");
  notes.push(`store page HTTP ${page.status}, len=${page.text.length}`);
  const idMatches = [
    ...page.text.matchAll(
      /(?:store[_-]?(?:id|number|code)|location[_-]?id|retailStoreId|bannerStoreId)["':=\s]+([A-Za-z0-9_-]+)/gi,
    ),
  ].slice(0, 20);
  notes.push(`id-like matches: ${JSON.stringify(idMatches.map((m) => m[0]))}`);

  const numberMatches = [
    ...page.text.matchAll(/"storeNumber"\s*:\s*"?(\d+)"?/gi),
    ...page.text.matchAll(/"storeId"\s*:\s*"?(\d+)"?/gi),
    ...page.text.matchAll(/"id"\s*:\s*"?(sobeys[^"]+|\d+)"?/gi),
  ].slice(0, 30);
  notes.push(
    `json-ish store fields: ${JSON.stringify(numberMatches.map((m) => m[0]))}`,
  );

  // 2) Common Empire / Sobeys locator endpoints
  const locatorCandidates = [
    `https://www.sobeys.com/wp-json/store-locator/v1/stores?postal_code=${postal}`,
    `https://www.sobeys.com/store-locator?postal_code=${postal}`,
    `https://api.sobeys.com/stores?postalCode=${postal}`,
    `https://www.sobeys.com/en/store-locator?lat=43.812&lng=-79.450`,
    `https://www.sobeys.com/store/locator/json?q=${postal}`,
  ];
  for (const u of locatorCandidates) {
    const r = await get(u);
    notes.push(`locator ${u} → ${r.status} len=${r.text.length} head=${r.text.slice(0, 120).replace(/\s+/g, " ")}`);
  }

  // 3) Flipp publications for Sobeys at this postal
  const flippPubs = await get(
    `https://dam.flippenterprise.net/flyerkit/publications/sobeys?locale=en&access_token=1720e05a7bf64d9f8c4c1a0e0b0c0d0e&postal_code=${postal}`,
  );
  notes.push(
    `flipp pubs (dummy token) → ${flippPubs.status} ${flippPubs.text.slice(0, 150)}`,
  );

  const flippSearch = await get(
    `https://backflipp.wishabi.com/flipp/items/search?locale=en-ca&postal_code=${postal}&q=Sobeys%20milk`,
  );
  notes.push(`flipp search → ${flippSearch.status}`);
  try {
    const body = JSON.parse(flippSearch.text) as {
      items?: Array<{
        id?: number;
        name?: string;
        current_price?: number;
        merchant_name?: string;
        store_code?: string;
      }>;
    };
    const items = body.items ?? [];
    notes.push(`flipp items=${items.length}`);
    for (const it of items.slice(0, 3)) {
      notes.push(
        `  item id=${it.id} store_code=${it.store_code} merchant=${it.merchant_name} price=${it.current_price} name=${it.name}`,
      );
    }
  } catch {
    notes.push(`flipp parse fail: ${flippSearch.text.slice(0, 200)}`);
  }

  // 4) Voila (Sobeys e-comm) — may not map 1:1 to Clark & Hilda shelf
  const voila = await get("https://voila.ca/api/v2/store/store-picker", {
    Accept: "application/json",
  });
  notes.push(
    `voila store-picker → ${voila.status} ${voila.text.slice(0, 200).replace(/\s+/g, " ")}`,
  );

  const voilaNear = await get(
    `https://voila.ca/api/v4/customers/me/destination?postalCode=${postal}`,
  );
  notes.push(
    `voila destination → ${voilaNear.status} ${voilaNear.text.slice(0, 200).replace(/\s+/g, " ")}`,
  );

  console.log(notes.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

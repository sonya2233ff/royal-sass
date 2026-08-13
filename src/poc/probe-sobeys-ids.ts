/** Extract Sobeys store identifiers only (no tokens printed). */
async function main() {
  const postal = "L4J6W7";
  const urls = [
    "https://www.sobeys.com/en/flyer/",
    "https://www.sobeys.com/flyer/",
    `https://flyers.sobeys.com/flyers/sobeys?type=2&locale=en&postal_code=${postal}`,
    "https://www.sobeys.com/en/stores/sobeys-clark-hilda",
    "https://www.sobeys.com/store-locator",
  ];

  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    const text = await res.text();
    const storeCodes = [...new Set([...text.matchAll(/store_code=([0-9]+)/gi)].map((m) => m[1]))];
    const storeNumbers = [
      ...new Set(
        [
          ...text.matchAll(/"storeNumber"\s*:\s*"?(\d+)"?/gi),
          ...text.matchAll(/"storeCode"\s*:\s*"?(\d+)"?/gi),
          ...text.matchAll(/"store_code"\s*:\s*"?(\d+)"?/gi),
          ...text.matchAll(/"retailStoreId"\s*:\s*"?([^"]+)"?/gi),
        ].map((m) => m[1]),
      ),
    ];
    const hasClark = /clark/i.test(text);
    const has441 = text.includes("441");
    const hasL4J = /L4J\s*6W7/i.test(text);
    console.log(
      JSON.stringify({
        url: res.url,
        status: res.status,
        storeCodes,
        storeNumbers: storeNumbers.slice(0, 20),
        hasClark,
        has441,
        hasL4J,
        tokenPresent: /access_token=/i.test(text),
      }),
    );

    const next = text.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (next) {
      const s = next[1];
      if (/clark/i.test(s)) {
        const idx = s.toLowerCase().indexOf("clark");
        const snippet = s.slice(Math.max(0, idx - 200), idx + 300);
        // Redact any token-looking hex strings
        console.log(
          "clark_snippet:",
          snippet.replace(/[a-f0-9]{20,}/gi, "[REDACTED]"),
        );
      }
    }
  }

  // Flipp item search — check if merchant/store identifiers appear
  const flipp = await fetch(
    `https://backflipp.wishabi.com/flipp/items/search?locale=en-ca&postal_code=${postal}&q=Sobeys%20bananas`,
  );
  const body = await flipp.json();
  const items = (body.items ?? []).slice(0, 5).map(
    (it: Record<string, unknown>) => ({
      id: it.id,
      name: it.name,
      price: it.current_price,
      merchant_id: it.merchant_id,
      merchant_name: it.merchant_name,
      flyer_id: it.flyer_id,
      store_code: it.store_code ?? null,
    }),
  );
  console.log(JSON.stringify({ flippStatus: flipp.status, items }, null, 2));
}

main().catch(console.error);

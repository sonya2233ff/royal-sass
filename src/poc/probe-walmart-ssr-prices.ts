/** Dig store 5831 NEXT_DATA for any product/price modules; try SSR search variants */
async function getHtml(url: string, cookie?: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html",
      ...(cookie
        ? {
            Cookie: cookie,
          }
        : {}),
    },
  });
  return { status: res.status, url: res.url, html: await res.text() };
}

function nextData(html: string) {
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  return m ? JSON.parse(m[1]) : null;
}

async function main() {
  const cookie = [
    "deliveryCatchment=5831",
    "defaultNearestStoreId=5831",
    "assortmentStoreId=5831",
    "walmart.nearestPostalCode=L4J0A7",
  ].join("; ");

  const store = await getHtml("https://www.walmart.ca/en/store/5831");
  const data = nextData(store.html);
  const s = JSON.stringify(data ?? {});
  console.log({
    storeOk: store.status === 200 && !/Verify Your Identity/i.test(store.html),
    hasPrice: /priceInfo|currentPrice|linePrice/i.test(s),
    hasProduct: /usItemId|productName/i.test(s),
    moduleTypes: [
      ...new Set(
        [...s.matchAll(/"type":"([^"]+)"/g)].map((m) => m[1]),
      ),
    ].slice(0, 40),
  });

  const searchUrls = [
    "https://www.walmart.ca/en/search?q=milk&facet=fulfillment_method%3AIn-store",
    "https://www.walmart.ca/en/search?q=milk&stores=5831",
    "https://www.walmart.ca/en/search?q=2%25%20milk%204L&affinityOverride=default",
  ];

  for (const url of searchUrls) {
    const page = await getHtml(url, cookie);
    const blocked = /Verify Your Identity/i.test(page.html);
    const next = !blocked ? nextData(page.html) : null;
    const ns = next ? JSON.stringify(next) : "";
    console.log({
      url: page.url.slice(0, 100),
      status: page.status,
      blocked,
      len: page.html.length,
      hasNext: !!next,
      productHits: next
        ? [...ns.matchAll(/"usItemId":"([^"]+)"/g)].slice(0, 3).map((m) => m[1])
        : [],
      priceSample: next
        ? [...ns.matchAll(/"linePrice":"([^"]+)"/g)].slice(0, 3).map((m) => m[1])
        : [],
    });
  }
}

main();

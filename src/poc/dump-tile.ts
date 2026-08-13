async function main() {
  const res = await fetch(
    "https://api.pcexpress.ca/pcx-bff/api/v2/products/search",
    {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "Accept-Language": "en",
        "X-Apikey": "C1xujSegT5j3ap3yexJjqhOfELwGKYvz",
        "X-Application-Type": "Web",
        "X-Channel": "web",
        "X-Loblaw-Tenant-Id": "ONLINE_GROCERIES",
        "Business-User-Agent": "PCXWEB",
        "Is-Helios-Account": "false",
        "Is-Iceberg-Enabled": "true",
        "X-Preview": "false",
        Origin_session_header: "B",
        "Site-Banner": "nofrills",
        Origin: "https://www.nofrills.ca",
        Referer: "https://www.nofrills.ca/",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({
        cart: { cartId: crypto.randomUUID() },
        fulfillmentInfo: {
          storeId: "3660",
          pickupType: "STORE",
          offerType: "OG",
          date: "12082026",
          timeSlot: null,
        },
        listingInfo: {
          filters: { "search-bar": ["milk"] },
          sort: {},
          pagination: { from: 1 },
          includeFiltersInResponse: false,
        },
        banner: "nofrills",
        userData: {
          domainUserId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
        },
        device: { screenSize: 1358 },
        searchRelatedInfo: {
          term: "milk",
          options: [{ name: "rmp.unifiedSearchVariant", value: "Y" }],
        },
      }),
    },
  );
  const json = await res.json();
  const tiles =
    json?.layout?.sections?.mainContentCollection?.components?.[0]?.data
      ?.productTiles ?? [];
  const milk = tiles.find((t: { title?: string }) =>
    String(t.title ?? "").toLowerCase().includes("2% milk"),
  );
  console.log(JSON.stringify(milk ?? tiles[0], null, 2));
}

main();

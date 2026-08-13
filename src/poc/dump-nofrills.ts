async function main() {
  const storeId = process.argv[2] ?? "3660";
  const query = process.argv[3] ?? "milk";
  const SEARCH_URL =
    "https://api.pcexpress.ca/pcx-bff/api/v2/products/search";
  const API_KEY = "C1xujSegT5j3ap3yexJjqhOfELwGKYvz";

  const payload = {
    cart: { cartId: crypto.randomUUID() },
    fulfillmentInfo: {
      storeId: String(storeId),
      pickupType: "STORE",
      offerType: "OG",
      date: "12082026",
      timeSlot: null,
    },
    listingInfo: {
      filters: { "search-bar": [query] },
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
      term: query,
      options: [{ name: "rmp.unifiedSearchVariant", value: "Y" }],
    },
  };

  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "Accept-Language": "en",
      "X-Apikey": API_KEY,
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log("status", res.status);
  console.log("length", text.length);
  console.log(text.slice(0, 2000));

  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    console.log("top keys", Object.keys(json));
    if (json.data && typeof json.data === "object") {
      console.log("data keys", Object.keys(json.data as object));
    }
  } catch {
    console.log("not json");
  }
}

main();

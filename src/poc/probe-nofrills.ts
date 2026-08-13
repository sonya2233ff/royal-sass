async function probe() {
  const payloads = [
    {
      name: "v3-classic",
      url: "https://api.pcexpress.ca/product-facade/v3/products/search",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "Site-Banner": "nofrills",
        "X-Apikey": "1im1hL52q9xvta16GlSdYDsTsG0dmyhF",
        Origin: "https://www.nofrills.ca",
        Referer: "https://www.nofrills.ca/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      body: {
        pagination: { from: 0, size: 5 },
        banner: "nofrills",
        cartId: crypto.randomUUID(),
        lang: "en",
        date: "08122026",
        storeId: "3660",
        pcId: false,
        pickupType: "STORE",
        offerType: "ALL",
        term: "milk",
        userData: {
          domainUserId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
        },
      },
    },
    {
      name: "v3-business",
      url: "https://api.pcexpress.ca/product-facade/v3/products/search",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Site-Banner": "nofrills",
        "X-Apikey": "1im1hL52q9xvta16GlSdYDsTsG0dmyhF",
        "Is-Business": "true",
        Origin: "https://www.nofrills.ca",
        Referer: "https://www.nofrills.ca/search?search-bar=milk",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      body: {
        pagination: { from: 0, size: 5 },
        banner: "nofrills",
        lang: "en",
        storeId: "3660",
        term: "milk",
        pickupType: "STORE",
      },
    },
    {
      name: "loblaw-digital-gateway",
      url: "https://api.loblaw.ca/products/v2/search",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      body: null,
      method: "GET",
      qs: "?banner=nofrills&term=milk&storeId=3660",
    },
  ];

  for (const p of payloads) {
    try {
      const url = p.qs ? p.url + p.qs : p.url;
      const res = await fetch(url, {
        method: p.method ?? "POST",
        headers: p.headers,
        body: p.body ? JSON.stringify(p.body) : undefined,
      });
      const text = await res.text();
      console.log(`\n[${p.name}] ${res.status}`);
      console.log(text.slice(0, 400));
    } catch (e) {
      console.log(`\n[${p.name}] ERROR`, e);
    }
  }
}

probe();

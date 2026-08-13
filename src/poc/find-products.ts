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
  const hits: Array<{ path: string; keys: string[]; sample: unknown }> = [];

  function walk(n: unknown, path: string) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    const o = n as Record<string, unknown>;
    const keys = Object.keys(o);
    const hasPrice =
      o.price != null ||
      o.prices != null ||
      o.regularPrice != null ||
      (typeof o.pricingUnits === "object" && o.pricingUnits != null);
    const hasId = o.productId != null || o.offerId != null || o.articleNumber != null;
    if (hasPrice && (hasId || o.name || o.title || o.description)) {
      hits.push({
        path,
        keys: keys.slice(0, 30),
        sample: {
          productId: o.productId,
          offerId: o.offerId,
          articleNumber: o.articleNumber,
          name: o.name,
          title: o.title,
          price: o.price,
          prices: o.prices,
          packageSize: o.packageSize,
          brand: o.brand,
        },
      });
    }
    if (hits.length >= 5) return;
    for (const k of keys) {
      walk(o[k], `${path}.${k}`);
      if (hits.length >= 5) return;
    }
  }

  walk(json, "$");
  console.log("hits", hits.length);
  console.log(JSON.stringify(hits, null, 2));

  // Also list section componentIds
  const sections = (json as { layout?: { sections?: Record<string, unknown> } })
    .layout?.sections;
  if (sections) {
    for (const [name, section] of Object.entries(sections)) {
      const comps = (section as { components?: { componentId?: string }[] })
        ?.components;
      console.log(
        "section",
        name,
        comps?.map((c) => c.componentId).join(","),
      );
    }
  }
}

main();

/**
 * Isolated MVR Plus Shopify probe. Public JSON, no auth, no production wiring.
 *
 *   npx tsx src/poc/probe-mvr-shopify.ts milk
 *   npx tsx src/poc/probe-mvr-shopify.ts flour
 */
import { parseMvrShopifyTags } from "@/connectors/store-connector";

const BASE =
  process.env.MVR_SHOPIFY_BASE?.replace(/\/$/, "") ??
  "https://plus.mvrwholesale.com";

type SuggestProduct = {
  id: number;
  title: string;
  vendor?: string;
  price?: string;
  tags?: string[];
  available?: boolean;
  handle?: string;
  url?: string;
};

async function search(query: string): Promise<SuggestProduct[]> {
  const url = new URL("/search/suggest.json", BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("resources[type]", "product");
  url.searchParams.set("resources[limit]", "8");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MVR suggest HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    resources?: { results?: { products?: SuggestProduct[] } };
  };
  return body.resources?.results?.products ?? [];
}

async function main() {
  const query = process.argv[2] ?? "eggs";
  const rows = await search(query);
  const mapped = rows.map((p) => {
    const tags = parseMvrShopifyTags(p.tags);
    const online = Number.parseFloat(String(p.price ?? ""));
    return {
      title: p.title,
      vendor: p.vendor,
      available: p.available,
      onlinePrice: Number.isFinite(online) ? online : undefined,
      inStorePrice: tags.inStorePrice,
      markup: tags.markup,
      lastUpdated: tags.lastUpdated,
      shelfLocation: tags.shelfLocation,
      url: p.url ? `${BASE}${p.url}` : `${BASE}/products/${p.handle}`,
      pricingPolicy: "possible_markup" as const,
      priceKindOnline: "online",
      priceKindInStoreTag: "shelf",
    };
  });
  console.log(
    JSON.stringify(
      { source: BASE, query, count: mapped.length, products: mapped },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

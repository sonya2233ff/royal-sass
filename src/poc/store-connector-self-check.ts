/**
 * Fixture self-check for StorePrice mapping (MVR Shopify tags).
 *   npx tsx src/poc/store-connector-self-check.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseMvrShopifyTags } from "@/connectors/store-connector";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const fixturePath = path.join(
  process.cwd(),
  "src/connectors/fixtures/mvr-sample.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  products: Array<{
    title: string;
    tags: string[];
    variants: Array<{ sku: string; price: string; available: boolean }>;
  }>;
};

const product = fixture.products[0];
const tags = parseMvrShopifyTags(product.tags);
const online = Number.parseFloat(product.variants[0].price);

assert(tags.inStorePrice === 16.59, "INSTOREPRICE");
assert(tags.markup === 1.1, "MARKUP");
assert(online === 18.43, "online price");
assert(
  Math.abs(tags.inStorePrice! * tags.markup! - online) < 0.2,
  "online ≈ in-store × 1.1",
);
assert(product.variants[0].sku === "0083002800906", "SKU/UPC");

console.log("store-connector-self-check ok", {
  title: product.title,
  upc: product.variants[0].sku,
  inStorePrice: tags.inStorePrice,
  onlinePrice: online,
  markup: tags.markup,
});

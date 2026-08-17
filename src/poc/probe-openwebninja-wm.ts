/**
 * Smoke-test OpenWeb Ninja / RapidAPI Walmart CA for store #5831.
 *
 * Usage:
 *   set OPENWEBNINJA_API_KEY=...   (or RAPIDAPI_KEY)
 *   npx tsx --env-file=.env src/poc/probe-openwebninja-wm.ts
 *
 * Without a key, runs fixture mapper checks only.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  extractProductRows,
  isWalmartRapidConfigured,
  mapRapidProduct,
  WalmartRapidConnector,
} from "@/connectors/walmart-rapid";

const STORE = "5831";
const ZIP = "L4J0A7";

const QUERIES = [
  { id: "tomatoes", q: "grape tomatoes 10 oz", expectName: /grape|tomato/i },
  { id: "simply_egg_whites", q: "simply egg whites 1kg", expectName: /egg white/i },
  { id: "oat_beverage_original", q: "earth's own oat original 1.75", expectName: /oat/i },
  { id: "red_peppers", q: "red bell pepper", expectName: /pepper/i },
  { id: "sweet_potatoes", q: "sweet potatoes", expectName: /sweet potato/i },
  { id: "milk_2pct", q: "mehadrin 2% milk", expectName: /milk|mehadrin/i },
];

/** Documented-shaped fixture to validate mapper without burning API quota. */
const FIXTURE_SEARCH = {
  status: "OK",
  data: {
    products: [
      {
        product_id: "6000194960084",
        product_title: "Your Fresh Market Tomato, Grape, 10 oz",
        price: 2.97,
        package_size: "283 g",
        upc: "628915485012",
        url: "https://www.walmart.ca/en/ip/grape-tomatoes/6000194960084",
        image: "https://i5.walmartimages.ca/asr/grape-fixture.jpeg",
        out_of_stock: false,
        availability: "IN_STOCK",
      },
      {
        product_id: "6000196635381",
        product_title: "Burnbrae Farms Naturegg Simply Egg Whites 1KG",
        price: 9.47,
        package_size: "1 kg",
        out_of_stock: false,
      },
    ],
  },
};

function fixtureCheck(): void {
  const rows = extractProductRows(FIXTURE_SEARCH);
  if (rows.length !== 2) throw new Error(`fixture rows expected 2 got ${rows.length}`);
  const a = mapRapidProduct(rows[0]!, STORE);
  const b = mapRapidProduct(rows[1]!, STORE);
  if (!a || a.price !== 2.97 || a.productId !== "6000194960084") {
    throw new Error(`fixture tomato map failed: ${JSON.stringify(a)}`);
  }
  if (a.image !== "https://i5.walmartimages.ca/asr/grape-fixture.jpeg") {
    throw new Error(`fixture tomato image failed: ${a.image}`);
  }
  if (!b || b.price !== 9.47) {
    throw new Error(`fixture eggs map failed: ${JSON.stringify(b)}`);
  }
  console.log("fixture mapper: OK", a.name, `$${a.price}`, "|", b.name, `$${b.price}`);
}

async function liveProbe(): Promise<void> {
  const wm = new WalmartRapidConnector(ZIP);
  const results: unknown[] = [];

  for (const item of QUERIES) {
    console.log(`\n=== ${item.id} | q=${item.q}`);
    try {
      const hits = await wm.searchProducts(item.q, STORE);
      const top = hits.slice(0, 5).map((h) => ({
        id: h.productId,
        price: h.price,
        name: h.name.slice(0, 80),
        pack: h.packageSize,
        upc: h.upc,
      }));
      console.log(`hits=${hits.length}`);
      for (const t of top) {
        console.log(`  $${t.price.toFixed(2)}  ${t.name}  [${t.pack ?? "-"}]  ${t.id}`);
      }
      const matched = hits.find((h) => item.expectName.test(h.name));
      results.push({
        id: item.id,
        query: item.q,
        hitCount: hits.length,
        top,
        nameMatch: matched
          ? { productId: matched.productId, price: matched.price, name: matched.name }
          : null,
        note: matched
          ? "name pattern matched — verify shelf vs delivery manually"
          : "no name match in top results",
      });
    } catch (e) {
      console.error("ERROR", e instanceof Error ? e.message : e);
      results.push({
        id: item.id,
        query: item.q,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const dir = path.join(process.cwd(), "data", "runs");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `openwebninja-probe-${Date.now()}.json`);
  await writeFile(
    out,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        storeId: STORE,
        zip: ZIP,
        source: ownOrRapid(),
        results,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nWrote ${out}`);
}

function ownOrRapid(): string {
  if (process.env.OPENWEBNINJA_API_KEY?.trim()) return "openwebninja";
  if (process.env.RAPIDAPI_KEY?.trim()) return "rapidapi";
  return "none";
}

async function main() {
  fixtureCheck();
  if (!isWalmartRapidConfigured()) {
    console.log(
      "\nNo OPENWEBNINJA_API_KEY / RAPIDAPI_KEY — skip live probe.\n" +
        "Add key to .env then re-run: npm run probe:walmart-rapid",
    );
    return;
  }
  console.log(`Live probe via ${ownOrRapid()} store #${STORE}…`);
  await liveProbe();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

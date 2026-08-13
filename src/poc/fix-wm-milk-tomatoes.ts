/**
 * Refresh Walmart cache for tomatoes + Mehadrin milk only.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WalmartConnector } from "@/connectors/walmart";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import type { ProductOffer } from "@/connectors/types";
import { parseMassFromText, formatMass } from "@/domain/units";

function slim(o: ProductOffer) {
  const mass =
    parseMassFromText(o.packageSize ?? "") ?? parseMassFromText(o.name);
  return {
    productId: o.productId,
    name: o.name,
    brand: o.brand,
    packageSize: o.packageSize ?? (mass ? formatMass(mass.kg) : undefined),
    parsedMassKg: mass?.kg,
    upc: o.upc,
    price: o.price,
    unitPrice: o.unitPrice,
    availability: o.availability,
    confidence: o.confidence,
    checkedAt: o.checkedAt,
    sourceUrl: o.sourceUrl,
  };
}

async function gather(wm: WalmartConnector, queries: string[]) {
  const seen = new Map<string, ProductOffer>();
  for (const q of queries) {
    try {
      const hits = await wm.searchProducts(q, "5831");
      for (const h of hits) {
        if (!seen.has(h.productId)) seen.set(h.productId, h);
      }
      console.log(`  q="${q}" → ${hits.length} hits`);
    } catch (e) {
      console.log(
        `  q="${q}" ERR`,
        e instanceof Error ? e.message.slice(0, 100) : e,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return [...seen.values()];
}

async function main() {
  const wm = new WalmartConnector("L4J0A7");
  console.log("Searching Mehadrin milk…");
  const milkHits = await gather(wm, [
    "mehadrin",
    "mehadrin milk",
    "mehadrin 2%",
    "mehadrin kosher milk",
    "mehadrin 3%",
  ]);
  for (const h of milkHits.slice(0, 15)) {
    console.log(`  $${h.price} — ${h.name} (${h.productId})`);
  }

  console.log("\nSearching grape tomatoes…");
  const tomatoHits = await gather(wm, [
    "your fresh market grape tomatoes",
    "grape tomatoes 10 oz",
    "6000194960084",
  ]);
  for (const h of tomatoHits.slice(0, 10)) {
    console.log(`  $${h.price} — ${h.name} (${h.productId})`);
  }

  const catalogPath = path.join(
    process.cwd(),
    "data",
    "catalog",
    "walmart_5831_latest.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

  const grape =
    tomatoHits.find((h) => h.productId === "6000194960084") ??
    tomatoHits.find((h) => /grape/i.test(h.name) && /tomato/i.test(h.name));

  const meh2 = milkHits.find(
    (h) =>
      /mehadrin/i.test(h.name) &&
      /2\s*%|2%/.test(h.name) &&
      /milk/i.test(h.name),
  );
  const mehHomo = milkHits.find(
    (h) =>
      /mehadrin/i.test(h.name) &&
      /milk/i.test(h.name) &&
      (/(3\.25|3\s*%|homo|whole)/i.test(h.name) ||
        (!/1\s*%|2\s*%|1%|2%/.test(h.name) && /milk/i.test(h.name))),
  );

  for (const it of catalog.items) {
    if (it.id === "tomatoes" && grape) {
      it.status = "ok";
      it.offer = slim(grape);
      it.notes = "Pinned: YFM Grape Tomatoes 283g / 10 oz";
      it.image = "/products/tomatoes.png";
      console.log(`\n✓ tomatoes → $${grape.price} ${grape.name}`);
    }
    if (it.id === "milk_2pct") {
      if (meh2) {
        it.status = "ok";
        it.offer = slim(meh2);
        it.image = "/products/mehadrin_milk_2pct.png";
        console.log(`\n✓ milk_2pct → $${meh2.price} ${meh2.name}`);
      } else {
        console.log("\n✗ milk_2pct — Mehadrin 2% not in search hits");
        it.alternates = milkHits.filter((h) => /mehadrin/i.test(h.name)).map(slim);
      }
    }
    if (it.id === "homo_milk") {
      if (mehHomo && mehHomo.productId !== meh2?.productId) {
        it.status = "ok";
        it.offer = slim(mehHomo);
        it.image = "/products/mehadrin_milk_variants.png";
        console.log(`\n✓ homo_milk → $${mehHomo.price} ${mehHomo.name}`);
      } else {
        const anyMeh = milkHits.filter((h) => /mehadrin/i.test(h.name));
        console.log(
          `\n✗ homo_milk — Mehadrin homo not clear (${anyMeh.length} mehadrin hits)`,
        );
        it.alternates = anyMeh.map(slim);
      }
    }
  }

  catalog.checkedAt = new Date().toISOString();
  catalog.matched = catalog.items.filter(
    (i: { status: string }) => i.status === "ok",
  ).length;
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  console.log("\nSaved catalog.");
  await closeWalmartBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});

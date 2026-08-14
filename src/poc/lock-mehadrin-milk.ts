/**
 * Fetch Mehadrin milk via RapidAPI only (search fallback if product-details 500).
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WalmartRapidConnector } from "@/connectors/walmart-rapid";
import { parseMassFromText, formatMass } from "@/domain/units";
import type { ProductOffer } from "@/connectors/types";

const STORE = "5831";

const TARGETS = [
  {
    id: "milk_2pct_2l",
    label: "Mehadrin 2% Milk 2L",
    productId: "6000198384699",
    image: "/products/mehadrin_2pct.jpg",
    searches: ["mehadrin 2% milk", "mehadrin 2% 2L", "6000198384699"],
    match: (n: string) =>
      /mehadrin/i.test(n) &&
      /2\s*%|2%|2lt|2\s*l/i.test(n) &&
      !/1\s*%|3\.25|homo|chocolate/i.test(n),
  },
  {
    id: "homo_milk_2l",
    label: "Mehadrin Homo 3.25% Milk 2L",
    productId: "6000198386424",
    image: "/products/mehadrin_homo_3pct.png",
    searches: [
      "mehadrin homogenized",
      "mehadrin 3.25%",
      "mehadrin homo milk",
      "6000198386424",
    ],
    match: (n: string) =>
      /mehadrin/i.test(n) &&
      /(3\.25|homo|homogen)/i.test(n) &&
      !/2\s*%|1\s*%|chocolate/i.test(n),
  },
] as const;

function slim(o: ProductOffer) {
  const mass =
    parseMassFromText(o.packageSize ?? "") ?? parseMassFromText(o.name);
  // Drop absurd unit prices (API sometimes returns 321 instead of 0.32)
  let unitPrice = o.unitPrice;
  if (unitPrice != null && (unitPrice > o.price || unitPrice > 20)) {
    unitPrice = undefined;
  }
  return {
    productId: o.productId,
    name: o.name,
    brand: o.brand ?? "Mehadrin",
    packageSize: o.packageSize ?? (mass ? formatMass(mass.kg) : "2L"),
    parsedMassKg: mass?.kg ?? 2,
    upc: o.upc,
    price: o.price,
    unitPrice,
    availability: o.availability,
    confidence: o.confidence,
    checkedAt: o.checkedAt,
    sourceUrl: o.sourceUrl,
  };
}

async function fetchOne(
  wm: WalmartRapidConnector,
  t: (typeof TARGETS)[number],
): Promise<ProductOffer | null> {
  try {
    const direct = await wm.getProduct(t.productId, STORE);
    if (direct && t.match(direct.name)) {
      console.log(`getProduct ok $${direct.price} ${direct.name}`);
      return direct;
    }
    if (direct) console.log("getProduct name mismatch:", direct.name);
  } catch (e) {
    console.log("getProduct:", String(e).slice(0, 160));
  }

  const pool = new Map<string, ProductOffer>();
  for (const q of t.searches) {
    try {
      const hits = await wm.searchProducts(q, STORE);
      console.log(`search "${q}" → ${hits.length}`);
      for (const h of hits) pool.set(h.productId, h);
    } catch (e) {
      console.log(`search "${q}":`, String(e).slice(0, 160));
    }
  }
  const all = [...pool.values()];
  const pinned = all.find((h) => h.productId === t.productId);
  const matched =
    pinned ?? all.find((h) => t.match(h.name)) ?? null;
  console.log(
    "mehadrin in pool:",
    all
      .filter((h) => /mehadrin/i.test(h.name))
      .map((h) => `${h.productId} $${h.price} ${h.name}`),
  );
  return matched;
}

async function main() {
  const wm = new WalmartRapidConnector();
  const catalogPath = path.join(
    process.cwd(),
    "data/catalog/walmart_5831_latest.json",
  );
  const preferredPath = path.join(
    process.cwd(),
    "data/catalog/walmart_5831_preferred.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const preferred = JSON.parse(await readFile(preferredPath, "utf8"));

  for (const t of TARGETS) {
    console.log(`\n=== ${t.id}`);
    preferred.preferredProductIds[t.id] = t.productId;
    const offer = await fetchOne(wm, t);
    let it = catalog.items.find((x: { id: string }) => x.id === t.id);
    if (!it) {
      it = { id: t.id };
      catalog.items.push(it);
    }
    it.label = t.label;
    it.image = t.image;
    it.preferredProductId = t.productId;
    it.queriesTried = [...t.searches];
    if (offer) {
      it.status = "ok";
      it.offer = slim(offer);
      it.alternates = [];
      it.notes = "Mehadrin via Real-Time Walmart Data (RapidAPI)";
      console.log(`✓ $${offer.price} ${offer.name}`);
    } else {
      it.status = "no_match";
      it.offer = null;
      it.notes = "RapidAPI: Mehadrin SKU not returned yet";
      console.log("✗ no offer");
    }
  }

  catalog.matched = catalog.items.filter(
    (i: { status: string }) => i.status === "ok",
  ).length;
  catalog.updatedAt = new Date().toISOString();
  preferred.updatedAt = catalog.updatedAt;
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  await writeFile(preferredPath, JSON.stringify(preferred, null, 2));
  console.log("\nSaved.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Investigate Mehadrin 2% pricing — $1.27 is suspicious vs ~$5 expected.
 */
import { WalmartConnector } from "@/connectors/walmart";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import { searchProductsInBrowser } from "@/connectors/walmart-browser";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const wm = new WalmartConnector("L4J0A7");

  const queries = [
    "mehadrin 2%",
    "mehadrin 2% milk",
    "mehadrin partly skimmed",
    "6000202059621",
    "mehadrin kosher milk 2",
  ];

  const seen = new Map<string, Awaited<ReturnType<typeof wm.searchProducts>>[0]>();
  for (const q of queries) {
    console.log("\n===", q);
    try {
      const hits = await wm.searchProducts(q, "5831");
      for (const h of hits) {
        seen.set(h.productId, h);
        const n = h.name.toLowerCase();
        if (n.includes("mehadrin") && n.includes("milk")) {
          console.log(
            `  $${h.price} | ${h.name} | pkg=${h.packageSize ?? "-"} | unit=${h.unitPrice ?? "-"} | ${h.productId}`,
          );
          if (h.raw && typeof h.raw === "object") {
            const r = h.raw as Record<string, unknown>;
            const keys = [
              "salesUnit",
              "orderLimit",
              "weightIncrement",
              "averageWeight",
              "pricePerUnitQuantity",
              "offerId",
              "canonicalUrl",
            ];
            const extra: Record<string, unknown> = {};
            for (const k of keys) if (r[k] != null) extra[k] = r[k];
            const pi = r.priceInfo as Record<string, unknown> | undefined;
            if (pi) {
              extra.linePrice = pi.linePrice;
              extra.unitPrice = pi.unitPrice;
              extra.currentPrice = pi.currentPrice;
              extra.shipPrice = pi.shipPrice;
            }
            console.log("   raw:", JSON.stringify(extra));
          }
        }
      }
    } catch (e) {
      console.log(" ERR", e instanceof Error ? e.message.slice(0, 100) : e);
    }
  }

  // Prefer Mehadrin milk priced near $4–$8 (2L jug range)
  const milk = [...seen.values()].filter(
    (h) =>
      /mehadrin/i.test(h.name) &&
      /milk/i.test(h.name) &&
      /2\s*%|2%/.test(h.name) &&
      !/yogurt|cheese|butter|leben|bar/i.test(h.name),
  );
  console.log("\n--- candidates ---");
  for (const h of milk) {
    console.log(`$${h.price} ${h.name} (${h.productId})`);
  }

  const plausible =
    milk.find((h) => h.price >= 3.5 && h.price <= 9) ??
    milk.sort((a, b) => Math.abs(a.price - 5) - Math.abs(b.price - 5))[0];

  if (plausible) {
    const catalogPath = path.join(
      process.cwd(),
      "data/catalog/walmart_5831_latest.json",
    );
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    for (const it of catalog.items) {
      if (it.id === "milk_2pct") {
        it.status = "ok";
        it.offer = {
          productId: plausible.productId,
          name: plausible.name,
          packageSize: plausible.packageSize,
          price: plausible.price,
          unitPrice: plausible.unitPrice,
          availability: plausible.availability,
          confidence: plausible.confidence,
          checkedAt: plausible.checkedAt,
          sourceUrl: plausible.sourceUrl,
        };
        it.notes = `Corrected from suspicious $1.27 — using $${plausible.price}`;
        it.image = "/products/mehadrin_2pct.png";
        console.log("\nUPDATED catalog milk_2pct →", plausible.price, plausible.name);
      }
    }
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  } else {
    console.log("\nNo plausible ~$5 Mehadrin 2% found. Marking $1.27 as rejected.");
    const catalogPath = path.join(
      process.cwd(),
      "data/catalog/walmart_5831_latest.json",
    );
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    for (const it of catalog.items) {
      if (it.id === "milk_2pct") {
        it.status = "no_match";
        it.offer = null;
        it.notes =
          "Rejected Walmart hit $1.27 as implausible for 2L; cafe expects ~$5. Need correct SKU.";
        it.image = "/products/mehadrin_2pct.png";
        it.rejected = {
          productId: "6000202059621",
          price: 1.27,
          reason: "price far below expected ~$5 for Mehadrin 2% jug",
        };
      }
    }
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  }

  await closeWalmartBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});

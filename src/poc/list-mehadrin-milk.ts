import { WalmartConnector } from "@/connectors/walmart";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseMassFromText, formatMass } from "@/domain/units";

async function main() {
  const wm = new WalmartConnector("L4J0A7");
  const queries = ["mehadrin milk", "mehadrin 2% milk", "mehadrin homogenized milk"];
  const seen = new Map<string, Awaited<ReturnType<typeof wm.searchProducts>>[number]>();
  for (const q of queries) {
    const hits = await wm.searchProducts(q, "5831");
    for (const h of hits) seen.set(h.productId, h);
  }
  const milk = [...seen.values()].filter((h) => /milk/i.test(h.name));
  console.log(
    JSON.stringify(
      milk.map((h) => ({
        price: h.price,
        name: h.name,
        id: h.productId,
        pkg: h.packageSize,
        mass:
          parseMassFromText(h.packageSize ?? "") ?? parseMassFromText(h.name),
      })),
      null,
      2,
    ),
  );

  const meh2 =
    milk.find(
      (h) =>
        /mehadrin/i.test(h.name) &&
        /2\s*%|2%/.test(h.name) &&
        !/chocolate|leben|yogurt/i.test(h.name),
    ) ?? null;
  const mehHomo =
    milk.find(
      (h) =>
        /mehadrin/i.test(h.name) &&
        /(3\.25|3\s*%|homo|whole|homogen)/i.test(h.name) &&
        !/chocolate|leben|yogurt|2\s*%|1\s*%/i.test(h.name),
    ) ??
    milk.find(
      (h) =>
        /mehadrin/i.test(h.name) &&
        /milk/i.test(h.name) &&
        !/2\s*%|1\s*%|chocolate|leben|yogurt|butter/i.test(h.name),
    ) ??
    null;

  const catalogPath = path.join(
    process.cwd(),
    "data/catalog/walmart_5831_latest.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

  function slim(o: (typeof milk)[0]) {
    const mass =
      parseMassFromText(o.packageSize ?? "") ?? parseMassFromText(o.name);
    return {
      productId: o.productId,
      name: o.name,
      packageSize: o.packageSize ?? (mass ? formatMass(mass.kg) : undefined),
      parsedMassKg: mass?.kg,
      price: o.price,
      unitPrice: o.unitPrice,
      availability: o.availability,
      confidence: o.confidence,
      checkedAt: o.checkedAt,
      sourceUrl: o.sourceUrl,
    };
  }

  for (const it of catalog.items) {
    if (it.id === "milk_2pct" && meh2) {
      it.status = "ok";
      it.offer = slim(meh2);
      it.image = "/products/mehadrin_milk_2pct.png";
      console.log("SET 2%", meh2.price, meh2.name, meh2.packageSize);
    }
    if (it.id === "homo_milk" && mehHomo) {
      it.status = "ok";
      it.offer = slim(mehHomo);
      it.image = "/products/mehadrin_milk_variants.png";
      console.log("SET homo", mehHomo.price, mehHomo.name, mehHomo.packageSize);
    }
  }
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  await closeWalmartBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});

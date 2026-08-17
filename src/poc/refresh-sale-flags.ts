/**
 * Patch wasPrice / onSale on existing WM + NF catalog offers via getProduct.
 *
 *   npx tsx --env-file=.env src/poc/refresh-sale-flags.ts
 */
import { NoFrillsConnector } from "@/connectors/nofrills";
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import {
  loadNoFrillsCatalog,
  loadWalmartCatalog,
  saveNoFrillsCatalog,
  saveWalmartCatalog,
} from "@/lib/staples";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const wmCat = await loadWalmartCatalog();
  const nfCat = await loadNoFrillsCatalog();
  const wm = createWalmartConnector("L4J0A7");
  const nf = new NoFrillsConnector();

  if (wmCat) {
    console.error("Walmart sale flags…");
    for (const row of wmCat.items) {
      const id = row.offer?.productId;
      if (!id || (row.status !== "ok" && row.status !== "stale")) continue;
      try {
        const p = await wm.getProduct(id, "5831");
        if (!p || !row.offer) {
          console.log(`${row.id.padEnd(28)} WM miss`);
          continue;
        }
        row.offer.price = p.price;
        row.offer.wasPrice = p.wasPrice;
        row.offer.onSale =
          p.onSale ||
          (p.wasPrice != null && p.wasPrice > p.price + 0.005) ||
          undefined;
        row.offer.checkedAt = p.checkedAt;
        console.log(
          `${row.id.padEnd(28)} WM $${p.price.toFixed(2).padStart(6)}  ${
            row.offer.onSale
              ? `SALE was $${(p.wasPrice ?? 0).toFixed(2)}`
              : "—"
          }`,
        );
      } catch (e) {
        console.log(
          `${row.id.padEnd(28)} WM err ${e instanceof Error ? e.message.slice(0, 80) : e}`,
        );
      }
      await sleep(200);
    }
    await saveWalmartCatalog(wmCat);
  }

  if (nfCat) {
    console.error("No Frills sale flags…");
    for (const row of nfCat.items) {
      const id = row.offer?.productId;
      if (!id || (row.status !== "ok" && row.status !== "stale")) continue;
      try {
        const p = await nf.getProduct(id, "3660");
        if (!p || !row.offer) {
          console.log(`${row.id.padEnd(28)} NF miss`);
          continue;
        }
        row.offer.price = p.price;
        row.offer.wasPrice = p.wasPrice;
        row.offer.onSale =
          p.onSale ||
          (p.wasPrice != null && p.wasPrice > p.price + 0.005) ||
          undefined;
        row.offer.checkedAt = p.checkedAt;
        console.log(
          `${row.id.padEnd(28)} NF $${p.price.toFixed(2).padStart(6)}  ${
            row.offer.onSale
              ? `SALE was $${(p.wasPrice ?? 0).toFixed(2)}`
              : "—"
          }`,
        );
      } catch (e) {
        console.log(
          `${row.id.padEnd(28)} NF err ${e instanceof Error ? e.message.slice(0, 80) : e}`,
        );
      }
      await sleep(150);
    }
    await saveNoFrillsCatalog(nfCat);
  }

  await closeWalmartBrowser().catch(() => undefined);
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});

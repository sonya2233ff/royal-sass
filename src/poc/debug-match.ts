import { NoFrillsConnector } from "../connectors/nofrills";
import { SobeysConnector } from "../connectors/sobeys";
import { WalmartConnector } from "../connectors/walmart";
import { pickBestOffer } from "../domain/matching";
import type { ProductOffer } from "../connectors/types";

async function show(label: string, offers: ProductOffer[], q: string) {
  console.log(`\n=== ${label} | query="${q}" | raw hits=${offers.length}`);
  for (const o of offers.slice(0, 6)) {
    const keep = pickBestOffer([o], q);
    console.log(
      `  ${keep ? "KEEP" : "drop"} $${o.price} [${o.confidence}] ${o.name.slice(0, 70)}`,
    );
  }
  console.log(`  => BEST: ${pickBestOffer(offers, q)?.name ?? "NONE (all dropped or empty)"}`);
}

async function main() {
  process.env.WALMART_ALLOW_FLIPP_FALLBACK = "1";
  const queries = ["2% milk 4L", "bananas", "canola oil"];
  const nf = new NoFrillsConnector();
  const sb = new SobeysConnector("L4J6W7");
  const wm = new WalmartConnector("L4J0A7");

  for (const q of queries) {
    await show("No Frills 3660", await nf.searchProducts(q, "3660"), q);
    await show("Sobeys 659/Flipp", await sb.searchProducts(q, "659"), q);
    try {
      await show("Walmart 5831", await wm.searchProducts(q, "5831"), q);
    } catch (e) {
      console.log(`\n=== Walmart 5831 | query="${q}"`);
      console.log(`  => ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main();

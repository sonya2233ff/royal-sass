/**
 * Raw search dump for frozen staples (WM Rapid + NF).
 *   npx tsx --env-file=.env src/poc/probe-frozen.ts
 */
import { createWalmartConnector } from "@/connectors/walmart-source";
import { NoFrillsConnector } from "@/connectors/nofrills";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";

const QUERIES: Array<{ id: string; q: string }> = [
  { id: "frozen_apple", q: "frozen sliced apples" },
  { id: "frozen_banana", q: "frozen banana slices" },
  { id: "frozen_blueberry", q: "frozen blueberries" },
  { id: "frozen_strawberry", q: "frozen strawberries" },
  { id: "frozen_spinach", q: "frozen spinach" },
  { id: "frozen_spinach2", q: "spinach cubes" },
  { id: "acai", q: "frozen acai" },
  { id: "acai2", q: "sambazon acai" },
  { id: "acai3", q: "acai puree" },
];

async function main() {
  const wm = createWalmartConnector("L4J0A7");
  const nf = new NoFrillsConnector();

  for (const { id, q } of QUERIES) {
    console.log(`\n===== ${id} | ${q}`);
    try {
      const hits = await wm.searchProducts(q, "5831");
      console.log("WM", hits.length);
      for (const h of hits.slice(0, 8)) {
        console.log(
          `  WM $${h.price.toFixed(2).padStart(6)}  ${(h.packageSize ?? "").padEnd(12)} ${h.name.slice(0, 80)}`,
        );
      }
    } catch (e) {
      console.log("WM err", e instanceof Error ? e.message.slice(0, 120) : e);
    }
    try {
      const hits = await nf.searchProducts(q, "3660");
      console.log("NF", hits.length);
      for (const h of hits.slice(0, 8)) {
        console.log(
          `  NF $${h.price.toFixed(2).padStart(6)}  ${(h.packageSize ?? "").padEnd(18)} ${h.name.slice(0, 80)}`,
        );
      }
    } catch (e) {
      console.log("NF err", e instanceof Error ? e.message.slice(0, 120) : e);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await closeWalmartBrowser().catch(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Short price proof for pinned Walmart SKUs (store 5831).
 */
import { WalmartConnector } from "@/connectors/walmart";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";

const SKUS: Array<{ id: string; label: string; productId: string }> = [
  {
    id: "tomatoes",
    label: "YFM Grape Tomatoes 10oz",
    productId: "6000194960084",
  },
  {
    id: "milk_2pct",
    label: "Mehadrin 2% Partly Skimmed Milk",
    productId: "6000202059621",
  },
  {
    id: "oat",
    label: "Earth's Own Oat (cached id)",
    productId: "2ADJVX8MAQ1Q",
  },
  {
    id: "eggs",
    label: "Simply Egg Whites 1KG",
    productId: "6000196635381",
  },
  {
    id: "peppers",
    label: "SUNSET Red Bell Pepper",
    productId: "6000191286439",
  },
];

async function main() {
  const wm = new WalmartConnector("L4J0A7");
  console.log("Walmart #5831 live price proof\n");
  for (const s of SKUS) {
    try {
      const hits = await wm.searchProducts(s.productId, "5831");
      const hit =
        hits.find((h) => h.productId === s.productId) ?? hits[0] ?? null;
      if (!hit) {
        console.log(`✗ ${s.id}: no hit for ${s.productId}`);
      } else {
        console.log(
          `✓ ${s.id}: $${hit.price} — ${hit.name} [${hit.packageSize ?? "?"}]`,
        );
        console.log(`  productId=${hit.productId}`);
        console.log(`  ${hit.sourceUrl}`);
        console.log(`  checkedAt=${hit.checkedAt}`);
      }
    } catch (e) {
      console.log(
        `✗ ${s.id}:`,
        e instanceof Error ? e.message.slice(0, 120) : e,
      );
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Mehadrin homo / 3% hunt
  try {
    const hits = await wm.searchProducts("mehadrin milk", "5831");
    const milk = hits.filter(
      (h) => /mehadrin/i.test(h.name) && /milk/i.test(h.name),
    );
    console.log("\nAll Mehadrin *milk* hits:");
    for (const h of milk) {
      console.log(`  $${h.price} — ${h.name} (${h.productId})`);
    }
  } catch (e) {
    console.log("mehadrin hunt failed", e);
  }

  await closeWalmartBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});

/**
 * Search Walmart #5831 and apply relevance matching (no cookie values printed).
 */
import { WalmartConnector } from "@/connectors/walmart";
import { pickBestOffer } from "@/domain/matching";

async function main() {
  const storeId = "5831";
  const queries = [
    "2% milk 4L",
    "large eggs",
    "chicken breast",
    "canola oil",
    "bananas",
  ];
  const wm = new WalmartConnector("L4J0A7");

  for (const q of queries) {
    const offers = await wm.searchProducts(q, storeId);
    const best = pickBestOffer(offers, q);
    console.log(`\nQ: ${q} | raw=${offers.length}`);
    if (!best) {
      console.log("  BEST: NONE");
      console.log(
        "  top raw:",
        offers
          .slice(0, 3)
          .map((o) => `$${o.price} ${o.name.slice(0, 50)}`)
          .join(" | "),
      );
    } else {
      console.log(
        `  BEST: $${best.price} [${best.confidence}] ${best.name} (${best.productId})`,
      );
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Store-diff for the locked POC retailers.
 *
 * Usage:
 *   npx tsx src/poc/store-diff.ts no_frills 3660 3660 "2% milk 4L"
 *   npx tsx src/poc/store-diff.ts walmart_ca 5831 5831 "milk"
 *   npx tsx src/poc/store-diff.ts sobeys 659 659 "milk"
 */
import { getConnector, ConnectorError } from "@/connectors";
import { discoverSobeysClarkHilda } from "@/connectors/sobeys";
import { persistRawResponse } from "@/lib/persistence";

async function main() {
  const [retailer, storeA, storeB, ...queryParts] = process.argv.slice(2);
  if (!retailer || !storeA || !storeB) {
    console.error(
      "Usage: tsx src/poc/store-diff.ts <retailer> <storeA> <storeB> [query]",
    );
    console.error("Retailers: no_frills | walmart_ca | sobeys");
    console.error("Locked POC stores: walmart 5831, nofrills 3660, sobeys 659");
    process.exit(1);
  }

  const query = queryParts.join(" ") || "milk";
  const postal =
    retailer === "sobeys"
      ? "L4J6W7"
      : retailer === "walmart_ca"
        ? "L4J0A7"
        : "L4J3M8";

  if (retailer === "sobeys") {
    const discovery = await discoverSobeysClarkHilda();
    console.log("Sobeys Clark & Hilda discovery:");
    console.log(`  merchant_store_code: ${discovery.merchantStoreCode}`);
    for (const note of discovery.notes) console.log(`  - ${note}`);
    console.log("");
  }

  const connector = getConnector(retailer, { postalCode: postal });

  async function fetchTop(storeId: string) {
    try {
      const offers = await connector.searchProducts(query, storeId);
      await persistRawResponse({
        retailer,
        storeId,
        requestMeta: { query, protocol: "store-diff", postal },
        body: offers.slice(0, 5).map((o) => ({
          productId: o.productId,
          name: o.name,
          price: o.price,
          confidence: o.confidence,
          availability: o.availability,
        })),
      });
      return { ok: true as const, offers };
    } catch (e) {
      const message =
        e instanceof ConnectorError
          ? `[${e.code}] ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      return { ok: false as const, error: message, offers: [] };
    }
  }

  const a = await fetchTop(storeA);
  await new Promise((r) => setTimeout(r, 500));
  const b = await fetchTop(storeB);

  console.log(`Retailer: ${retailer}`);
  console.log(`Query: ${query}`);
  console.log("");

  for (const [label, result, storeId] of [
    ["A", a, storeA],
    ["B", b, storeB],
  ] as const) {
    console.log(`Store ${label} (${storeId}):`);
    if (!result.ok) {
      console.log(`  ERROR: ${result.error}`);
    } else if (result.offers.length === 0) {
      console.log("  No offers");
    } else {
      const top = result.offers[0];
      console.log(
        `  ${top.name} | $${top.price} | ${top.availability} | ${top.confidence} | checked ${top.checkedAt}`,
      );
      console.log(`  productId=${top.productId}`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

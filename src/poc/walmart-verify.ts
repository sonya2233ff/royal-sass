/**
 * Verify Walmart #5831 map/store node + attempt product search paths.
 *
 * Usage:
 *   npm run walmart:warm
 *   npm run poc:walmart-verify
 */
import { WalmartConnector } from "@/connectors/walmart";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import { ConnectorError } from "@/connectors/types";

async function main() {
  const storeId = process.argv[2] ?? "5831";
  const query = process.argv[3] ?? "2% milk 4L";
  const wm = new WalmartConnector("L4J0A7");

  console.log(`Resolving store page /en/store/${storeId} ...`);
  const cookie = process.env.WALMART_BROWSER_COOKIE ?? "";
  const cookieKeys = cookie
    .split(";")
    .map((p) => p.trim().split("=")[0])
    .filter(Boolean);
  console.log(
    `Cookie keys (${cookieKeys.length}): ${cookieKeys.join(", ") || "(none)"}`,
  );
  const hasStoreBind = cookieKeys.some((k) =>
    /deliveryCatchment|defaultNearestStoreId|assortmentStoreId/i.test(k),
  );
  const hasPx = cookieKeys.some((k) => /^_px/i.test(k) || k === "pxcts");
  if (cookie && !hasPx) {
    console.log(
      "WARN: missing PerimeterX cookies (_px*). Prefer: npm run walmart:warm",
    );
  } else if (cookie && !hasStoreBind) {
    console.log(
      "NOTE: no deliveryCatchment in cookie jar — connector will inject storeId cookies for 5831.",
    );
  }

  const node = await wm.resolveStore(storeId);
  if (!node) {
    console.log("FAIL: could not resolve store page");
    process.exit(1);
  }
  console.log("STORE NODE OK:");
  console.log(
    JSON.stringify(
      {
        storeId: node.storeId,
        displayName: node.displayName,
        name: node.name,
        addressLineOne: node.addressLineOne,
        postalCode: node.postalCode,
        phoneNumber: node.phoneNumber,
      },
      null,
      2,
    ),
  );

  console.log(`\nSearching products q="${query}" store=${storeId} ...`);
  console.log(
    `WALMART_BROWSER_COOKIE set: ${Boolean(process.env.WALMART_BROWSER_COOKIE)}`,
  );
  console.log(
    `WALMART_USE_BROWSER: ${process.env.WALMART_USE_BROWSER ?? "1 (default)"}`,
  );

  try {
    const offers = await wm.searchProducts(query, storeId);
    console.log(`offers=${offers.length}`);
    for (const o of offers.slice(0, 5)) {
      console.log(
        `  $${o.price} [${o.confidence}] ${o.name} (${o.productId}) checked=${o.checkedAt}`,
      );
    }
    if (offers.length === 0) {
      console.log(
        "No offers. Run: npm run walmart:warm — see docs/walmart-pricing.md",
      );
    }
  } catch (e) {
    if (e instanceof ConnectorError) {
      console.log(`ERROR [${e.code}] ${e.message}`);
    } else {
      console.log(String(e));
    }
    process.exitCode = 2;
  } finally {
    await closeWalmartBrowser().catch(() => undefined);
  }
}

main();

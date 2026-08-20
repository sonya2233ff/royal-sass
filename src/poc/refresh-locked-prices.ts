/**
 * Re-fetch shelf prices for pinned staple SKUs (no rematch).
 *
 *   npm run cache:prices
 *   npm run cache:prices -- tomatoes_grape ziploc_sandwich
 */
import { isShownStaple, PINNED_IDS, RECEIPT_STAPLE_IDS } from "@/lib/staples";
import {
  refreshCatalogPrices,
  type CatalogPriceRefreshResult,
  type PriceRefreshFailure,
  type PriceRefreshHit,
} from "@/lib/refresh-catalog-prices";

function printRetailer(
  title: string,
  block: {
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
    blocked?: string;
  },
) {
  console.error(`\n${title}`);
  if (block.blocked) {
    console.error(`  blocked: ${block.blocked}`);
  }
  for (const hit of block.updated) {
    const prev =
      hit.previousPrice != null ? `$${hit.previousPrice.toFixed(2)} → ` : "";
    console.log(
      `  ${hit.id.padEnd(28)} ${prev}$${hit.price.toFixed(2)}  ${hit.name}`,
    );
  }
  const shown = block.failed.slice(0, 8);
  for (const row of shown) {
    console.log(`  ${row.id.padEnd(28)} FAIL  ${row.reason}`);
  }
  if (block.failed.length > shown.length) {
    console.log(`  … ${block.failed.length - shown.length} more failures`);
  }
}

function storeSummary(
  block: {
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
    blocked?: string;
  },
  extra?: Record<string, unknown>,
) {
  return {
    updated: block.updated.length,
    failed: block.failed.length,
    skipped: block.skipped.length,
    blocked: Boolean(block.blocked),
    ...extra,
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const all = [...PINNED_IDS, ...RECEIPT_STAPLE_IDS];
  const ids = (args.length ? args : all).filter((id) => isShownStaple({ id }));
  if (!ids.length) {
    console.error("No valid staple ids");
    process.exit(1);
  }

  console.error(`Refreshing catalog prices for ${ids.length} staples…`);
  const result: CatalogPriceRefreshResult = await refreshCatalogPrices(ids);

  printRetailer("Walmart", result.walmart);
  printRetailer("No Frills", result.noFrills);
  printRetailer("Wholesale Club", result.wholesaleClub);
  printRetailer("MVR Weston", result.mvr);

  const summary = {
    walmart: storeSummary(result.walmart, { source: result.walmart.source }),
    noFrills: storeSummary(result.noFrills),
    wholesaleClub: storeSummary(result.wholesaleClub),
    mvr: storeSummary(result.mvr),
  };
  console.error(
    `\nDone. WM updated=${summary.walmart.updated} failed=${summary.walmart.failed} skip=${summary.walmart.skipped}`,
  );
  console.error(
    `     NF updated=${summary.noFrills.updated} failed=${summary.noFrills.failed} skip=${summary.noFrills.skipped}`,
  );
  console.error(
    `     WC updated=${summary.wholesaleClub.updated} failed=${summary.wholesaleClub.failed} skip=${summary.wholesaleClub.skipped}`,
  );
  console.error(
    `     MVR updated=${summary.mvr.updated} failed=${summary.mvr.failed} skip=${summary.mvr.skipped}`,
  );
  console.error(`SUMMARY ${JSON.stringify(summary)}`);

  const totalUpdated =
    summary.walmart.updated +
    summary.noFrills.updated +
    summary.wholesaleClub.updated +
    summary.mvr.updated;
  if (totalUpdated === 0) {
    console.error("No catalog prices updated.");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

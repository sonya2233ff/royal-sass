/**
 * Re-fetch shelf prices for pinned staple SKUs (no rematch).
 *
 *   npm run cache:prices
 *   npm run cache:prices -- tomatoes_grape ziploc_sandwich
 */
import { isShownStaple, PINNED_IDS, RECEIPT_STAPLE_IDS } from "@/lib/staples";
import { refreshCatalogPrices } from "@/lib/refresh-catalog-prices";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const all = [...PINNED_IDS, ...RECEIPT_STAPLE_IDS];
  const ids = (args.length ? args : all).filter((id) => isShownStaple({ id }));
  if (!ids.length) {
    console.error("No valid staple ids");
    process.exit(1);
  }

  console.error(`Refreshing catalog prices for ${ids.length} staples…`);
  const result = await refreshCatalogPrices(ids);

  console.error("\nWalmart");
  for (const hit of result.walmart.updated) {
    const prev =
      hit.previousPrice != null ? `$${hit.previousPrice.toFixed(2)} → ` : "";
    console.log(
      `  ${hit.id.padEnd(28)} ${prev}$${hit.price.toFixed(2)}  ${hit.name}`,
    );
  }
  for (const row of result.walmart.failed) {
    console.log(`  ${row.id.padEnd(28)} FAIL  ${row.reason}`);
  }
  for (const row of result.walmart.skipped) {
    console.log(`  ${row.id.padEnd(28)} skip  ${row.reason}`);
  }

  console.error("\nNo Frills");
  if (result.noFrills.blocked) {
    console.error(`  blocked: ${result.noFrills.blocked}`);
  }
  for (const hit of result.noFrills.updated) {
    const prev =
      hit.previousPrice != null ? `$${hit.previousPrice.toFixed(2)} → ` : "";
    console.log(
      `  ${hit.id.padEnd(28)} ${prev}$${hit.price.toFixed(2)}  ${hit.name}`,
    );
  }
  for (const row of result.noFrills.failed.slice(0, 5)) {
    console.log(`  ${row.id.padEnd(28)} FAIL  ${row.reason}`);
  }
  if (result.noFrills.failed.length > 5) {
    console.log(`  … ${result.noFrills.failed.length - 5} more NF failures`);
  }

  console.error(
    `\nDone. WM updated=${result.walmart.updated.length} failed=${result.walmart.failed.length} skip=${result.walmart.skipped.length}`,
  );
  console.error(
    `     NF updated=${result.noFrills.updated.length} failed=${result.noFrills.failed.length} skip=${result.noFrills.skipped.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

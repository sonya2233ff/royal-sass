/**
 * Force-refresh No Frills catalog for pinned staples.
 *
 *   npm run cache:nofrills
 *   npm run cache:nofrills -- oat_beverage_original bananas_kg
 */
import {
  isShownStaple,
  PINNED_IDS,
  RECEIPT_STAPLE_IDS,
  refreshNoFrillsSelected,
} from "@/lib/staples";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const all = [...PINNED_IDS, ...RECEIPT_STAPLE_IDS];
  const ids = (args.length ? args : all).filter((id) => isShownStaple({ id }));
  if (!ids.length) {
    console.error("No valid staple ids");
    process.exit(1);
  }

  console.error(`Refreshing NF for ${ids.length} items…`);
  const result = await refreshNoFrillsSelected(ids);
  for (const e of result.entries) {
    const a = e.accepted;
    console.log(
      [
        e.itemId.padEnd(28),
        e.status.padEnd(12),
        a ? `$${a.price.toFixed(2)}` : "—",
        a?.name ?? e.rejected.at(-1)?.reason ?? "",
      ].join("  "),
    );
  }
  console.error(`\nDone. log=${result.logId} updated=${result.updated.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

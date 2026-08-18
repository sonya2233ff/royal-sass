/**
 * Force-refresh MVR Cash & Carry catalog for shown staples.
 *
 *   npm run cache:mvr
 *   npm run cache:mvr -- tomatoes_grape butter_454g
 */
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";
import { refreshMvrSelected } from "@/lib/mvr-observe";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const cfg = await loadStaplesConfig();
  const allowed = cfg.items.filter(isShownStaple).map((i) => i.id);
  const ids = (args.length ? args : allowed).filter((id) => allowed.includes(id));
  if (!ids.length) {
    console.error("No valid staple ids");
    process.exit(1);
  }

  console.error(`Refreshing MVR Weston for ${ids.length} items…`);
  const result = await refreshMvrSelected(ids);
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
  console.error(
    `\nDone. log=${result.logId} updated=${result.updated.length} unmatched=${result.unmatched.length}`,
  );
  if (result.unmatched.length) {
    console.error(`Unmatched: ${result.unmatched.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Purchase-plan recommendations: 1–2 stops, never 4-way cheapest-item split.
 *   npx tsx src/poc/purchase-plans-self-check.ts
 */
import {
  MAX_STOPS_TO_FILL,
  MIN_SINGLE_ITEM_STOP_SAVINGS,
  MIN_SPLIT_SAVINGS,
  recommendPurchasePlans,
  type PlanLine,
} from "@/domain/purchase-plans";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function line(
  id: string,
  costs: PlanLine["costs"],
  label = id,
): PlanLine {
  return { id, label, costs };
}

function main() {
  const allWmCheaper: PlanLine[] = [
    line("milk", { walmart: 4, nofrills: 5, wholesaleclub: 6, mvr: 7 }),
    line("butter", { walmart: 7, nofrills: 8, wholesaleclub: 9, mvr: 10 }),
    line("eggs", { walmart: 5, nofrills: 5.5, wholesaleclub: 6, mvr: 8 }),
  ];
  const one = recommendPurchasePlans(allWmCheaper);
  assert(one.length >= 1, "at least one plan");
  assert(one[0]?.id === "walmart", `best one-store ${one[0]?.id}`);
  assert(one[0]?.recommended, "WM recommended when it is cheapest complete");
  assert(
    one[0]?.stopCount === 1 && one[0]?.complete,
    "first plan is complete one-store",
  );
  assert(
    !one.some((p) => p.stopCount > 1 && p.recommended),
    "no split recommended when one store wins",
  );

  const splitSaves: PlanLine[] = [
    line("milk", { walmart: 10, wholesaleclub: 4, nofrills: 11, mvr: 12 }),
    line("butter", { walmart: 10, wholesaleclub: 4, nofrills: 11, mvr: 12 }),
    line("eggs", { walmart: 5, wholesaleclub: 9, nofrills: 8, mvr: 9 }),
  ];
  const split = recommendPurchasePlans(splitSaves);
  const two = split.find((p) => p.id === "walmart+wholesaleclub");
  assert(two?.complete, "WM+WC complete");
  assert((two?.savingsVsBestOneStore ?? 0) > MIN_SPLIT_SAVINGS, "saves vs one-store");
  assert(two?.kind === "split_cheaper", `kind ${two?.kind}`);
  assert(two?.recommended, "cheaper two-stop is recommended");
  assert(
    split.some((p) => p.id === "walmart" && p.complete && !p.recommended),
    "still show all-at-WM as an option",
  );

  const tinyOneItem: PlanLine[] = [
    line("milk", { walmart: 4, wholesaleclub: 3.8, nofrills: 5, mvr: 6 }),
    line("butter", { walmart: 7, wholesaleclub: 8, nofrills: 9, mvr: 10 }),
    line("eggs", { walmart: 5, wholesaleclub: 6, nofrills: 6, mvr: 7 }),
  ];
  const tiny = recommendPurchasePlans(tinyOneItem);
  assert(
    !tiny.some((p) => p.stopCount > 1),
    `do not extra-stop for $${(4 - 3.8).toFixed(2)} on one item (< $${MIN_SINGLE_ITEM_STOP_SAVINGS})`,
  );

  const gap: PlanLine[] = [
    line("milk", { walmart: 4, nofrills: 5, wholesaleclub: null, mvr: 6 }),
    line("butter", { walmart: 7, nofrills: 8, wholesaleclub: 9, mvr: 10 }),
    line("lids", { walmart: null, nofrills: null, wholesaleclub: 12, mvr: null }),
  ];
  const fill = recommendPurchasePlans(gap);
  const wmWc = fill.find((p) => p.id === "walmart+wholesaleclub");
  assert(wmWc?.complete, "WM+WC fills the missing lids");
  assert(wmWc?.kind === "split_fill", `gap kind ${wmWc?.kind}`);
  assert(wmWc?.recommended, "split to fill a hole is recommended");
  assert(
    !fill.some((p) => p.stopCount === 1 && p.complete),
    "no one-store complete when lids are WC-only",
  );

  const fourWay: PlanLine[] = [
    line("a", { walmart: 1, nofrills: 9, wholesaleclub: 9, mvr: 9 }),
    line("b", { walmart: 9, nofrills: 1, wholesaleclub: 9, mvr: 9 }),
    line("c", { walmart: 9, nofrills: 9, wholesaleclub: 1, mvr: 9 }),
    line("d", { walmart: 9, nofrills: 9, wholesaleclub: 9, mvr: 1 }),
  ];
  const scattered = recommendPurchasePlans(fourWay);
  assert(
    scattered.every((p) => p.stopCount <= MAX_STOPS_TO_FILL),
    "never recommend 4 stores even if each is cheapest on one line",
  );
  assert(
    scattered.some((p) => p.stopCount === 2 && p.complete && p.recommended),
    "cap cheaper splits at two stops",
  );

  const exclusive: PlanLine[] = [
    line("a", { walmart: 1 }),
    line("b", { nofrills: 1 }),
    line("c", { wholesaleclub: 1 }),
    line("d", { mvr: 1 }),
  ];
  const holes = recommendPurchasePlans(exclusive);
  assert(
    holes.every((p) => p.stopCount <= MAX_STOPS_TO_FILL),
    "exclusive SKUs still never use 4 stops",
  );
  const three = holes.find((p) => p.stopCount === 3);
  assert(three, "3-stop only to cover more when 1–2 cannot complete");
  assert(!three.complete, "3 stops still miss the 4th exclusive item");
  assert(three.filled === 3, `3 of 4 filled, got ${three.filled}`);

  const hidden = recommendPurchasePlans(splitSaves, ["walmart", "nofrills"]);
  assert(
    hidden.every((p) => !p.stores.includes("wholesaleclub") && !p.stores.includes("mvr")),
    "hidden stores are omitted from plans",
  );
  assert(hidden.some((p) => p.id === "walmart" && p.complete), "WM still complete");

  console.log("purchase-plans-self-check ok");
}

main();

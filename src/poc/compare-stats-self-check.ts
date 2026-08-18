/**
 * Compare-history persistence checks.
 *   npx tsx src/poc/compare-stats-self-check.ts
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendCompareRun,
  buildCompareRunRecord,
  capCompareHistory,
  COMPARE_HISTORY_LIMIT,
  loadCompareHistory,
  recordCompareResult,
  summarizeCompareHistory,
  type CompareRowSnapshot,
} from "@/lib/compare-stats";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const rows: CompareRowSnapshot[] = [
  {
    id: "bananas_kg",
    label: "Bananas",
    qty: 1,
    grams: 1000,
    cheaper: "nofrills",
    delta: 0.4,
    basketWalmart: 1.74,
    basketNoFrills: 1.34,
    basketWholesaleClub: 1.5,
    basketMvr: null,
  },
  {
    id: "ice_cubes",
    label: "Bag of ice",
    qty: 2,
    grams: null,
    cheaper: "mvr",
    delta: 1.1,
    basketWalmart: 4.98,
    basketNoFrills: 4.5,
    basketWholesaleClub: 4.2,
    basketMvr: 3.4,
  },
];

const runA = buildCompareRunRecord({
  comparedAt: "2026-08-18T12:00:00.000Z",
  matchLogId: "match-1",
  rows,
  totals: {
    completeCount: 2,
    walmart: 6.72,
    noFrills: 5.84,
    wholesaleClub: 5.7,
    mvr: 3.4,
    cheaper: "mvr",
    cheaperTwoWay: "nofrills",
    cheaperThree: "wholesaleclub",
    tripleCount: 2,
    quadCount: 1,
  },
});

assert(runA.id === `compare-${Date.parse(runA.comparedAt)}`, `id ${runA.id}`);
assert(runA.itemCount === 2, "two items");
assert(runA.items[1]?.qty === 2, "qty kept");
assert(runA.items[0]?.grams === 1000, "grams kept");
assert(runA.totals.cheaper === "mvr", "basket winner");

const runB = buildCompareRunRecord({
  comparedAt: "2026-08-18T15:00:00.000Z",
  rows: [rows[0]!],
  totals: {
    completeCount: 1,
    walmart: 1.74,
    noFrills: 1.34,
    wholesaleClub: 1.5,
    mvr: 0,
    cheaper: "nofrills",
  },
});

const summary = summarizeCompareHistory([runA, runB]);
assert(summary.runCount === 2, "run count");
assert(summary.itemCompares === 3, "item compares");
assert(summary.uniqueItems === 2, "unique items");
assert(summary.basketWins.mvr === 1 && summary.basketWins.nofrills === 1, "wins");
assert(summary.lastComparedAt === "2026-08-18T15:00:00.000Z", "newest first");
assert(summary.topItems[0]?.id === "bananas_kg", "bananas most compared");
assert(summary.topItems[0]?.times === 2, "bananas twice");
assert(summary.topItems[0]?.wins.nofrills === 2, "bananas NF won both");

const capped = capCompareHistory(
  Array.from({ length: COMPARE_HISTORY_LIMIT + 5 }, (_, i) =>
    buildCompareRunRecord({
      comparedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      rows: [rows[0]!],
      totals: {
        completeCount: 1,
        walmart: 1,
        noFrills: 2,
        wholesaleClub: 3,
        mvr: 4,
        cheaper: "walmart",
      },
    }),
  ),
);
assert(capped.length === COMPARE_HISTORY_LIMIT, "cap");
assert(capped[0]!.comparedAt > capped[capped.length - 1]!.comparedAt, "newest kept");

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "compare-stats-"));
  const file = path.join(dir, "compare-history.json");
  try {
    const saved = await recordCompareResult({
      comparedAt: runA.comparedAt,
      matchLogId: runA.matchLogId,
      rows,
      totals: runA.totals,
      file,
    });
    assert(saved != null, "first save");
    assert(saved.persisted === true, "disk persist");
    assert(saved.runs.length === 1, "one run on disk");
    const again = await appendCompareRun(runB, file);
    assert(again.length === 2, "second run");
    const loaded = await loadCompareHistory(file);
    assert(loaded[0]!.id === runB.id, "loaded newest first");
    const raw = JSON.parse(await readFile(file, "utf8")) as { runs: unknown[] };
    assert(raw.runs.length === 2, "file payload");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log("compare-stats self-check ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

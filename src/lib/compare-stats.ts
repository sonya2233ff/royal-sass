/**
 * Persist cafe staple compare runs so the page can show history and
 * win-rate stats after refresh. JSON on disk (same pattern as catalogs).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const COMPARE_HISTORY_LIMIT = 200;
export const COMPARE_STATS_FILE = path.join(
  process.cwd(),
  "data",
  "stats",
  "compare-history.json",
);

export interface CompareRunItem {
  id: string;
  label: string;
  qty: number;
  grams: number | null;
  cheaper: string;
  delta: number | null;
  walmart: number | null;
  noFrills: number | null;
  wholesaleClub: number | null;
  mvr: number | null;
}

export interface CompareRunTotals {
  completeCount: number;
  walmart: number;
  noFrills: number;
  wholesaleClub: number;
  mvr: number;
  cheaper: string;
  cheaperTwoWay?: string;
  cheaperThree?: string;
  tripleCount?: number;
  quadCount?: number;
}

export interface CompareRunRecord {
  id: string;
  comparedAt: string;
  matchLogId?: string | null;
  itemCount: number;
  items: CompareRunItem[];
  totals: CompareRunTotals;
}

export interface CompareHistoryFile {
  updatedAt: string;
  runs: CompareRunRecord[];
}

export interface ItemStat {
  id: string;
  label: string;
  times: number;
  wins: Record<string, number>;
}

export interface CompareStatsSummary {
  runCount: number;
  lastComparedAt: string | null;
  itemCompares: number;
  uniqueItems: number;
  basketWins: Record<string, number>;
  topItems: ItemStat[];
}

export type CompareRowSnapshot = {
  id: string;
  label: string;
  qty?: number;
  grams?: number | null;
  cheaper: string;
  delta: number | null;
  basketWalmart: number | null;
  basketNoFrills: number | null;
  basketWholesaleClub: number | null;
  basketMvr: number | null;
};

function isRunRecord(value: unknown): value is CompareRunRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as CompareRunRecord;
  return (
    typeof row.id === "string" &&
    typeof row.comparedAt === "string" &&
    Array.isArray(row.items) &&
    row.totals != null &&
    typeof row.totals === "object"
  );
}

export function sortRunsNewestFirst(
  runs: CompareRunRecord[],
): CompareRunRecord[] {
  return runs.slice().sort((a, b) => {
    if (a.comparedAt === b.comparedAt) return b.id.localeCompare(a.id);
    return a.comparedAt < b.comparedAt ? 1 : -1;
  });
}

export function capCompareHistory(
  runs: CompareRunRecord[],
  limit = COMPARE_HISTORY_LIMIT,
): CompareRunRecord[] {
  return sortRunsNewestFirst(runs).slice(0, limit);
}

export function buildCompareRunRecord(input: {
  comparedAt?: string;
  matchLogId?: string | null;
  rows: CompareRowSnapshot[];
  totals: CompareRunTotals;
}): CompareRunRecord {
  const comparedAt = input.comparedAt ?? new Date().toISOString();
  const stamp = Date.parse(comparedAt);
  return {
    id: `compare-${Number.isFinite(stamp) ? stamp : Date.now()}`,
    comparedAt,
    matchLogId: input.matchLogId ?? null,
    itemCount: input.rows.length,
    items: input.rows.map((row) => ({
      id: row.id,
      label: row.label,
      qty: row.qty ?? 1,
      grams: row.grams ?? null,
      cheaper: row.cheaper,
      delta: row.delta,
      walmart: row.basketWalmart,
      noFrills: row.basketNoFrills,
      wholesaleClub: row.basketWholesaleClub,
      mvr: row.basketMvr,
    })),
    totals: {
      completeCount: input.totals.completeCount,
      walmart: input.totals.walmart,
      noFrills: input.totals.noFrills,
      wholesaleClub: input.totals.wholesaleClub,
      mvr: input.totals.mvr,
      cheaper: input.totals.cheaper,
      cheaperTwoWay: input.totals.cheaperTwoWay,
      cheaperThree: input.totals.cheaperThree,
      tripleCount: input.totals.tripleCount,
      quadCount: input.totals.quadCount,
    },
  };
}

export function summarizeCompareHistory(
  runs: CompareRunRecord[],
  topN = 20,
): CompareStatsSummary {
  const basketWins: Record<string, number> = {};
  const byItem = new Map<string, ItemStat>();
  for (const run of runs) {
    const winner = run.totals.cheaper || "incomplete";
    basketWins[winner] = (basketWins[winner] ?? 0) + 1;
    for (const item of run.items) {
      const cur = byItem.get(item.id) ?? {
        id: item.id,
        label: item.label,
        times: 0,
        wins: {},
      };
      cur.times += 1;
      cur.label = item.label;
      const key = item.cheaper || "incomplete";
      cur.wins[key] = (cur.wins[key] ?? 0) + 1;
      byItem.set(item.id, cur);
    }
  }
  const topItems = [...byItem.values()]
    .sort(
      (a, b) => b.times - a.times || a.label.localeCompare(b.label, "uk"),
    )
    .slice(0, topN);
  const newest = sortRunsNewestFirst(runs)[0];
  return {
    runCount: runs.length,
    lastComparedAt: newest?.comparedAt ?? null,
    itemCompares: runs.reduce((sum, run) => sum + run.itemCount, 0),
    uniqueItems: byItem.size,
    basketWins,
    topItems,
  };
}

export async function loadCompareHistory(
  file = COMPARE_STATS_FILE,
): Promise<CompareRunRecord[]> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as CompareHistoryFile | CompareRunRecord[];
    const runs = Array.isArray(parsed) ? parsed : parsed.runs;
    if (!Array.isArray(runs)) return [];
    return capCompareHistory(runs.filter(isRunRecord));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    return [];
  }
}

export async function appendCompareRun(
  run: CompareRunRecord,
  file = COMPARE_STATS_FILE,
): Promise<CompareRunRecord[]> {
  const prev = await loadCompareHistory(file);
  const runs = capCompareHistory([
    run,
    ...prev.filter((row) => row.id !== run.id),
  ]);
  await mkdir(path.dirname(file), { recursive: true });
  const payload: CompareHistoryFile = {
    updatedAt: new Date().toISOString(),
    runs,
  };
  await writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return runs;
}

export async function recordCompareResult(input: {
  comparedAt?: string;
  matchLogId?: string | null;
  rows: CompareRowSnapshot[];
  totals: CompareRunTotals;
  file?: string;
}): Promise<{
  run: CompareRunRecord;
  runs: CompareRunRecord[];
  summary: CompareStatsSummary;
} | null> {
  try {
    const run = buildCompareRunRecord(input);
    const runs = await appendCompareRun(run, input.file ?? COMPARE_STATS_FILE);
    return { run, runs, summary: summarizeCompareHistory(runs) };
  } catch {
    return null;
  }
}

export async function loadCompareStats(file = COMPARE_STATS_FILE): Promise<{
  runs: CompareRunRecord[];
  summary: CompareStatsSummary;
}> {
  const runs = await loadCompareHistory(file);
  return { runs, summary: summarizeCompareHistory(runs) };
}

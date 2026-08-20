/**
 * Cafe purchase plans: a few realistic stop combinations, not
 * cheapest-item-in-each-of-four-stores. One store when it is complete.
 * Two stores when that is cheaper or fills a hole. Three only if 1–2
 * cannot cover the cart. Never four stops.
 */
import {
  COMPARE_STORE_IDS,
  COMPARE_STORES,
  type CompareStoreId,
} from "@/domain/compare-stores";
import { roundMoney } from "@/domain/purchase-units";

/** Extra stop for a cheaper price must beat this (CAD). */
export const MIN_SPLIT_SAVINGS = 0.5;
/** One extra item that the primary also sells: need a clearer saving. */
export const MIN_SINGLE_ITEM_STOP_SAVINGS = 2;
export const MAX_STOPS_FOR_CHEAPER_SPLIT = 2;
export const MAX_STOPS_TO_FILL = 3;
export const MAX_PLANS_SHOWN = 3;

export type PurchasePlanKind = "one_store" | "split_cheaper" | "split_fill";

export type PlanLine = {
  id: string;
  label: string;
  costs: Partial<Record<CompareStoreId, number | null | undefined>>;
};

export type PurchasePlanAssignment = {
  id: string;
  label: string;
  store: CompareStoreId;
  lineTotal: number;
};

export type PurchasePlanStop = {
  store: CompareStoreId;
  subtotal: number;
  itemCount: number;
  itemIds: string[];
  labels: string[];
};

export type PurchasePlan = {
  id: string;
  stores: CompareStoreId[];
  stopCount: number;
  total: number;
  complete: boolean;
  filled: number;
  requested: number;
  coverage: string;
  kind: PurchasePlanKind;
  recommended: boolean;
  savingsVsBestOneStore: number | null;
  stops: PurchasePlanStop[];
  assignments: PurchasePlanAssignment[];
  missingIds: string[];
  missingLabels: string[];
};

export function storePlanLabel(id: CompareStoreId): string {
  return COMPARE_STORES.find((s) => s.id === id)?.label ?? id;
}

export function storePlanShort(id: CompareStoreId): string {
  return COMPARE_STORES.find((s) => s.id === id)?.short ?? id;
}

export function lineStoreCost(
  line: PlanLine,
  store: CompareStoreId,
): number | null {
  const n = line.costs[store];
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

function storeCombos(stores: CompareStoreId[], k: number): CompareStoreId[][] {
  if (k <= 1) return stores.map((s) => [s]);
  const out: CompareStoreId[][] = [];
  const walk = (start: number, acc: CompareStoreId[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < stores.length; i++) {
      acc.push(stores[i]!);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function assignLines(
  lines: PlanLine[],
  stores: CompareStoreId[],
): {
  assignments: PurchasePlanAssignment[];
  missing: PlanLine[];
} {
  const counts: Partial<Record<CompareStoreId, number>> = {};
  const unique: PurchasePlanAssignment[] = [];
  const shared: PlanLine[] = [];
  const missing: PlanLine[] = [];

  for (const line of lines) {
    const available = stores.filter((s) => lineStoreCost(line, s) != null);
    if (!available.length) {
      missing.push(line);
      continue;
    }
    if (available.length === 1) {
      const store = available[0]!;
      unique.push({
        id: line.id,
        label: line.label,
        store,
        lineTotal: lineStoreCost(line, store)!,
      });
      counts[store] = (counts[store] ?? 0) + 1;
    } else {
      shared.push(line);
    }
  }

  const assignments = [...unique];
  for (const line of shared) {
    const available = stores.filter((s) => lineStoreCost(line, s) != null);
    let best = available[0]!;
    let bestPrice = lineStoreCost(line, best)!;
    for (const store of available.slice(1)) {
      const price = lineStoreCost(line, store)!;
      if (price < bestPrice - 0.005) {
        best = store;
        bestPrice = price;
      } else if (
        Math.abs(price - bestPrice) < 0.005 &&
        (counts[store] ?? 0) > (counts[best] ?? 0)
      ) {
        best = store;
      }
    }
    assignments.push({
      id: line.id,
      label: line.label,
      store: best,
      lineTotal: bestPrice,
    });
    counts[best] = (counts[best] ?? 0) + 1;
  }
  return { assignments, missing };
}

function stopsFromAssignments(
  assignments: PurchasePlanAssignment[],
): PurchasePlanStop[] {
  const byStore = new Map<CompareStoreId, PurchasePlanAssignment[]>();
  for (const row of assignments) {
    const list = byStore.get(row.store) ?? [];
    list.push(row);
    byStore.set(row.store, list);
  }
  const stops: PurchasePlanStop[] = [];
  for (const store of COMPARE_STORE_IDS) {
    const list = byStore.get(store);
    if (!list?.length) continue;
    stops.push({
      store,
      subtotal: roundMoney(list.reduce((s, a) => s + a.lineTotal, 0)),
      itemCount: list.length,
      itemIds: list.map((a) => a.id),
      labels: list.map((a) => a.label),
    });
  }
  return stops.sort(
    (a, b) => b.itemCount - a.itemCount || a.store.localeCompare(b.store),
  );
}

function buildPlan(
  lines: PlanLine[],
  stores: CompareStoreId[],
  requireEveryStore: boolean,
): PurchasePlan | null {
  if (!stores.length || !lines.length) return null;
  const { assignments, missing } = assignLines(lines, stores);
  if (!assignments.length) return null;
  const used = [...new Set(assignments.map((a) => a.store))];
  if (requireEveryStore && used.length !== stores.length) return null;
  const stops = stopsFromAssignments(assignments);
  const total = roundMoney(assignments.reduce((s, a) => s + a.lineTotal, 0));
  const filled = assignments.length;
  const requested = lines.length;
  const complete = missing.length === 0 && filled === requested;
  const ordered = used
    .slice()
    .sort((a, b) => COMPARE_STORE_IDS.indexOf(a) - COMPARE_STORE_IDS.indexOf(b));
  return {
    id: ordered.join("+"),
    stores: ordered,
    stopCount: ordered.length,
    total,
    complete,
    filled,
    requested,
    coverage: `${filled} із ${requested}`,
    kind: ordered.length === 1 ? "one_store" : "split_fill",
    recommended: false,
    savingsVsBestOneStore: null,
    stops,
    assignments,
    missingIds: missing.map((m) => m.id),
    missingLabels: missing.map((m) => m.label),
  };
}

function extraStopJustified(
  plan: PurchasePlan,
  lines: PlanLine[],
  bestOne: PurchasePlan | null,
): boolean {
  if (plan.stopCount <= 1) return true;
  if (!plan.complete) {
    return plan.filled > (bestOne?.filled ?? 0);
  }
  if (!bestOne?.complete) return true;
  const savings = roundMoney(bestOne.total - plan.total);
  if (savings < MIN_SPLIT_SAVINGS) return false;
  if (plan.stopCount > MAX_STOPS_FOR_CHEAPER_SPLIT) return false;
  const smallest = plan.stops.reduce((a, b) =>
    a.itemCount <= b.itemCount ? a : b,
  );
  const primary = plan.stops[0];
  if (smallest.itemCount === 1 && primary && smallest.store !== primary.store) {
    const itemId = smallest.itemIds[0];
    const line = lines.find((l) => l.id === itemId);
    const alsoAtPrimary =
      line != null && lineStoreCost(line, primary.store) != null;
    if (alsoAtPrimary && savings < MIN_SINGLE_ITEM_STOP_SAVINGS) return false;
  }
  return true;
}

function decorateKind(
  plan: PurchasePlan,
  bestOne: PurchasePlan | null,
): PurchasePlan {
  if (plan.stopCount === 1) return { ...plan, kind: "one_store" };
  if (
    plan.complete &&
    bestOne?.complete &&
    plan.total + 0.005 < bestOne.total
  ) {
    return { ...plan, kind: "split_cheaper" };
  }
  return { ...plan, kind: "split_fill" };
}

function comparePlans(a: PurchasePlan, b: PurchasePlan): number {
  if (a.complete !== b.complete) return a.complete ? -1 : 1;
  if (a.filled !== b.filled) return b.filled - a.filled;
  if (a.stopCount !== b.stopCount) return a.stopCount - b.stopCount;
  if (Math.abs(a.total - b.total) > 0.005) return a.total - b.total;
  return a.id.localeCompare(b.id);
}

function pickRecommended(
  shown: PurchasePlan[],
  bestOne: PurchasePlan | null,
): string | null {
  const complete = shown.filter((p) => p.complete).sort(comparePlans);
  const bestTwo = complete.find((p) => p.stopCount === 2) ?? null;
  if (
    bestOne?.complete &&
    bestTwo?.kind === "split_cheaper" &&
    bestTwo.total + MIN_SPLIT_SAVINGS <= bestOne.total + 0.005
  ) {
    return bestTwo.id;
  }
  if (bestOne?.complete) return bestOne.id;
  if (complete[0]) return complete[0].id;
  const coverage = shown.slice().sort(comparePlans);
  return coverage[0]?.id ?? null;
}

/**
 * A few buy-here / split-there options for the current cart.
 * `enabled` is the homepage store-chip set (hidden stores are omitted, not $0).
 */
export function recommendPurchasePlans(
  lines: PlanLine[],
  enabled?: Iterable<CompareStoreId>,
): PurchasePlan[] {
  if (!lines.length) return [];
  const enabledSet = new Set(
    [...(enabled ?? COMPARE_STORE_IDS)].filter((id) =>
      COMPARE_STORE_IDS.includes(id),
    ),
  );
  const stores = COMPARE_STORE_IDS.filter((id) => enabledSet.has(id));
  if (!stores.length) return [];

  const oneStore = stores
    .map((s) => buildPlan(lines, [s], false))
    .filter((p): p is PurchasePlan => p != null);
  const completeOne = oneStore
    .filter((p) => p.complete)
    .sort((a, b) => a.total - b.total || a.id.localeCompare(b.id));
  const bestOne = completeOne[0] ?? null;

  const twoStore = storeCombos(stores, 2)
    .map((pair) => buildPlan(lines, pair, true))
    .filter((p): p is PurchasePlan => p != null)
    .filter((p) => extraStopJustified(p, lines, bestOne));

  const needThree =
    !bestOne &&
    !twoStore.some((p) => p.complete) &&
    stores.length >= 3;
  const threeStore = needThree
    ? storeCombos(stores, 3)
        .map((triple) => buildPlan(lines, triple, true))
        .filter((p): p is PurchasePlan => p != null)
        .filter((p) => extraStopJustified(p, lines, bestOne))
        .filter((p) => p.stopCount <= MAX_STOPS_TO_FILL)
    : [];

  const decorated = [...oneStore, ...twoStore, ...threeStore].map((p) => {
    const savings =
      bestOne?.complete && p.stopCount > 1 && p.complete
        ? roundMoney(bestOne.total - p.total)
        : null;
    return decorateKind(
      { ...p, savingsVsBestOneStore: savings },
      bestOne,
    );
  });

  const oneComplete = decorated
    .filter((p) => p.stopCount === 1 && p.complete)
    .sort((a, b) => a.total - b.total);
  const splits = decorated
    .filter((p) => p.stopCount > 1)
    .sort(comparePlans);
  const oneIncomplete = decorated
    .filter((p) => p.stopCount === 1 && !p.complete)
    .sort((a, b) => b.filled - a.filled || a.total - b.total);

  const shown: PurchasePlan[] = [];
  const seen = new Set<string>();
  const push = (plan: PurchasePlan | undefined) => {
    if (!plan || seen.has(plan.id)) return;
    if (shown.length >= MAX_PLANS_SHOWN) return;
    seen.add(plan.id);
    shown.push(plan);
  };

  push(oneComplete[0]);
  if (oneComplete[1] && oneComplete[0]) {
    const close =
      oneComplete[1].total <= oneComplete[0].total + 8 ||
      oneComplete[1].total <= oneComplete[0].total * 1.08;
    if (close) push(oneComplete[1]);
  }
  push(splits.find((p) => p.complete));
  if (!shown.some((p) => p.complete)) {
    push(oneIncomplete[0]);
    push(splits[0]);
    push(oneIncomplete[1]);
  } else if (!shown.some((p) => p.stopCount > 1)) {
    push(splits[0]);
  }

  const recId = pickRecommended(shown, bestOne);
  return shown.map((p) => ({ ...p, recommended: p.id === recId }));
}

export function linesFromBasketRows(
  rows: Array<{
    id: string;
    label: string;
    basketWalmart?: number | null;
    basketNoFrills?: number | null;
    basketWholesaleClub?: number | null;
    basketMvr?: number | null;
    walmart?: { lineTotal?: number | null };
    noFrills?: { lineTotal?: number | null };
    wholesaleClub?: { lineTotal?: number | null };
    mvr?: { lineTotal?: number | null };
  }>,
): PlanLine[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    costs: {
      walmart: row.basketWalmart ?? row.walmart?.lineTotal,
      nofrills: row.basketNoFrills ?? row.noFrills?.lineTotal,
      wholesaleclub: row.basketWholesaleClub ?? row.wholesaleClub?.lineTotal,
      mvr: row.basketMvr ?? row.mvr?.lineTotal,
    },
  }));
}

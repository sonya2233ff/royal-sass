/**
 * Which of the four compare columns the operator wants on screen.
 * Missing prices stay N/A — hiding a store does not treat it as $0.
 */
export const COMPARE_STORE_IDS = [
  "walmart",
  "nofrills",
  "wholesaleclub",
  "mvr",
] as const;

export type CompareStoreId = (typeof COMPARE_STORE_IDS)[number];

export const COMPARE_STORES: ReadonlyArray<{
  id: CompareStoreId;
  short: string;
  label: string;
  detail: string;
}> = [
  { id: "walmart", short: "WM", label: "Walmart", detail: "#5831" },
  { id: "nofrills", short: "NF", label: "No Frills", detail: "#3660" },
  { id: "wholesaleclub", short: "WC", label: "Wholesale Club", detail: "#3724" },
  { id: "mvr", short: "MVR", label: "MVR", detail: "Weston" },
];

export const COMPARE_STORES_STORAGE_KEY = "royal-sass-compare-stores-v1";
/** Driver page: stores the driver can stop at (not homepage compare columns). */
export const DRIVER_STORES_STORAGE_KEY = "royal-sass-driver-stores-v1";

const ID_SET = new Set<string>(COMPARE_STORE_IDS);

export function isCompareStoreId(value: string): value is CompareStoreId {
  return ID_SET.has(value);
}

export function allCompareStoreIds(): CompareStoreId[] {
  return [...COMPARE_STORE_IDS];
}

export function parseCompareStores(raw: unknown): CompareStoreId[] {
  const src = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return raw.split(",");
          }
        })()
      : null;
  if (!Array.isArray(src)) return allCompareStoreIds();
  const out: CompareStoreId[] = [];
  const seen = new Set<CompareStoreId>();
  for (const value of src) {
    const id = String(value ?? "").trim();
    if (!isCompareStoreId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length ? out : allCompareStoreIds();
}

export function toggleCompareStore(
  enabled: ReadonlySet<CompareStoreId>,
  id: CompareStoreId,
): Set<CompareStoreId> {
  const next = new Set(enabled);
  if (next.has(id)) {
    if (next.size <= 1) return next;
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function storeEnabled(
  enabled: ReadonlySet<CompareStoreId>,
  id: CompareStoreId,
): boolean {
  return enabled.has(id);
}

export function cheaperAmongStores(
  costs: Partial<Record<CompareStoreId, number | null | undefined>>,
  enabled: ReadonlySet<CompareStoreId>,
): { cheaper: string; delta: number | null } {
  const priced = COMPARE_STORE_IDS.filter((id) => enabled.has(id))
    .map((id) => {
      const n = costs[id];
      return n != null && Number.isFinite(n) ? ([id, n] as const) : null;
    })
    .filter((row): row is readonly [CompareStoreId, number] => row != null);
  if (priced.length < 2) {
    return { cheaper: "incomplete", delta: null };
  }
  const min = Math.min(...priced.map(([, n]) => n));
  const winners = priced.filter(([, n]) => Math.abs(n - min) < 0.005);
  const second = [...priced.map(([, n]) => n)].sort((a, b) => a - b)[1];
  return {
    cheaper: winners.length > 1 ? "tie" : winners[0]![0],
    delta:
      second != null ? Math.round((min - second) * 100) / 100 : null,
  };
}

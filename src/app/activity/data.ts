export type Store = "walmart" | "nofrills" | "mvr";

export type Buy = {
  id: string;
  label: string;
  store: Store;
  qty: number;
  /** Total paid for this line (qty included). */
  paid: number;
  /** Saved on this line vs the next-cheapest other store (qty included). */
  saved: number;
};

export type Day = {
  date: string; // YYYY-MM-DD
  /** Driver who did the shopping run. */
  driver: string;
  /** When the driver uploaded the receipt photo. */
  uploadedAt: string;
  /** Public path to the receipt photo the driver uploaded. */
  receipt: string;
  buys: Buy[];
};

export const STORE_UA: Record<Store, { short: string; name: string }> = {
  walmart: { short: "WM", name: "Walmart #5831" },
  nofrills: { short: "NF", name: "No Frills #3660" },
  mvr: { short: "MVR", name: "MVR Cash & Carry" },
};

/**
 * Seed days for Activity. Empty on purpose so operator testing starts clean;
 * live driver runs land in `royal-sass-activity-v1` via `activity-log.ts`.
 */
export const ACTIVITY_DAYS: Day[] = [];

export function findDay(date: string): Day | null {
  return ACTIVITY_DAYS.find((day) => day.date === date) ?? null;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function ukProductCount(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} продукт`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} продукти`;
  return `${n} продуктів`;
}

const DATE_FMT = new Intl.DateTimeFormat("uk-UA", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const WEEKDAY_FMT = new Intl.DateTimeFormat("uk-UA", { weekday: "long" });

export function formatDate(iso: string): { full: string; weekday: string } {
  const d = new Date(`${iso}T00:00:00`);
  return { full: DATE_FMT.format(d), weekday: WEEKDAY_FMT.format(d) };
}

export type DaySummary = {
  spent: number;
  saved: number;
  count: number;
  /** Spent per store. */
  byStore: Record<Store, number>;
};

export function summarize(day: Day): DaySummary {
  return day.buys.reduce<DaySummary>(
    (acc, buy) => {
      acc.spent += buy.paid;
      acc.saved += buy.saved;
      acc.count += 1;
      acc.byStore[buy.store] += buy.paid;
      return acc;
    },
    {
      spent: 0,
      saved: 0,
      count: 0,
      byStore: { walmart: 0, nofrills: 0, mvr: 0 },
    },
  );
}

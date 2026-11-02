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

const RECEIPT_WM = "/receipts/receipt-walmart.jpg";
const RECEIPT_NF = "/receipts/receipt-nofrills.jpg";

/**
 * Mock purchase history (same mock spirit as the waiter/driver portals).
 * Each day holds the lines a driver actually bought, which store won the line,
 * what was paid and how much was saved vs the other store, plus the photo of
 * the paper receipt the driver uploaded after the shopping run.
 */
export const ACTIVITY_DAYS: Day[] = [
  {
    date: "2026-11-02",
    driver: "Олег",
    uploadedAt: "2026-11-02, 18:24",
    receipt: RECEIPT_WM,
    buys: [
      { id: "large_eggs_dozen", label: "Large Eggs 12ct", store: "nofrills", qty: 2, paid: 11.98, saved: 1.4 },
      { id: "simply_egg_whites", label: "Naturegg Simply Egg Whites 1kg", store: "walmart", qty: 1, paid: 9.47, saved: 1.51 },
      { id: "tomatoes_grape", label: "Grape Tomatoes (pack)", store: "nofrills", qty: 2, paid: 7.98, saved: 0.8 },
      { id: "milk_2pct_2l", label: "Mehadrin 2% Milk 2L", store: "walmart", qty: 3, paid: 13.47, saved: 0.9 },
    ],
  },
  {
    date: "2026-11-01",
    driver: "Марія",
    uploadedAt: "2026-11-01, 12:05",
    receipt: RECEIPT_NF,
    buys: [
      { id: "butter_454g", label: "Gay Lea Unsalted Butter 454g", store: "nofrills", qty: 2, paid: 11.98, saved: 2.0 },
      { id: "orange_juice_pulp", label: "Tropicana OJ No Pulp 2.63L", store: "walmart", qty: 1, paid: 6.97, saved: 0.52 },
      { id: "lemons_2lb", label: "Lemons (bag ~2lb)", store: "nofrills", qty: 1, paid: 3.49, saved: 0.5 },
    ],
  },
  {
    date: "2026-10-30",
    driver: "Софія",
    uploadedAt: "2026-10-30, 09:41",
    receipt: RECEIPT_WM,
    buys: [
      { id: "homo_milk_2l", label: "Mehadrin Homo 3.25% Milk 2L", store: "walmart", qty: 2, paid: 9.94, saved: 0.6 },
      { id: "strawberries", label: "Strawberries 1lb", store: "nofrills", qty: 2, paid: 7.0, saved: 1.0 },
      { id: "ice_cubes", label: "Ice Cubes 2kg", store: "walmart", qty: 4, paid: 11.96, saved: 0.8 },
      { id: "ziploc_sandwich", label: "Ziploc Sandwich Bags", store: "nofrills", qty: 1, paid: 3.99, saved: 0.3 },
    ],
  },
  {
    date: "2026-10-28",
    driver: "Олег",
    uploadedAt: "2026-10-28, 17:58",
    receipt: RECEIPT_NF,
    buys: [
      { id: "large_eggs_dozen", label: "Large Eggs 12ct", store: "nofrills", qty: 4, paid: 23.96, saved: 2.8 },
      { id: "butter_454g", label: "Gay Lea Unsalted Butter 454g", store: "walmart", qty: 1, paid: 5.99, saved: 0.4 },
    ],
  },
];

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

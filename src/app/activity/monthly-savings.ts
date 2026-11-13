import type { Day } from "./data";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

/** Calendar length of a month. `month` is 1–12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  const label = new Intl.DateTimeFormat("uk-UA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const cleaned = label.replace(/\s*р\.?$/u, "").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export type SavingsMonth = {
  key: string;
  label: string;
  saved: number;
  runs: number;
};

/** Months that have a run, plus the current month, newest first. */
export function savingsMonths(days: Day[], todayIso: string): SavingsMonth[] {
  const keys = new Set<string>();
  if (ISO_RE.test(todayIso)) keys.add(monthKeyFromIso(todayIso));
  for (const day of days) {
    if (ISO_RE.test(day.date)) keys.add(monthKeyFromIso(day.date));
  }
  return [...keys]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((key) => {
      const inMonth = days.filter((day) => day.date.startsWith(`${key}-`));
      const saved = round2(
        inMonth.reduce((sum, day) => sum + (Number.isFinite(day.saved) ? day.saved : 0), 0),
      );
      return { key, label: monthLabel(key), saved, runs: inMonth.length };
    });
}

export type MonthPoint = {
  date: string;
  day: number;
  saved: number;
  cumulative: number;
  /** This day's savings minus the previous calendar day. Null on day 1. */
  change: number | null;
  hasRun: boolean;
};

/** One point per calendar day so a quiet day still shows as no change. */
export function monthSeries(days: Day[], monthKey: string): MonthPoint[] {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const count = daysInMonth(year, month);
  const points: MonthPoint[] = [];
  let cumulative = 0;
  let previous = 0;
  for (let day = 1; day <= count; day += 1) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const row = byDate.get(date);
    const saved = round2(row && Number.isFinite(row.saved) ? Math.max(0, row.saved) : 0);
    cumulative = round2(cumulative + saved);
    points.push({
      date,
      day,
      saved,
      cumulative,
      change: day === 1 ? null : round2(saved - previous),
      hasRun: Boolean(row),
    });
    previous = saved;
  }
  return points;
}

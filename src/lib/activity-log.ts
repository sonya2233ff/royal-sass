/**
 * Driver → Activity bridge (same-browser localStorage).
 * Seed mock days stay in `src/app/activity/data.ts`; live runs append here.
 */

import {
  availableStores,
  priceOf,
  type PlanItem,
} from "@/app/driver/route-plan";
import type { Buy, Day, Store } from "@/app/activity/data";
import { ACTIVITY_DAYS } from "@/app/activity/data";

export const ACTIVITY_STORAGE_KEY = "royal-sass-activity-v1";
const CHANNEL = "royal-sass-activity-v1";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Calendar date in America/Toronto (YYYY-MM-DD). */
export function torontoDateIso(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function torontoUploadedAt(d = new Date()): string {
  const date = torontoDateIso(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date}, ${time}`;
}

function parseBuys(raw: unknown): Buy[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const rec = row as Record<string, unknown>;
      const store = String(rec.store ?? "");
      if (store !== "walmart" && store !== "nofrills" && store !== "mvr") {
        return null;
      }
      const qty = Number(rec.qty);
      const paid = Number(rec.paid);
      const saved = Number(rec.saved);
      const id = String(rec.id ?? "");
      const label = String(rec.label ?? id);
      if (!id) return null;
      return {
        id,
        label: label.slice(0, 120),
        store: store as Store,
        qty: Number.isFinite(qty) && qty > 0 ? Math.min(99, Math.round(qty)) : 1,
        paid: Number.isFinite(paid) ? round2(Math.max(0, paid)) : 0,
        saved: Number.isFinite(saved) ? round2(Math.max(0, saved)) : 0,
      } satisfies Buy;
    })
    .filter((row): row is Buy => row != null);
}

function parseDay(raw: unknown): Day | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const date = String(rec.date ?? "");
  if (!DATE_RE.test(date)) return null;
  const buys = parseBuys(rec.buys);
  if (!buys.length) return null;
  return {
    date,
    driver:
      typeof rec.driver === "string" && rec.driver.trim()
        ? rec.driver.trim().slice(0, 40)
        : "Водій",
    uploadedAt:
      typeof rec.uploadedAt === "string" && rec.uploadedAt.trim()
        ? rec.uploadedAt.trim().slice(0, 40)
        : torontoUploadedAt(),
    receipt:
      typeof rec.receipt === "string" && rec.receipt.trim()
        ? rec.receipt
        : "",
    buys,
  };
}

export function loadLiveActivityDays(): Day[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseDay)
      .filter((day): day is Day => day != null)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch {
    return [];
  }
}

/** Wipe live Activity history on this browser (keeps seed array empty). */
export function clearLiveActivity(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
    notifyActivityChange();
  } catch {
    /* ignore */
  }
}

function writeLiveDays(days: Day[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify(days.slice(0, 60)),
    );
    notifyActivityChange();
  } catch {
    /* ignore quota */
  }
}

/** Live runs override seed mocks on the same date. */
export function listActivityDays(): Day[] {
  const live = loadLiveActivityDays();
  const byDate = new Map<string, Day>();
  for (const day of ACTIVITY_DAYS) byDate.set(day.date, day);
  for (const day of live) byDate.set(day.date, day);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function findActivityDay(date: string): Day | null {
  if (!DATE_RE.test(date)) return null;
  const live = loadLiveActivityDays().find((d) => d.date === date);
  if (live) return live;
  return ACTIVITY_DAYS.find((d) => d.date === date) ?? null;
}

function savedForLine(item: PlanItem): number {
  const alts = availableStores(item.id).filter((s) => s !== item.store);
  if (!alts.length) return 0;
  let altUnit = Infinity;
  for (const store of alts) {
    const p = priceOf(item.id, store);
    if (p != null && p < altUnit) altUnit = p;
  }
  if (!Number.isFinite(altUnit)) return 0;
  return Math.max(0, round2(altUnit * item.qty - item.lineTotal));
}

export type RecordDriverRunInput = {
  items: PlanItem[];
  labelOf: (id: string) => string;
  driver?: string;
  /** data: URL or public path; empty = no photo */
  receipt?: string;
};

/** Append / merge today's buys from a completed driver shopping run. */
export function recordDriverRun(input: RecordDriverRunInput): Day | null {
  if (!input.items.length) return null;
  const date = torontoDateIso();
  const buys: Buy[] = input.items.map((item) => ({
    id: item.id,
    label: input.labelOf(item.id).slice(0, 120),
    store: item.store as Store,
    qty: item.qty,
    paid: round2(item.lineTotal),
    saved: savedForLine(item),
  }));

  const existing = loadLiveActivityDays();
  const prev = existing.find((d) => d.date === date);
  const mergedBuys = [...(prev?.buys ?? [])];
  for (const buy of buys) {
    const hit = mergedBuys.findIndex((row) => row.id === buy.id && row.store === buy.store);
    if (hit >= 0) {
      const cur = mergedBuys[hit];
      const qty = Math.min(99, cur.qty + buy.qty);
      const paid = round2(cur.paid + buy.paid);
      const saved = round2(cur.saved + buy.saved);
      mergedBuys[hit] = { ...cur, qty, paid, saved };
    } else {
      mergedBuys.push(buy);
    }
  }

  const day: Day = {
    date,
    driver: (input.driver ?? prev?.driver ?? "Водій").slice(0, 40),
    uploadedAt: torontoUploadedAt(),
    receipt: input.receipt?.trim() || prev?.receipt || "",
    buys: mergedBuys,
  };

  const next = [day, ...existing.filter((d) => d.date !== date)].slice(0, 60);
  writeLiveDays(next);
  return day;
}

export function notifyActivityChange(): void {
  if (typeof window === "undefined") return;
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ kind: "activity", at: Date.now() });
    ch.close();
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event("royal-sass-activity"));
  } catch {
    /* ignore */
  }
}

export function subscribeActivity(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const run = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === ACTIVITY_STORAGE_KEY || e.key === null) run();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", run);
  window.addEventListener("royal-sass-activity", run);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => run();
  } catch {
    channel = null;
  }
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", run);
    window.removeEventListener("royal-sass-activity", run);
    channel?.close();
  };
}

/** Best-effort blob: → data: for local receipt preview (skip huge files). */
export async function blobUrlToDataUrl(
  url: string,
  maxBytes = 700_000,
): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    if (blob.size > maxBytes) return null;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

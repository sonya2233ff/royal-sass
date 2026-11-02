/**
 * Same-browser bridge: waiter list ↔ driver shopping list.
 * Vercel has no shared server store for this yet; localStorage is the live path
 * (same pattern as product overrides / custom staples).
 */

export const WAITER_LIST_STORAGE_KEY = "royal-sass-waiter-list-v1";
/** Confirmed batches the waiter locked for the driver (survive clearing the draft). */
export const DRIVER_JOBS_STORAGE_KEY = "royal-sass-driver-jobs-v1";
const CHANNEL = "royal-sass-waiter-driver-v1";

export type WaiterLine = {
  id: string;
  qty: number;
  note: string;
};

export type DriverJob = {
  id: string;
  createdAt: number;
  waiter: string;
  status: "open" | "done";
  lines: WaiterLine[];
};

export function parseWaiterLines(raw: unknown): WaiterLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const rec = row as Record<string, unknown>;
      const id = String(rec.id ?? "");
      const qty = Number(rec.qty);
      return {
        id,
        qty: Number.isFinite(qty) && qty > 0 ? Math.min(99, Math.round(qty)) : 1,
        note: typeof rec.note === "string" ? rec.note.slice(0, 80) : "",
      };
    })
    .filter((row) => row.id);
}

export function loadWaiterList(): WaiterLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WAITER_LIST_STORAGE_KEY);
    if (!raw) return [];
    return parseWaiterLines(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveWaiterList(lines: WaiterLine[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WAITER_LIST_STORAGE_KEY, JSON.stringify(lines));
    notifyWaiterDriverChange();
  } catch {
    /* ignore quota */
  }
}

export function loadDriverJobs(): DriverJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DRIVER_JOBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => row && typeof row === "object")
      .map((row) => {
        const rec = row as Record<string, unknown>;
        const id = String(rec.id ?? "");
        const createdAt = Number(rec.createdAt);
        const status = rec.status === "done" ? "done" : "open";
        const waiter =
          typeof rec.waiter === "string" && rec.waiter.trim()
            ? rec.waiter.trim().slice(0, 40)
            : "Офіціант";
        return {
          id,
          createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
          waiter,
          status,
          lines: parseWaiterLines(rec.lines),
        } satisfies DriverJob;
      })
      .filter((row) => row.id && row.lines.length > 0);
  } catch {
    return [];
  }
}

function writeDriverJobs(jobs: DriverJob[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRIVER_JOBS_STORAGE_KEY, JSON.stringify(jobs));
    notifyWaiterDriverChange();
  } catch {
    /* ignore quota */
  }
}

/** Snapshot the current waiter draft into the driver inbox and clear the draft. */
export function sendWaiterListToDriver(
  lines: WaiterLine[],
  waiter = "Офіціант",
): DriverJob | null {
  const clean = parseWaiterLines(lines);
  if (!clean.length) return null;
  const job: DriverJob = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    waiter: waiter.slice(0, 40),
    status: "open",
    lines: clean,
  };
  const next = [job, ...loadDriverJobs()].slice(0, 40);
  writeDriverJobs(next);
  saveWaiterList([]);
  return job;
}

/**
 * Driver finished the run: clear the live waiter draft and mark open jobs done
 * so the shopping list empties on this phone.
 */
export function completeDriverShopping(): void {
  const jobs = loadDriverJobs().map((job) =>
    job.status === "open" ? { ...job, status: "done" as const } : job,
  );
  writeDriverJobs(jobs.slice(0, 40));
  saveWaiterList([]);
}

/** Merge live waiter draft + open jobs into one pick list (sum qty, keep notes). */
export function buildDriverPickList(
  live: WaiterLine[],
  jobs: DriverJob[],
): WaiterLine[] {
  const map = new Map<string, WaiterLine>();
  const push = (line: WaiterLine) => {
    const hit = map.get(line.id);
    if (!hit) {
      map.set(line.id, { ...line });
      return;
    }
    hit.qty = Math.min(99, hit.qty + line.qty);
    if (line.note && !hit.note.includes(line.note)) {
      hit.note = hit.note ? `${hit.note}; ${line.note}` : line.note;
    }
  };
  for (const job of jobs) {
    if (job.status === "done") continue;
    for (const line of job.lines) push(line);
  }
  for (const line of live) push(line);
  return [...map.values()];
}

export function notifyWaiterDriverChange(): void {
  if (typeof window === "undefined") return;
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ kind: "waiter-driver", at: Date.now() });
    ch.close();
  } catch {
    /* BroadcastChannel missing — storage/focus listeners still help */
  }
  try {
    window.dispatchEvent(new Event("royal-sass-waiter-driver"));
  } catch {
    /* ignore */
  }
}

/** Live updates across tabs/windows on this browser. */
export function subscribeWaiterDriver(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const run = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === WAITER_LIST_STORAGE_KEY ||
      e.key === DRIVER_JOBS_STORAGE_KEY ||
      e.key === null
    ) {
      run();
    }
  };
  const onFocus = () => run();
  const onVis = () => {
    if (document.visibilityState === "visible") run();
  };
  const onLocal = () => run();

  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("royal-sass-waiter-driver", onLocal);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => run();
  } catch {
    channel = null;
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("royal-sass-waiter-driver", onLocal);
    channel?.close();
  };
}

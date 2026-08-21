/**
 * Waiter → driver product lists.
 * Send stamps a catalog compare (no rematch). Driver only toggles stores
 * and sees ready purchase plans from those line costs.
 */
import {
  COMPARE_STORE_IDS,
} from "@/domain/compare-stores";
import type { PlanLine } from "@/domain/purchase-plans";
import { roundMoney } from "@/domain/purchase-units";

export const WAITER_TICKETS_KIND = "royal-sass-waiter-tickets-v1";
export const MAX_WAITER_TICKETS = 40;
export const MAX_WAITER_LINES = 80;

export type WaiterTicketLine = {
  id: string;
  label: string;
  qty: number;
  note: string;
};

export type WaiterTicketStatus = "new" | "open" | "done";

export type WaiterCompareSnapshot = {
  comparedAt: string;
  lines: PlanLine[];
};

export type WaiterTicket = {
  id: string;
  waiterClientId: string;
  waiter: string;
  station: string;
  createdAt: string;
  updatedAt: string;
  status: WaiterTicketStatus;
  lines: WaiterTicketLine[];
  compare?: WaiterCompareSnapshot;
};

export type WaiterPickRow = {
  id: string;
  label: string;
  qty: number;
};

const STAPLE_ID = /^[a-z0-9_-]{1,80}$/i;
const CLIENT_ID = /^[a-z0-9-]{8,80}$/i;
const TICKET_ID = /^t_[a-z0-9_-]{4,80}$/i;
const STATUSES = new Set<WaiterTicketStatus>(["new", "open", "done"]);

function clip(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function parseWaiterTicketLine(raw: unknown): WaiterTicketLine | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = clip(rec.id, 80);
  if (!STAPLE_ID.test(id)) return null;
  const qty = Number(rec.qty);
  if (!Number.isFinite(qty) || qty < 1) return null;
  const label = clip(rec.label, 80) || id.replace(/_/g, " ");
  const note = clip(rec.note, 80);
  return {
    id,
    label,
    qty: Math.min(99, Math.round(qty)),
    note,
  };
}

export function parseWaiterTicketLines(raw: unknown): WaiterTicketLine[] {
  if (!Array.isArray(raw)) return [];
  const out: WaiterTicketLine[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const line = parseWaiterTicketLine(row);
    if (!line || seen.has(line.id)) continue;
    seen.add(line.id);
    out.push(line);
    if (out.length >= MAX_WAITER_LINES) break;
  }
  return out;
}

function newTicketId(now = Date.now()): string {
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `t_${now.toString(36)}_${rand}`;
}

function parsePlanCost(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? roundMoney(n) : null;
}

export function parseWaiterPlanLine(raw: unknown): PlanLine | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = clip(rec.id, 80);
  if (!STAPLE_ID.test(id)) return null;
  const costsRaw =
    rec.costs && typeof rec.costs === "object" && !Array.isArray(rec.costs)
      ? (rec.costs as Record<string, unknown>)
      : rec;
  const costs: PlanLine["costs"] = {};
  for (const store of COMPARE_STORE_IDS) {
    const n = parsePlanCost(costsRaw[store]);
    if (n != null) costs[store] = n;
  }
  return {
    id,
    label: clip(rec.label, 80) || id.replace(/_/g, " "),
    costs,
  };
}

export function parseWaiterCompare(raw: unknown): WaiterCompareSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const rows = Array.isArray(rec.lines) ? rec.lines : [];
  const lines: PlanLine[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const line = parseWaiterPlanLine(row);
    if (!line || seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
  }
  if (!lines.length) return null;
  const comparedAt =
    typeof rec.comparedAt === "string" && Number.isFinite(Date.parse(rec.comparedAt))
      ? rec.comparedAt
      : new Date().toISOString();
  return { comparedAt, lines };
}

function addPlanCost(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  const x = a != null && a > 0 ? a : null;
  const y = b != null && b > 0 ? b : null;
  if (x == null && y == null) return null;
  return roundMoney((x ?? 0) + (y ?? 0));
}

/** Open tickets — sum catalog checkout costs by staple id. Missing ≠ $0. */
export function combineWaiterPlanLines(tickets: WaiterTicket[]): PlanLine[] {
  const map = new Map<string, PlanLine>();
  for (const ticket of tickets) {
    if (ticket.status === "done") continue;
    if (ticket.compare) {
      for (const line of ticket.compare.lines) {
        const prev = map.get(line.id);
        if (!prev) {
          map.set(line.id, {
            id: line.id,
            label: line.label,
            costs: { ...line.costs },
          });
          continue;
        }
        const costs: PlanLine["costs"] = { ...prev.costs };
        for (const store of COMPARE_STORE_IDS) {
          const n = addPlanCost(prev.costs[store], line.costs[store]);
          if (n != null) costs[store] = n;
          else delete costs[store];
        }
        map.set(line.id, { ...prev, costs });
      }
    }
    for (const line of ticket.lines) {
      if (map.has(line.id)) continue;
      map.set(line.id, { id: line.id, label: line.label, costs: {} });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "uk"),
  );
}

export function parseWaiterTicket(raw: unknown): WaiterTicket | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const lines = parseWaiterTicketLines(rec.lines);
  if (!lines.length) return null;
  const waiterClientId = clip(rec.waiterClientId, 80).toLowerCase();
  if (!CLIENT_ID.test(waiterClientId)) return null;
  const idRaw = clip(rec.id, 80);
  const id = TICKET_ID.test(idRaw) ? idRaw : newTicketId();
  const statusRaw = clip(rec.status, 12);
  const status: WaiterTicketStatus = STATUSES.has(statusRaw as WaiterTicketStatus)
    ? (statusRaw as WaiterTicketStatus)
    : "new";
  const createdAt =
    typeof rec.createdAt === "string" && Number.isFinite(Date.parse(rec.createdAt))
      ? rec.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof rec.updatedAt === "string" && Number.isFinite(Date.parse(rec.updatedAt))
      ? rec.updatedAt
      : createdAt;
  const compare = parseWaiterCompare(rec.compare);
  return {
    id,
    waiterClientId,
    waiter: clip(rec.waiter, 40) || "Офіціант",
    station: clip(rec.station, 40) || "Зал",
    createdAt,
    updatedAt,
    status,
    lines,
    ...(compare ? { compare } : {}),
  };
}

export function parseWaiterTickets(raw: unknown): WaiterTicket[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).tickets
      : null;
  if (!Array.isArray(rows)) return [];
  const byId = new Map<string, WaiterTicket>();
  for (const row of rows) {
    const ticket = parseWaiterTicket(row);
    if (!ticket) continue;
    const prev = byId.get(ticket.id);
    if (!prev || Date.parse(ticket.updatedAt) >= Date.parse(prev.updatedAt)) {
      byId.set(ticket.id, ticket);
    }
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_WAITER_TICKETS);
}

export type WaiterTicketDraft = {
  waiterClientId: string;
  waiter?: string;
  station?: string;
  lines: unknown;
  compare?: unknown;
};

/** Replace the waiter's open ticket, or append a new one. */
export function upsertWaiterTicket(
  existing: WaiterTicket[],
  draft: WaiterTicketDraft,
  nowIso = new Date().toISOString(),
): { tickets: WaiterTicket[]; ticket: WaiterTicket } | null {
  const lines = parseWaiterTicketLines(draft.lines);
  if (!lines.length) return null;
  const waiterClientId = clip(draft.waiterClientId, 80).toLowerCase();
  if (!CLIENT_ID.test(waiterClientId)) return null;
  const waiter = clip(draft.waiter, 40) || "Офіціант";
  const station = clip(draft.station, 40) || "Зал";
  const current = parseWaiterTickets(existing);
  const match = current.find(
    (row) => row.waiterClientId === waiterClientId && row.status !== "done",
  );
  const compare = parseWaiterCompare(draft.compare);
  const ticket: WaiterTicket = match
    ? {
        id: match.id,
        waiterClientId: match.waiterClientId,
        createdAt: match.createdAt,
        waiter,
        station,
        lines,
        updatedAt: nowIso,
        status: "new",
        ...(compare ? { compare } : {}),
      }
    : {
        id: newTicketId(Date.parse(nowIso) || Date.now()),
        waiterClientId,
        waiter,
        station,
        createdAt: nowIso,
        updatedAt: nowIso,
        status: "new",
        lines,
        ...(compare ? { compare } : {}),
      };
  const tickets = [ticket, ...current.filter((row) => row.id !== ticket.id)].slice(
    0,
    MAX_WAITER_TICKETS,
  );
  return { tickets, ticket };
}

export function mergeWaiterTicketLists(
  ...lists: WaiterTicket[][]
): WaiterTicket[] {
  return parseWaiterTickets(lists.flat());
}

/** Open tickets only — sum qty by cafe staple id. */
export function combineWaiterPickList(tickets: WaiterTicket[]): WaiterPickRow[] {
  const map = new Map<string, WaiterPickRow>();
  for (const ticket of tickets) {
    if (ticket.status === "done") continue;
    for (const line of ticket.lines) {
      const prev = map.get(line.id);
      if (prev) {
        prev.qty += line.qty;
      } else {
        map.set(line.id, { id: line.id, label: line.label, qty: line.qty });
      }
    }
  }
  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "uk"),
  );
}

export function formatTicketWhen(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const delta = now - t;
  if (delta < 45_000) return "щойно";
  if (delta < 3_600_000) {
    const minutes = Math.max(1, Math.round(delta / 60_000));
    return `${minutes} хв тому`;
  }
  try {
    return new Date(t).toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(11, 16);
  }
}

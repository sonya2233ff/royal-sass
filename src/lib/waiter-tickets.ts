/**
 * Client store for waiter drafts / driver inbox.
 * Server disk is best-effort; this phone always keeps sent tickets.
 */
import {
  mergeWaiterTicketLists,
  parseWaiterTickets,
  type WaiterTicket,
} from "@/domain/waiter-tickets";

export const WAITER_CLIENT_ID_KEY = "royal-sass-waiter-client-id-v1";
export const WAITER_NAME_KEY = "royal-sass-waiter-name-v1";
export const DRIVER_INBOX_STORAGE_KEY = "royal-sass-driver-inbox-v1";
export const WAITER_TICKETS_CHANNEL = "royal-sass-waiter-tickets";

function randomClientId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function readWaiterClientId(): string {
  try {
    const existing = window.localStorage.getItem(WAITER_CLIENT_ID_KEY)?.trim() ?? "";
    if (/^[a-z0-9-]{8,80}$/i.test(existing)) return existing.toLowerCase();
    const id = randomClientId().toLowerCase();
    window.localStorage.setItem(WAITER_CLIENT_ID_KEY, id);
    return id;
  } catch {
    return "local-waiter";
  }
}

export function readWaiterName(): string {
  try {
    return (window.localStorage.getItem(WAITER_NAME_KEY) ?? "").trim().slice(0, 40);
  } catch {
    return "";
  }
}

export function writeWaiterName(name: string): string {
  const next = name.replace(/\s+/g, " ").trim().slice(0, 40);
  try {
    window.localStorage.setItem(WAITER_NAME_KEY, next);
  } catch {
    /* ignore quota */
  }
  return next;
}

export function readDriverInbox(): WaiterTicket[] {
  try {
    const raw = window.localStorage.getItem(DRIVER_INBOX_STORAGE_KEY);
    if (!raw) return [];
    return parseWaiterTickets(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeDriverInbox(tickets: Iterable<WaiterTicket>): WaiterTicket[] {
  const next = parseWaiterTickets([...tickets]);
  try {
    window.localStorage.setItem(DRIVER_INBOX_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function upsertDriverInbox(ticket: WaiterTicket): WaiterTicket[] {
  return writeDriverInbox(mergeWaiterTicketLists(readDriverInbox(), [ticket]));
}

export function notifyWaiterTicket(ticket: WaiterTicket): void {
  try {
    const ch = new BroadcastChannel(WAITER_TICKETS_CHANNEL);
    ch.postMessage({ kind: WAITER_TICKETS_CHANNEL, ticket });
    ch.close();
  } catch {
    /* ignore */
  }
}

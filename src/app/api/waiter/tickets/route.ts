import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  parseWaiterTickets,
  upsertWaiterTicket,
  type WaiterTicket,
} from "@/domain/waiter-tickets";
import { compareWaiterLines } from "@/lib/waiter-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FILE = path.join(process.cwd(), "data", "catalog", "waiter-tickets.json");

let memoryTickets: WaiterTicket[] = [];

async function loadTickets(): Promise<{ tickets: WaiterTicket[]; persisted: boolean }> {
  try {
    const raw = await readFile(FILE, "utf8");
    const tickets = parseWaiterTickets(JSON.parse(raw) as unknown);
    memoryTickets = tickets;
    return { tickets, persisted: true };
  } catch {
    return { tickets: memoryTickets, persisted: false };
  }
}

async function saveTickets(tickets: WaiterTicket[]): Promise<boolean> {
  memoryTickets = tickets;
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(
      FILE,
      `${JSON.stringify(
        {
          kind: "royal-sass-waiter-tickets-v1",
          updatedAt: new Date().toISOString(),
          tickets,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const { tickets, persisted } = await loadTickets();
  return NextResponse.json({ ok: true, persisted, tickets });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    waiterClientId?: unknown;
    waiter?: unknown;
    station?: unknown;
    lines?: unknown;
    customStaples?: unknown;
    productOverrides?: unknown;
  };
  const loaded = await loadTickets();
  const result = upsertWaiterTicket(loaded.tickets, {
    waiterClientId: String(body.waiterClientId ?? ""),
    waiter: typeof body.waiter === "string" ? body.waiter : undefined,
    station: typeof body.station === "string" ? body.station : undefined,
    lines: body.lines,
  });
  if (!result) {
    return NextResponse.json(
      { ok: false, error: "list required" },
      { status: 400 },
    );
  }

  let ticket: WaiterTicket = result.ticket;
  try {
    const compare = await compareWaiterLines(
      ticket.lines,
      body.customStaples,
      body.productOverrides,
    );
    if (compare) ticket = { ...ticket, compare };
  } catch {
    /* catalog compare is best-effort; still send the product list */
  }
  const tickets = result.tickets.map((row) =>
    row.id === ticket.id ? ticket : row,
  );
  const persisted = await saveTickets(tickets);
  return NextResponse.json({
    ok: true,
    persisted,
    ticket,
    tickets,
  });
}

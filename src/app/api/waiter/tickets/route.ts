import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  parseWaiterTickets,
  upsertWaiterTicket,
  type WaiterTicket,
} from "@/domain/waiter-tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const persisted = await saveTickets(result.tickets);
  return NextResponse.json({
    ok: true,
    persisted,
    ticket: result.ticket,
    tickets: result.tickets,
  });
}

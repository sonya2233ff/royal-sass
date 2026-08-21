/**
 * Waiter → driver ticket parse / upsert / combined pick list.
 *   npx tsx src/poc/waiter-tickets-self-check.ts
 */
import {
  combineWaiterPickList,
  formatTicketWhen,
  mergeWaiterTicketLists,
  parseWaiterTicket,
  parseWaiterTicketLines,
  parseWaiterTickets,
  upsertWaiterTicket,
} from "@/domain/waiter-tickets";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function main() {
  assert(parseWaiterTicketLines(null).length === 0, "null lines");
  assert(
    parseWaiterTicketLines([{ id: "ab", qty: 1, label: "Ab" }]).length === 1,
    "2-char id ok",
  );

  assert(
    parseWaiterTicketLines([{ id: "Ice Breakers!!", qty: 1 }]).length === 0,
    "reject junk id",
  );
  assert(
    parseWaiterTicketLines([{ id: "large_eggs_dozen", qty: 0 }]).length === 0,
    "qty 0 dropped",
  );

  const eggs = parseWaiterTicketLines([
    { id: "large_eggs_dozen", qty: 24, note: "на випічку" },
    { id: "large_eggs_dozen", qty: 12 },
    { id: "tomatoes_grape", qty: 2, label: "Grape tomatoes" },
    { id: "custom_zyzzx_whip", qty: 1 },
  ]);
  assert(eggs.length === 3, "dedupe by id");
  assert(eggs[0]?.qty === 24, "first egg qty kept");
  assert(eggs[0]?.note === "на випічку", "note kept");

  const bad = upsertWaiterTicket([], {
    waiterClientId: "no",
    lines: [{ id: "milk_2pct_2l", qty: 1 }],
  });
  assert(bad === null, "short client id rejected");

  const empty = upsertWaiterTicket([], {
    waiterClientId: "waiter-phone-1",
    lines: [],
  });
  assert(empty === null, "empty list rejected");

  const first = upsertWaiterTicket([], {
    waiterClientId: "waiter-phone-1",
    waiter: "Марія",
    lines: [
      { id: "large_eggs_dozen", qty: 12, label: "Large eggs" },
      { id: "ice_cubes", qty: 2, label: "Ice" },
    ],
  });
  assert(first?.ticket.lines.length === 2, "two lines");
  assert(first?.ticket.status === "new", "new ticket");
  assert(first?.ticket.waiter === "Марія", first?.ticket.waiter);

  const again = upsertWaiterTicket(first!.tickets, {
    waiterClientId: "waiter-phone-1",
    waiter: "Марія",
    lines: [{ id: "butter_454g", qty: 3, label: "Butter" }],
  });
  assert(again?.tickets.length === 1, "same waiter replaces open ticket");
  assert(again?.ticket.id === first?.ticket.id, "id stable");
  assert(again?.ticket.lines.length === 1, "lines replaced not appended");
  assert(again?.ticket.lines[0]?.id === "butter_454g", "latest lines win");

  const other = upsertWaiterTicket(again!.tickets, {
    waiterClientId: "waiter-phone-2",
    waiter: "Олег",
    lines: [{ id: "butter_454g", qty: 1, label: "Butter" }],
  });
  assert(other?.tickets.length === 2, "second waiter is a new ticket");

  const combined = combineWaiterPickList(other!.tickets);
  const butter = combined.find((row) => row.id === "butter_454g");
  assert(butter?.qty === 4, `butter qty ${butter?.qty} (3+1)`);

  const done = parseWaiterTicket({
    ...other!.tickets.find((t) => t.waiterClientId === "waiter-phone-2"),
    status: "done",
  });
  assert(done?.status === "done", "done parses");
  const combinedOpen = combineWaiterPickList(
    other!.tickets.map((t) =>
      t.waiterClientId === "waiter-phone-2" ? done! : t,
    ),
  );
  assert(
    combinedOpen.find((row) => row.id === "butter_454g")?.qty === 3,
    "done ticket excluded from pick list",
  );

  const merged = mergeWaiterTicketLists(
    again!.tickets,
    other!.tickets,
    [
      {
        ...again!.ticket,
        updatedAt: "2099-01-01T00:00:00.000Z",
        lines: [{ id: "ice_cubes", qty: 9, label: "Ice", note: "" }],
      },
    ],
  );
  const ice = merged.find((t) => t.id === again!.ticket.id);
  assert(ice?.lines[0]?.qty === 9, "newer updatedAt wins merge");

  assert(parseWaiterTickets({ tickets: [null, { id: "x" }] }).length === 0);
  assert(
    formatTicketWhen(new Date().toISOString(), Date.now()) === "щойно",
    "just now",
  );

  console.log("waiter-tickets-self-check: ok");
}

main();

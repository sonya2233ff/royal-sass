"use client";

import { useEffect, useMemo, useState } from "react";
import { WAITER_LIST_STORAGE_KEY } from "@/lib/product-config";

type CatalogItem = {
  id: string;
  label: string;
  image?: string | null;
};

type Line = {
  id: string;
  qty: number;
  note?: string;
};

type TicketStatus = "new" | "open" | "done";

type Ticket = {
  id: string;
  waiter: string;
  station: string;
  when: string;
  status: TicketStatus;
  localDraft?: boolean;
  lines: Line[];
};

const STATUS_UA: Record<TicketStatus, string> = {
  new: "Нове",
  open: "Відкрите",
  done: "Переглянуто",
};

const MOCK_TICKETS: Ticket[] = [
  {
    id: "t-maria",
    waiter: "Марія",
    station: "Зал",
    when: "щойно",
    status: "new",
    lines: [
      { id: "large_eggs_dozen", qty: 24, note: "на випічку" },
      { id: "simply_egg_whites", qty: 2, note: "1 кг" },
      { id: "tomatoes_grape", qty: 2 },
      { id: "lemons_2lb", qty: 1 },
    ],
  },
  {
    id: "t-oleg",
    waiter: "Олег",
    station: "Каса",
    when: "12 хв тому",
    status: "open",
    lines: [
      { id: "milk_2pct_2l", qty: 3 },
      { id: "homo_milk_2l", qty: 2 },
      { id: "butter_454g", qty: 2, note: "несолоне" },
      { id: "orange_juice_pulp", qty: 1 },
    ],
  },
  {
    id: "t-sofia",
    waiter: "Софія",
    station: "Ранкова зміна",
    when: "сьогодні, 08:40",
    status: "done",
    lines: [
      { id: "ice_cubes", qty: 4 },
      { id: "ziploc_sandwich", qty: 1 },
      { id: "strawberries", qty: 2 },
    ],
  },
];

function readLocalWaiterDraft(): Line[] {
  try {
    const raw = window.localStorage.getItem(WAITER_LIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
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
  } catch {
    return [];
  }
}

function ukLineCount(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} позиція`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} позиції`;
  return `${n} позицій`;
}

export function DriverPortal() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<"all" | TicketStatus>("all");
  const [openId, setOpenId] = useState<string | null>(MOCK_TICKETS[0]?.id ?? null);
  const [localLines, setLocalLines] = useState<Line[]>([]);

  useEffect(() => {
    setLocalLines(readLocalWaiterDraft());
    fetch("/api/staples")
      .then(async (res) => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; items?: CatalogItem[] };
        if (data.ok && Array.isArray(data.items)) setCatalog(data.items);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const byId = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );

  const tickets = useMemo(() => {
    const extra: Ticket[] =
      localLines.length > 0
        ? [
            {
              id: "t-local",
              waiter: "Цей телефон",
              station: "Чернетка офіціанта",
              when: "локально",
              status: "new",
              localDraft: true,
              lines: localLines,
            },
          ]
        : [];
    return [...extra, ...MOCK_TICKETS];
  }, [localLines]);

  const shown = tickets.filter(
    (ticket) => filter === "all" || ticket.status === filter,
  );

  const combined = useMemo(() => {
    const map = new Map<string, number>();
    for (const ticket of tickets) {
      if (ticket.status === "done") continue;
      for (const line of ticket.lines) {
        map.set(line.id, (map.get(line.id) ?? 0) + line.qty);
      }
    }
    return [...map.entries()].map(([id, qty]) => ({ id, qty }));
  }, [tickets]);

  function labelOf(id: string): string {
    return byId.get(id)?.label ?? id.replace(/_/g, " ");
  }

  return (
    <div className="portal">
      <header className="hero">
        <p className="kicker">Портал водія</p>
        <h1>Списки від офіціантів</h1>
        <p className="lede">
          Тут будуть приходити замовлення з залу. Зараз це лише вигляд списків —
          прийняття, «в дорозі» і зв’язок з офіціантом ще не працюють.
        </p>
      </header>

      <section className="summary" aria-label="Зведення">
        <div>
          <b>{tickets.filter((t) => t.status !== "done").length}</b>
          <span>активні списки</span>
        </div>
        <div>
          <b>{ukLineCount(combined.length)}</b>
          <span>у зведеному списку</span>
        </div>
        <div>
          <b>{combined.reduce((n, row) => n + row.qty, 0)}</b>
          <span>одиниць набрати</span>
        </div>
      </section>

      {combined.length > 0 && (
        <section className="combined" aria-label="Зведений список">
          <h2>Що набрати (макет)</h2>
          <ul>
            {combined.map((row) => {
              const item = byId.get(row.id);
              return (
                <li key={row.id}>
                  {item?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="ph" />
                  )}
                  <strong>{labelOf(row.id)}</strong>
                  <em>{row.qty}×</em>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="chips" role="tablist" aria-label="Фільтр списків">
        {(["all", "new", "open", "done"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "chip on" : "chip"}
            onClick={() => setFilter(key)}
          >
            {key === "all" ? "Усі" : STATUS_UA[key]}
          </button>
        ))}
      </div>

      {!ready && <p className="hint">Завантаження каталогу…</p>}

      <ul className="tickets">
        {shown.map((ticket) => {
          const open = openId === ticket.id;
          return (
            <li key={ticket.id} className={open ? "ticket open" : "ticket"}>
              <button
                type="button"
                className="ticket-head"
                onClick={() => setOpenId(open ? null : ticket.id)}
              >
                <span className="who">
                  <strong>{ticket.waiter}</strong>
                  <em>
                    {ticket.station} · {ticket.when}
                    {ticket.localDraft ? " · не відправлено" : ""}
                  </em>
                </span>
                <span className={`status ${ticket.status}`}>
                  {STATUS_UA[ticket.status]}
                </span>
                <span className="qty">{ukLineCount(ticket.lines.length)}</span>
              </button>
              {open && (
                <div className="body">
                  <ul className="lines">
                    {ticket.lines.map((line) => {
                      const item = byId.get(line.id);
                      return (
                        <li key={`${ticket.id}-${line.id}`}>
                          {item?.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image}
                              alt=""
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="ph" />
                          )}
                          <span>
                            <strong>
                              {line.qty}× {labelOf(line.id)}
                            </strong>
                            {line.note ? <i>{line.note}</i> : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled
                      title="Макет"
                    >
                      Написати офіціанту
                    </button>
                    <button
                      type="button"
                      className="send"
                      disabled
                      title="Макет"
                    >
                      Прийняти список
                    </button>
                  </div>
                  <p className="mockcap">Макет: прийняття і переписка ще не працюють.</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="hint">Немає списків у цьому фільтрі.</p>
      )}

      <style jsx>{`
        .portal {
          max-width: 820px;
          margin: 0 auto;
          padding: 1.2rem 1rem 4rem;
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
          color: #1e281e;
        }
        .hero h1 {
          margin: 0.15rem 0 0.4rem;
          font-size: 1.7rem;
          letter-spacing: -0.02em;
        }
        .kicker {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #2f4a3a;
        }
        .lede {
          margin: 0;
          opacity: 0.78;
          line-height: 1.4;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.55rem;
          margin: 1.15rem 0 1rem;
        }
        .summary div {
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.65rem 0.7rem;
        }
        .summary b {
          display: block;
          font-size: 1.15rem;
        }
        .summary span {
          font-size: 0.75rem;
          opacity: 0.7;
        }
        .combined {
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.85rem 0.85rem 0.7rem;
          margin-bottom: 1rem;
        }
        .combined h2 {
          margin: 0 0 0.55rem;
          font-size: 0.95rem;
        }
        .combined ul,
        .lines,
        .tickets {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .combined ul {
          display: grid;
          gap: 0.35rem;
        }
        .combined li,
        .lines li {
          display: grid;
          grid-template-columns: 2.4rem 1fr auto;
          gap: 0.55rem;
          align-items: center;
        }
        .lines li {
          grid-template-columns: 2.4rem 1fr;
          padding: 0.28rem 0;
          border-bottom: 1px solid rgba(40, 50, 40, 0.08);
        }
        img,
        .ph {
          width: 2.4rem;
          height: 2.4rem;
          object-fit: cover;
          background: #e9e4da;
          display: block;
        }
        .combined em {
          font-style: normal;
          font-weight: 700;
          color: #2f4a3a;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          margin: 0 0 0.85rem;
        }
        .chip,
        .ghost,
        .send,
        .ticket-head {
          font: inherit;
          cursor: pointer;
        }
        .chip {
          border: 1px solid rgba(47, 74, 58, 0.28);
          background: transparent;
          color: #3d4a40;
          font-size: 0.8rem;
          font-weight: 650;
          padding: 0.28rem 0.7rem;
          border-radius: 999px;
        }
        .chip.on {
          background: #2f4a3a;
          color: #f7f3ec;
          border-color: #2f4a3a;
        }
        .tickets {
          display: grid;
          gap: 0.55rem;
        }
        .ticket {
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
        }
        .ticket.open {
          border-color: #2f4a3a;
        }
        .ticket-head {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 0.55rem;
          align-items: center;
          text-align: left;
          border: 0;
          background: transparent;
          padding: 0.7rem 0.75rem;
          color: inherit;
        }
        .who strong {
          display: block;
        }
        .who em {
          display: block;
          font-style: normal;
          font-size: 0.78rem;
          opacity: 0.65;
          margin-top: 0.12rem;
        }
        .status {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.2rem 0.5rem;
          border-radius: 999px;
        }
        .status.new {
          background: #2f4a3a;
          color: #f7f3ec;
        }
        .status.open {
          background: #efe6d2;
          color: #4a3a20;
        }
        .status.done {
          background: #e7efe8;
          color: #3d4a40;
        }
        .qty {
          font-size: 0.78rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        .body {
          padding: 0 0.75rem 0.85rem;
        }
        .lines i {
          display: block;
          font-style: normal;
          font-size: 0.78rem;
          opacity: 0.65;
          margin-top: 0.1rem;
        }
        .actions {
          display: flex;
          gap: 0.45rem;
          margin-top: 0.75rem;
        }
        .ghost,
        .send {
          flex: 1;
          border-radius: 999px;
          padding: 0.58rem 0.7rem;
          font-weight: 700;
          font-size: 0.86rem;
        }
        .ghost {
          border: 1px solid rgba(47, 74, 58, 0.3);
          background: transparent;
          color: #3d4a40;
        }
        .ghost:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .send {
          border: 1px solid #2f4a3a;
          background: #2f4a3a;
          color: #f7f3ec;
        }
        .send:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .mockcap {
          margin: 0.45rem 0 0;
          font-size: 0.78rem;
          opacity: 0.7;
        }
        .hint,
        .soon {
          font-size: 0.9rem;
        }
        .soon {
          margin-top: 0.9rem;
          padding: 0.55rem 0.7rem;
          background: #efe6d2;
        }
        @media (max-width: 640px) {
          .summary {
            grid-template-columns: 1fr;
          }
          .ticket-head {
            grid-template-columns: 1fr auto;
          }
          .qty {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

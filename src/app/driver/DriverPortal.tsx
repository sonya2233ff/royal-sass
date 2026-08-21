"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  combineWaiterPickList,
  formatTicketWhen,
  mergeWaiterTicketLists,
  type WaiterTicket,
  type WaiterTicketStatus,
} from "@/domain/waiter-tickets";
import {
  DRIVER_INBOX_STORAGE_KEY,
  readDriverInbox,
  WAITER_TICKETS_CHANNEL,
  writeDriverInbox,
} from "@/lib/waiter-tickets";

type CatalogItem = {
  id: string;
  label: string;
  image?: string | null;
};

const STATUS_UA: Record<WaiterTicketStatus, string> = {
  new: "Нове",
  open: "Відкрите",
  done: "Переглянуто",
};

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
  const [filter, setFilter] = useState<"all" | WaiterTicketStatus>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<WaiterTicket[]>([]);
  const [persisted, setPersisted] = useState(true);

  const applyTickets = useCallback((incoming: WaiterTicket[]) => {
    const merged = mergeWaiterTicketLists(incoming, readDriverInbox());
    writeDriverInbox(merged);
    setTickets(merged);
    setOpenId((cur) => {
      if (cur && merged.some((row) => row.id === cur)) return cur;
      if (cur) return merged[0]?.id ?? null;
      return null;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/waiter/tickets");
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        persisted?: boolean;
        tickets?: WaiterTicket[];
      };
      if (res.ok && data.ok && Array.isArray(data.tickets)) {
        setPersisted(data.persisted !== false);
        applyTickets(data.tickets);
        return;
      }
    } catch {
      /* local inbox still applies */
    }
    applyTickets([]);
  }, [applyTickets]);

  useEffect(() => {
    applyTickets([]);
    fetch("/api/staples")
      .then(async (res) => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; items?: CatalogItem[] };
        if (data.ok && Array.isArray(data.items)) setCatalog(data.items);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
    void refresh();
    const tick = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(tick);
  }, [applyTickets, refresh]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === DRIVER_INBOX_STORAGE_KEY) applyTickets([]);
    }
    window.addEventListener("storage", onStorage);
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(WAITER_TICKETS_CHANNEL);
      ch.onmessage = (ev: MessageEvent) => {
        const ticket = (ev.data as { ticket?: WaiterTicket } | null)?.ticket;
        if (ticket) applyTickets([ticket]);
      };
    } catch {
      /* ignore */
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      ch?.close();
    };
  }, [applyTickets]);

  const byId = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );

  const shown = tickets.filter(
    (ticket) => filter === "all" || ticket.status === filter,
  );

  const combined = useMemo(() => combineWaiterPickList(tickets), [tickets]);

  function labelOf(id: string, fallback?: string): string {
    return byId.get(id)?.label ?? fallback ?? id.replace(/_/g, " ");
  }

  return (
    <div className="portal">
      <header className="hero">
        <p className="kicker">Портал водія</p>
        <h1>Списки від офіціантів</h1>
        <p className="lede">
          Продукти, які офіціант надіслав зі сторінки Офіціант. Прийняття,
          «в дорозі» і повідомлення офіціанту ще не працюють.
        </p>
      </header>

      {!persisted && tickets.length > 0 && (
        <p className="soon">
          Список з цього телефону. На Vercel інший телефон може не побачити
          його, доки немає спільного сховища.
        </p>
      )}

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
          <h2>Що набрати</h2>
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
                  <strong>{labelOf(row.id, row.label)}</strong>
                  <em>{row.qty}×</em>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="toolbar">
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
        <button type="button" className="ghost refresh" onClick={() => void refresh()}>
          Оновити списки
        </button>
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
                    {ticket.station} · {formatTicketWhen(ticket.updatedAt)}
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
                              {line.qty}× {labelOf(line.id, line.label)}
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
                      title="Ще не підключено"
                    >
                      Написати офіціанту
                    </button>
                    <button
                      type="button"
                      className="send"
                      disabled
                      title="Ще не підключено"
                    >
                      Прийняти список
                    </button>
                  </div>
                  <p className="mockcap">Прийняття і переписка ще не працюють.</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && ready && (
        <p className="hint">
          {tickets.length === 0
            ? "Ще немає списків. Офіціант додає продукти і натискає «Відправити водію»."
            : "Немає списків у цьому фільтрі."}
        </p>
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
        .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 0.55rem;
          justify-content: space-between;
          align-items: center;
          margin: 0 0 0.85rem;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
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
        .refresh {
          flex: 0 0 auto;
          padding: 0.32rem 0.75rem;
          font-size: 0.8rem;
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

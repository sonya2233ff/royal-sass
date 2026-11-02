"use client";

import { useMemo, useState } from "react";

type Store = "walmart" | "nofrills";

type Buy = {
  id: string;
  label: string;
  store: Store;
  qty: number;
  /** Total paid for this line (qty included). */
  paid: number;
  /** Saved on this line vs the other store (qty included). */
  saved: number;
};

type Day = {
  date: string; // YYYY-MM-DD
  buys: Buy[];
};

const STORE_UA: Record<Store, { short: string; name: string }> = {
  walmart: { short: "WM", name: "Walmart #5831" },
  nofrills: { short: "NF", name: "No Frills #3660" },
};

/**
 * Mock purchase history (same mock spirit as the waiter/driver portals).
 * Each day holds the lines a driver actually bought, which store won the line,
 * what was paid and how much was saved vs the other store.
 */
const ACTIVITY_DAYS: Day[] = [
  {
    date: "2026-11-02",
    buys: [
      { id: "large_eggs_dozen", label: "Large Eggs 12ct", store: "nofrills", qty: 2, paid: 11.98, saved: 1.4 },
      { id: "simply_egg_whites", label: "Naturegg Simply Egg Whites 1kg", store: "walmart", qty: 1, paid: 9.47, saved: 1.51 },
      { id: "tomatoes_grape", label: "Grape Tomatoes (pack)", store: "nofrills", qty: 2, paid: 7.98, saved: 0.8 },
      { id: "milk_2pct_2l", label: "Mehadrin 2% Milk 2L", store: "walmart", qty: 3, paid: 13.47, saved: 0.9 },
    ],
  },
  {
    date: "2026-11-01",
    buys: [
      { id: "butter_454g", label: "Gay Lea Unsalted Butter 454g", store: "nofrills", qty: 2, paid: 11.98, saved: 2.0 },
      { id: "orange_juice_pulp", label: "Tropicana OJ No Pulp 2.63L", store: "walmart", qty: 1, paid: 6.97, saved: 0.52 },
      { id: "lemons_2lb", label: "Lemons (bag ~2lb)", store: "nofrills", qty: 1, paid: 3.49, saved: 0.5 },
    ],
  },
  {
    date: "2026-10-30",
    buys: [
      { id: "homo_milk_2l", label: "Mehadrin Homo 3.25% Milk 2L", store: "walmart", qty: 2, paid: 9.94, saved: 0.6 },
      { id: "strawberries", label: "Strawberries 1lb", store: "nofrills", qty: 2, paid: 7.0, saved: 1.0 },
      { id: "ice_cubes", label: "Ice Cubes 2kg", store: "walmart", qty: 4, paid: 11.96, saved: 0.8 },
      { id: "ziploc_sandwich", label: "Ziploc Sandwich Bags", store: "nofrills", qty: 1, paid: 3.99, saved: 0.3 },
    ],
  },
  {
    date: "2026-10-28",
    buys: [
      { id: "large_eggs_dozen", label: "Large Eggs 12ct", store: "nofrills", qty: 4, paid: 23.96, saved: 2.8 },
      { id: "butter_454g", label: "Gay Lea Unsalted Butter 454g", store: "walmart", qty: 1, paid: 5.99, saved: 0.4 },
    ],
  },
];

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function ukProductCount(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} продукт`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} продукти`;
  return `${n} продуктів`;
}

const DATE_FMT = new Intl.DateTimeFormat("uk-UA", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const WEEKDAY_FMT = new Intl.DateTimeFormat("uk-UA", { weekday: "long" });

function formatDate(iso: string): { full: string; weekday: string } {
  const d = new Date(`${iso}T00:00:00`);
  return { full: DATE_FMT.format(d), weekday: WEEKDAY_FMT.format(d) };
}

type DaySummary = {
  spent: number;
  saved: number;
  count: number;
};

function summarize(day: Day): DaySummary {
  return day.buys.reduce<DaySummary>(
    (acc, buy) => ({
      spent: acc.spent + buy.paid,
      saved: acc.saved + buy.saved,
      count: acc.count + 1,
    }),
    { spent: 0, saved: 0, count: 0 },
  );
}

export function ActivityPortal() {
  const [openDate, setOpenDate] = useState<string | null>(null);

  const days = useMemo(
    () =>
      ACTIVITY_DAYS.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
    [],
  );

  const grand = useMemo(
    () =>
      days.reduce(
        (acc, day) => {
          const s = summarize(day);
          return {
            spent: acc.spent + s.spent,
            saved: acc.saved + s.saved,
            count: acc.count + s.count,
          };
        },
        { spent: 0, saved: 0, count: 0 },
      ),
    [days],
  );

  const openDay = openDate
    ? days.find((day) => day.date === openDate) ?? null
    : null;
  const openSummary = openDay ? summarize(openDay) : null;

  return (
    <div className="portal">
      <header className="hero">
        <p className="kicker">Activity</p>
        <h1>Історія покупок</h1>
        <p className="lede">
          Кожен день — окремий лист. Натисни на день, щоб відкрити чек: де
          куплено кожен продукт і скільки заощаджено.
        </p>
      </header>

      <section className="summary" aria-label="Загалом">
        <div>
          <b>{days.length}</b>
          <span>днів</span>
        </div>
        <div>
          <b>{money(grand.spent)}</b>
          <span>витрачено разом</span>
        </div>
        <div>
          <b className="pos">{money(grand.saved)}</b>
          <span>заощаджено разом</span>
        </div>
      </section>

      <ul className="days">
        {days.map((day) => {
          const s = summarize(day);
          const { full, weekday } = formatDate(day.date);
          return (
            <li key={day.date}>
              <button
                type="button"
                className="day"
                onClick={() => setOpenDate(day.date)}
                aria-label={`Відкрити чек за ${full}`}
              >
                <span className="when">
                  <strong>{full}</strong>
                  <em>{weekday}</em>
                </span>
                <span className="count">{ukProductCount(s.count)}</span>
                <span className="totals">
                  <b>{money(s.spent)}</b>
                  <em className="pos">− {money(s.saved)} заощ.</em>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {openDay && openSummary && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenDate(null);
          }}
        >
          <div className="sheet receipt">
            <div className="receipt-head">
              <h2 id="receipt-title">Чек</h2>
              <span>{formatDate(openDay.date).full}</span>
            </div>

            <ul className="rlines">
              {openDay.buys.map((buy) => (
                <li key={buy.id}>
                  <span className="rname">
                    <strong>{buy.label}</strong>
                    <em>
                      {buy.qty}× ·{" "}
                      <span className={`store ${buy.store}`}>
                        {STORE_UA[buy.store].short}
                      </span>{" "}
                      {STORE_UA[buy.store].name}
                    </em>
                  </span>
                  <span className="rnums">
                    <b>{money(buy.paid)}</b>
                    <em className="pos">− {money(buy.saved)}</em>
                  </span>
                </li>
              ))}
            </ul>

            <dl className="rtotals">
              <div>
                <dt>Разом витрачено</dt>
                <dd>{money(openSummary.spent)}</dd>
              </div>
              <div>
                <dt>Разом заощаджено</dt>
                <dd className="pos">{money(openSummary.saved)}</dd>
              </div>
              <div>
                <dt>Позицій</dt>
                <dd>{openSummary.count}</dd>
              </div>
            </dl>

            <div className="actions">
              <button
                type="button"
                className="send"
                onClick={() => setOpenDate(null)}
              >
                Закрити
              </button>
            </div>
          </div>
        </div>
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
          max-width: 40rem;
          opacity: 0.78;
          line-height: 1.4;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.55rem;
          margin: 1.15rem 0 1.1rem;
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
        .pos {
          color: #2f6a3a;
        }
        .days {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.55rem;
        }
        .day {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 0.75rem;
          align-items: center;
          text-align: left;
          font: inherit;
          cursor: pointer;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.7rem 0.85rem;
          color: inherit;
        }
        .day:hover {
          border-color: #2f4a3a;
        }
        .when strong {
          display: block;
          font-size: 0.98rem;
        }
        .when em {
          display: block;
          font-style: normal;
          font-size: 0.76rem;
          opacity: 0.6;
          margin-top: 0.1rem;
          text-transform: capitalize;
        }
        .count {
          font-size: 0.82rem;
          opacity: 0.75;
          white-space: nowrap;
        }
        .totals {
          text-align: right;
          white-space: nowrap;
        }
        .totals b {
          display: block;
          font-size: 1.02rem;
        }
        .totals em {
          display: block;
          font-style: normal;
          font-size: 0.74rem;
          margin-top: 0.1rem;
        }
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(20, 24, 20, 0.42);
          display: grid;
          place-items: end center;
        }
        .sheet {
          width: min(30rem, 100%);
          background: #f7f3ec;
          padding: 1.1rem 1rem 1.3rem;
          border-top: 1px solid rgba(40, 50, 40, 0.14);
          max-height: 88vh;
          overflow: auto;
        }
        .receipt-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 0.5rem;
          border-bottom: 1px dashed rgba(40, 50, 40, 0.3);
          padding-bottom: 0.6rem;
        }
        .receipt-head h2 {
          margin: 0;
          font-size: 1.2rem;
        }
        .receipt-head span {
          font-size: 0.85rem;
          opacity: 0.7;
        }
        .rlines {
          list-style: none;
          margin: 0.6rem 0 0;
          padding: 0;
          display: grid;
          gap: 0.5rem;
        }
        .rlines li {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.6rem;
          align-items: start;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(40, 50, 40, 0.08);
        }
        .rname strong {
          display: block;
          font-size: 0.9rem;
          line-height: 1.25;
        }
        .rname em {
          display: block;
          font-style: normal;
          font-size: 0.76rem;
          opacity: 0.72;
          margin-top: 0.12rem;
        }
        .store {
          display: inline-block;
          font-weight: 700;
          font-size: 0.68rem;
          letter-spacing: 0.03em;
          padding: 0.05rem 0.35rem;
          border-radius: 999px;
          color: #f7f3ec;
          opacity: 1;
        }
        .store.walmart {
          background: #2f4a3a;
        }
        .store.nofrills {
          background: #8a5a1f;
        }
        .rnums {
          text-align: right;
          white-space: nowrap;
        }
        .rnums b {
          display: block;
          font-size: 0.95rem;
        }
        .rnums em {
          display: block;
          font-style: normal;
          font-size: 0.76rem;
          margin-top: 0.1rem;
        }
        .rtotals {
          margin: 0.8rem 0 0;
          display: grid;
          gap: 0.3rem;
        }
        .rtotals div {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .rtotals dt {
          opacity: 0.78;
          font-size: 0.9rem;
        }
        .rtotals dd {
          margin: 0;
          font-weight: 700;
          font-size: 0.95rem;
        }
        .actions {
          display: flex;
          gap: 0.45rem;
          margin-top: 1rem;
        }
        .send {
          flex: 1;
          font: inherit;
          cursor: pointer;
          border-radius: 999px;
          padding: 0.62rem 0.7rem;
          font-weight: 700;
          font-size: 0.9rem;
          border: 1px solid #2f4a3a;
          background: #2f4a3a;
          color: #f7f3ec;
        }
        @media (max-width: 640px) {
          .summary {
            grid-template-columns: 1fr;
          }
          .day {
            grid-template-columns: 1fr auto;
          }
          .count {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

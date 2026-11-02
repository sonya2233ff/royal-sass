"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ACTIVITY_DAYS,
  formatDate,
  money,
  summarize,
  ukProductCount,
} from "./data";

export function ActivityPortal() {
  const days = useMemo(
    () => ACTIVITY_DAYS.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
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

  return (
    <div className="portal">
      <header className="hero">
        <p className="kicker">Activity</p>
        <h1>Історія покупок</h1>
        <p className="lede">
          Кожен день — окремий лист. Натисни на день, щоб відкрити деталі: де
          куплено кожен продукт, скільки заощаджено, і фото чека від водія.
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
              <Link
                href={`/activity/${day.date}`}
                className="day"
                aria-label={`Відкрити деталі за ${full}`}
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
                <span className="chev" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

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
        :global(.days a.day) {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto auto auto;
          gap: 0.75rem;
          align-items: center;
          text-align: left;
          text-decoration: none;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.7rem 0.85rem;
          color: inherit;
        }
        :global(.days a.day:hover) {
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
        .chev {
          font-size: 1.4rem;
          line-height: 1;
          color: #2f4a3a;
          opacity: 0.6;
        }
        @media (max-width: 640px) {
          .summary {
            grid-template-columns: 1fr;
          }
          :global(.days a.day) {
            grid-template-columns: 1fr auto auto;
          }
          .count {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  clearLiveActivity,
  listActivityDays,
  subscribeActivity,
} from "@/lib/activity-log";
import {
  formatDate,
  formatEconomy,
  money,
  summarize,
  ukProductCount,
  type Day,
} from "./data";

export function ActivityPortal() {
  const [days, setDays] = useState<Day[]>([]);

  useEffect(() => {
    const refresh = () => setDays(listActivityDays());
    refresh();
    return subscribeActivity(refresh);
  }, []);

  function clearAll() {
    if (
      !window.confirm(
        "Очистити всю історію Activity на цьому телефоні (включно з сьогодні)?",
      )
    ) {
      return;
    }
    clearLiveActivity();
    setDays(listActivityDays());
  }

  const grand = useMemo(() => {
    const acc = days.reduce(
      (sum, day) => {
        const s = summarize(day);
        return {
          spent: sum.spent + s.spent,
          saved: sum.saved + s.saved,
          expensive:
            sum.expensive + (day.expensiveTotal ?? s.spent + s.saved),
          count: sum.count + s.count,
        };
      },
      { spent: 0, saved: 0, expensive: 0, count: 0 },
    );
    return {
      ...acc,
      savedPercent:
        acc.expensive > 0 ? (acc.saved / acc.expensive) * 100 : 0,
    };
  }, [days]);

  return (
    <div className="portal">
      <header className="hero">
        <p className="kicker">Activity</p>
        <h1>Історія покупок</h1>
        <p className="lede">
          Кожен день — окремий лист. Після «Здати закупівлю» у розділі Водій
          сюди падає сьогоднішній пробіг (на цьому телефоні). Натисни день —
          деталі по магазинах і чек.
        </p>
        {days.length > 0 && (
          <button type="button" className="clear-hist" onClick={clearAll}>
            Очистити історію (і сьогодні)
          </button>
        )}
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
          <b className="pos">
            {formatEconomy(grand.saved, grand.savedPercent)}
          </b>
          <span>заощаджено vs найдорожчий план</span>
        </div>
      </section>

      {days.length === 0 ? (
        <p className="empty">
          Поки порожньо. Відкрий{" "}
          <Link href="/driver">Водій</Link>, набери список і здай закупівлю.
        </p>
      ) : (
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
                    <em>
                      {weekday} · {day.driver}
                    </em>
                  </span>
                  <span className="count">{ukProductCount(s.count)}</span>
                  <span className="totals">
                    <b>{money(s.spent)}</b>
                    <em className="pos">
                      {formatEconomy(s.saved, s.savedPercent)}
                    </em>
                  </span>
                  <span className="chev" aria-hidden>
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
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
        .clear-hist {
          margin-top: 0.75rem;
          font: inherit;
          cursor: pointer;
          border: 1px solid rgba(138, 31, 31, 0.45);
          background: #f8e4e0;
          color: #8a1f1f;
          border-radius: 999px;
          padding: 0.4rem 0.85rem;
          font-weight: 700;
          font-size: 0.82rem;
        }
        .empty {
          margin: 0.5rem 0 0;
          padding: 0.9rem 0.85rem;
          background: #fffdf8;
          border: 1px dashed rgba(40, 50, 40, 0.25);
          line-height: 1.45;
        }
        .empty :global(a) {
          color: #2f4a3a;
          font-weight: 700;
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

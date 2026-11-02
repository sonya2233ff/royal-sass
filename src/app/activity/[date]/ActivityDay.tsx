"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate, money, STORE_UA, summarize, type Day } from "../data";

export function ActivityDay({ day }: { day: Day }) {
  const [showReceipt, setShowReceipt] = useState(false);
  const { full, weekday } = formatDate(day.date);
  const s = summarize(day);

  return (
    <div className="portal">
      <Link href="/activity" className="back">
        ‹ Історія покупок
      </Link>

      <header className="hero">
        <p className="kicker">
          {weekday} · {full}
        </p>
        <h1>Деталі покупок</h1>
        <p className="lede">
          Закупівлю зробив <strong>{day.driver}</strong>. Нижче — кожна позиція:
          де куплено і скільки заощаджено проти іншого магазину.
        </p>
        {day.receipt ? (
          <button
            type="button"
            className="view-receipt"
            onClick={() => setShowReceipt(true)}
          >
            <span aria-hidden>🧾</span> Переглянути чек
          </button>
        ) : (
          <p className="no-receipt">Чек не додано для цього пробігу.</p>
        )}
      </header>

      <section className="summary" aria-label="Підсумок дня">
        <div>
          <b>{money(s.spent)}</b>
          <span>витрачено</span>
        </div>
        <div>
          <b className="pos">{money(s.saved)}</b>
          <span>заощаджено</span>
        </div>
        <div>
          <b>{s.count}</b>
          <span>позицій</span>
        </div>
      </section>

      <section className="split" aria-label="Розподіл по магазинах">
        {(
          [
            ["walmart", s.byStore.walmart],
            ["nofrills", s.byStore.nofrills],
            ["mvr", s.byStore.mvr],
          ] as const
        )
          .filter(([, amount]) => amount > 0)
          .map(([store, amount]) => (
            <div key={store}>
              <span className={`store ${store}`}>{STORE_UA[store].short}</span>
              <span className="sname">{STORE_UA[store].name}</span>
              <b>{money(amount)}</b>
            </div>
          ))}
      </section>

      <h2 className="lines-title">Позиції</h2>
      <ul className="rlines">
        {day.buys.map((buy) => {
          const other = buy.paid + buy.saved;
          return (
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
                <em className="pos">− {money(buy.saved)} заощ.</em>
                <em className="was">в іншому: {money(other)}</em>
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="rtotals">
        <div>
          <dt>Разом витрачено</dt>
          <dd>{money(s.spent)}</dd>
        </div>
        <div>
          <dt>Разом заощаджено</dt>
          <dd className="pos">{money(s.saved)}</dd>
        </div>
      </dl>

      {showReceipt && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Фото чека"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowReceipt(false);
          }}
        >
          <div className="lightbox">
            <div className="lb-head">
              <span>
                Чек завантажив <strong>{day.driver}</strong> · {day.uploadedAt}
              </span>
              <button
                type="button"
                className="close"
                aria-label="Закрити"
                onClick={() => setShowReceipt(false)}
              >
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={day.receipt} alt={`Фото чека за ${full}`} />
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
        .back {
          display: inline-block;
          text-decoration: none;
          color: #2f4a3a;
          font-weight: 650;
          font-size: 0.88rem;
          margin-bottom: 0.6rem;
        }
        .back:hover {
          text-decoration: underline;
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
          opacity: 0.82;
          line-height: 1.4;
        }
        .view-receipt {
          margin-top: 0.9rem;
          font: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          border: 1px solid #2f4a3a;
          background: #2f4a3a;
          color: #f7f3ec;
          border-radius: 999px;
          padding: 0.5rem 0.95rem;
          font-weight: 700;
          font-size: 0.9rem;
        }
        .no-receipt {
          margin: 0.85rem 0 0;
          font-size: 0.86rem;
          opacity: 0.7;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.55rem;
          margin: 1.2rem 0 0.7rem;
        }
        .summary div {
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.65rem 0.7rem;
        }
        .summary b {
          display: block;
          font-size: 1.2rem;
        }
        .summary span {
          font-size: 0.75rem;
          opacity: 0.7;
        }
        .pos {
          color: #2f6a3a;
        }
        .split {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
          gap: 0.55rem;
          margin-bottom: 1.3rem;
        }
        .split div {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 0.45rem;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.55rem 0.65rem;
        }
        .split .sname {
          font-size: 0.82rem;
          opacity: 0.8;
        }
        .split b {
          font-size: 0.98rem;
        }
        .store {
          display: inline-block;
          font-weight: 700;
          font-size: 0.68rem;
          letter-spacing: 0.03em;
          padding: 0.08rem 0.4rem;
          border-radius: 999px;
          color: #f7f3ec;
        }
        .store.walmart {
          background: #1a5f9e;
        }
        .store.nofrills {
          background: #b33b2e;
        }
        .store.mvr {
          background: #6b4f1d;
        }
        .lines-title {
          font-size: 1.05rem;
          margin: 0 0 0.55rem;
        }
        .rlines {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.55rem;
        }
        .rlines li {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 0.7rem;
          align-items: start;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.1);
          padding: 0.6rem 0.7rem;
        }
        .rname strong {
          display: block;
          font-size: 0.92rem;
          line-height: 1.25;
        }
        .rname em {
          display: block;
          font-style: normal;
          font-size: 0.78rem;
          opacity: 0.74;
          margin-top: 0.15rem;
        }
        .rnums {
          text-align: right;
          white-space: nowrap;
        }
        .rnums b {
          display: block;
          font-size: 0.98rem;
        }
        .rnums em {
          display: block;
          font-style: normal;
          font-size: 0.74rem;
          margin-top: 0.1rem;
        }
        .rnums .was {
          opacity: 0.55;
          text-decoration: line-through;
        }
        .rtotals {
          margin: 1rem 0 0;
          display: grid;
          gap: 0.3rem;
          border-top: 1px dashed rgba(40, 50, 40, 0.3);
          padding-top: 0.7rem;
        }
        .rtotals div {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .rtotals dt {
          opacity: 0.8;
          font-size: 0.95rem;
        }
        .rtotals dd {
          margin: 0;
          font-weight: 700;
          font-size: 1rem;
        }
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(16, 20, 16, 0.72);
          display: grid;
          place-items: center;
          padding: 1rem;
        }
        .lightbox {
          width: min(26rem, 100%);
          max-height: 92vh;
          display: flex;
          flex-direction: column;
          background: #f7f3ec;
          border-radius: 6px;
          overflow: hidden;
        }
        .lb-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.6rem 0.75rem;
          font-size: 0.82rem;
          border-bottom: 1px solid rgba(40, 50, 40, 0.14);
        }
        .close {
          font: inherit;
          cursor: pointer;
          border: 0;
          background: transparent;
          font-size: 1rem;
          line-height: 1;
          color: #2f4a3a;
        }
        .lightbox img {
          width: 100%;
          height: auto;
          max-height: 80vh;
          object-fit: contain;
          display: block;
          background: #11140f;
        }
        @media (max-width: 640px) {
          .summary {
            grid-template-columns: 1fr;
          }
          .split {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

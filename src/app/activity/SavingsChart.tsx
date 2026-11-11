"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { torontoDateIso } from "@/lib/activity-log";
import {
  formatDate,
  formatEconomy,
  money,
  summarize,
  type Day,
} from "./data";
import {
  monthKeyFromIso,
  monthSeries,
  savingsMonths,
  type MonthPoint,
} from "./monthly-savings";

const W = 640;
const H = 248;
const PAD = { l: 48, r: 52, t: 16, b: 28 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const padded = value * 1.1;
  const exp = Math.floor(Math.log10(padded));
  const frac = padded / 10 ** exp;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = steps.find((step) => step >= frac - 1e-9) ?? 10;
  return Math.round(nice * 10 ** exp * 100) / 100;
}

function axisMoney(n: number): string {
  if (n === 0) return "$0";
  if (n >= 100 || Number.isInteger(n)) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

function formatChange(change: number | null): string {
  if (change == null) return "—";
  if (change === 0) return "$0.00";
  const sign = change > 0 ? "+" : "−";
  return `${sign} ${money(Math.abs(change))}`;
}

export function SavingsChart({ days }: { days: Day[] }) {
  const today = torontoDateIso();
  const months = useMemo(() => savingsMonths(days, today), [days, today]);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const monthKey =
    pickedMonth && months.some((month) => month.key === pickedMonth)
      ? pickedMonth
      : (months.find((month) => month.key === monthKeyFromIso(today))?.key ??
        months[0]?.key ??
        monthKeyFromIso(today));

  const series = useMemo(() => monthSeries(days, monthKey), [days, monthKey]);
  const monthMeta = months.find((month) => month.key === monthKey);

  const economy = useMemo(() => {
    return days
      .filter((day) => day.date.startsWith(`${monthKey}-`))
      .reduce(
        (sum, day) => {
          const line = summarize(day);
          return {
            saved: sum.saved + line.saved,
            expensive: sum.expensive + (day.expensiveTotal ?? line.spent + line.saved),
          };
        },
        { saved: 0, expensive: 0 },
      );
  }, [days, monthKey]);
  const savedPercent =
    economy.expensive > 0 ? (economy.saved / economy.expensive) * 100 : 0;

  const active: MonthPoint | null = useMemo(() => {
    if (!series.length) return null;
    if (pickedDate) {
      const hit = series.find((point) => point.date === pickedDate);
      if (hit) return hit;
    }
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (series[i].hasRun) return series[i];
    }
    return null;
  }, [series, pickedDate]);

  const yMaxDay = niceMax(Math.max(0, ...series.map((point) => point.saved)));
  const yMaxTotal = niceMax(Math.max(0, ...series.map((point) => point.cumulative)));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const slot = series.length > 0 ? plotW / series.length : plotW;
  const yOf = (value: number, max: number) => PAD.t + plotH - (value / max) * plotH;
  const dayTicks = [0, yMaxDay / 2, yMaxDay];
  const totalTicks = [yMaxTotal / 2, yMaxTotal];
  const linePoints = series
    .map((point, index) => {
      const x = PAD.l + slot * index + slot / 2;
      return `${x},${yOf(point.cumulative, yMaxTotal)}`;
    })
    .join(" ");

  const activeLabel = active ? formatDate(active.date) : null;

  return (
    <section className="chart" aria-label="Заощадження за місяць">
      <div className="head">
        <h2>Заощадження за місяць</h2>
        <p>
          {monthMeta?.label ?? monthKey}
          {monthMeta && monthMeta.runs > 0
            ? ` · ${formatEconomy(economy.saved, savedPercent)}`
            : " · ще немає зданих закупівель"}
        </p>
      </div>
      <div className="layout">
        <aside className="months" aria-label="Місяць">
          <p className="months-label">Місяць</p>
          <ul>
            {months.map((month) => {
              const on = month.key === monthKey;
              return (
                <li key={month.key}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setPickedMonth(month.key);
                      setPickedDate(null);
                    }}
                  >
                    <strong>{month.label}</strong>
                    <span>
                      {month.runs > 0 ? `− ${money(month.saved)}` : "немає даних"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="plot">
          <p className="legend">
            <span>
              <i className="swatch bar" /> за день (ліворуч)
            </span>
            <span>
              <i className="swatch line" /> накопичено (праворуч)
            </span>
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Заощадження по днях, ${monthMeta?.label ?? monthKey}`}
          >
            {dayTicks.map((tick) => (
              <g key={`day-${tick}`}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={yOf(tick, yMaxDay)}
                  y2={yOf(tick, yMaxDay)}
                  stroke="rgba(40, 50, 40, 0.12)"
                />
                <text
                  x={PAD.l - 6}
                  y={yOf(tick, yMaxDay) + 4}
                  textAnchor="end"
                  fill="#2f6a3a"
                  fontSize={11}
                >
                  {axisMoney(tick)}
                </text>
              </g>
            ))}
            {totalTicks.map((tick) => (
              <text
                key={`total-${tick}`}
                x={W - PAD.r + 6}
                y={yOf(tick, yMaxTotal) + 4}
                textAnchor="start"
                fill="#c47b2b"
                fontSize={11}
              >
                {axisMoney(tick)}
              </text>
            ))}
            {series.map((point, index) => {
              const barW = Math.max(2, slot * 0.62);
              const x = PAD.l + slot * index + (slot - barW) / 2;
              const height =
                point.saved > 0
                  ? Math.max(3, (point.saved / yMaxDay) * plotH)
                  : point.hasRun
                    ? 4
                    : 2;
              const y = PAD.t + plotH - height;
              const on = active?.date === point.date;
              const fill = on
                ? "#1e4a2c"
                : !point.hasRun
                  ? "#e4dfd4"
                  : point.saved > 0
                    ? "#2f6a3a"
                    : "#8d9074";
              return (
                <rect
                  key={point.date}
                  x={x}
                  y={y}
                  width={barW}
                  height={height}
                  rx={1.5}
                  fill={fill}
                  stroke={on ? "#c47b2b" : "none"}
                  strokeWidth={on ? 1.5 : 0}
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={on}
                  aria-label={`${formatDate(point.date).full}, за день ${money(point.saved)}, накопичено ${money(point.cumulative)}`}
                  onClick={() => setPickedDate(point.date)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setPickedDate(point.date);
                    }
                  }}
                />
              );
            })}
            {linePoints && (
              <polyline
                points={linePoints}
                fill="none"
                stroke="#c47b2b"
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}
            {series.map((point, index) => {
              const show =
                point.day === 1 ||
                point.day === series.length ||
                point.day % 5 === 0 ||
                point.date === active?.date;
              if (!show) return null;
              const x = PAD.l + slot * index + slot / 2;
              return (
                <text
                  key={`x-${point.date}`}
                  x={x}
                  y={H - 8}
                  textAnchor="middle"
                  fill={point.date === active?.date ? "#1e281e" : "#5c665c"}
                  fontSize={11}
                  fontWeight={point.date === active?.date ? 700 : 400}
                >
                  {point.day}
                </text>
              );
            })}
          </svg>
          <div className="detail">
            {active && activeLabel ? (
              <>
                <div>
                  <strong>{activeLabel.full}</strong>
                  <span className="muted weekday">{activeLabel.weekday}</span>
                </div>
                <div>
                  <b>{money(active.saved)}</b>
                  <span className="muted">{active.hasRun ? "за день" : "закупівель не було"}</span>
                </div>
                <div>
                  <b className={active.change != null && active.change < 0 ? "drop" : "pos"}>
                    {formatChange(active.change)}
                  </b>
                  <span className="muted">проти попереднього дня</span>
                </div>
                <div>
                  <b>{money(active.cumulative)}</b>
                  <span className="muted">накопичено</span>
                </div>
                {active.hasRun ? (
                  <Link href={`/activity/${active.date}`}>Відкрити день</Link>
                ) : null}
              </>
            ) : (
              <p className="muted">У цьому місяці ще немає зданих закупівель.</p>
            )}
          </div>
        </div>
      </div>
      <style jsx>{`
        .chart {
          margin: 0 0 1.15rem;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.85rem 0.85rem 0.75rem;
        }
        .head h2 {
          margin: 0;
          font-size: 1.05rem;
        }
        .head p {
          margin: 0.2rem 0 0.75rem;
          font-size: 0.86rem;
          color: #2f6a3a;
          font-weight: 700;
        }
        .layout {
          display: grid;
          grid-template-columns: 12.5rem 1fr;
          gap: 0.75rem;
          align-items: start;
        }
        .months-label {
          margin: 0 0 0.35rem;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #2f4a3a;
        }
        .months ul {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.35rem;
          max-height: 280px;
          overflow: auto;
        }
        .months button {
          width: 100%;
          text-align: left;
          font: inherit;
          cursor: pointer;
          border: 1px solid rgba(40, 50, 40, 0.16);
          background: #f7f3ec;
          color: inherit;
          border-radius: 0;
          padding: 0.45rem 0.55rem;
        }
        .months button[aria-pressed="true"] {
          background: #2f4a3a;
          border-color: #2f4a3a;
          color: #f7f3ec;
        }
        .months strong {
          display: block;
          font-size: 0.86rem;
        }
        .months span {
          display: block;
          margin-top: 0.12rem;
          font-size: 0.74rem;
          opacity: 0.8;
        }
        .legend {
          display: flex;
          gap: 0.9rem;
          margin: 0 0 0.35rem;
          font-size: 0.75rem;
          opacity: 0.8;
        }
        .legend span {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .swatch {
          display: inline-block;
          width: 0.85rem;
          height: 0.45rem;
        }
        .swatch.bar {
          background: #2f6a3a;
        }
        .swatch.line {
          height: 0;
          border-top: 2px solid #c47b2b;
        }
        svg {
          width: 100%;
          height: auto;
          display: block;
        }
        .detail {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem 1.1rem;
          align-items: end;
          margin-top: 0.35rem;
          padding-top: 0.55rem;
          border-top: 1px solid rgba(40, 50, 40, 0.1);
        }
        .detail strong,
        .detail b {
          display: block;
          font-size: 0.95rem;
        }
        .muted {
          display: block;
          margin-top: 0.1rem;
          font-size: 0.74rem;
          opacity: 0.65;
        }
        .weekday {
          text-transform: capitalize;
        }
        .pos {
          color: #2f6a3a;
        }
        .drop {
          color: #8a1f1f;
        }
        .detail :global(a) {
          margin-left: auto;
          align-self: center;
          color: #2f4a3a;
          font-weight: 700;
          font-size: 0.86rem;
        }
        @media (max-width: 720px) {
          .layout {
            grid-template-columns: 1fr;
          }
          .months ul {
            display: flex;
            max-height: none;
            overflow-x: auto;
            padding-bottom: 0.2rem;
          }
          .months li {
            flex: 0 0 auto;
          }
          .months button {
            min-width: 9.2rem;
          }
        }
      `}</style>
    </section>
  );
}

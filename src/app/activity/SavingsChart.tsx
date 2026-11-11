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
const H = 280;
const PAD = { l: 48, r: 18, t: 18, b: 36 };
const LINE = "#1e4db7";
const GRID = "#e3e3e3";
const AXIS = "#8a8a8a";

function tickStep(span: number): number {
  const rough = (span || 1) / 5;
  const exp = Math.floor(Math.log10(rough));
  const frac = rough / 10 ** exp;
  const steps = [1, 2, 2.5, 5, 10];
  const nice = steps.find((step) => step >= frac - 1e-9) ?? 10;
  return Math.round(nice * 10 ** exp * 1000) / 1000;
}

/** Tick marks around the data, like a line chart that does not pin the axis at zero. */
function axisTicks(min: number, max: number): number[] {
  const step = tickStep(max - min);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil((max - 1e-9) / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step * 0.001; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks.length > 1 ? ticks : [min, max];
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

  const plotted = useMemo(() => series.filter((point) => point.hasRun), [series]);
  const lineChange = useMemo(() => {
    if (!active) return null;
    const index = plotted.findIndex((point) => point.date === active.date);
    if (index <= 0) return null;
    return Math.round((plotted[index].saved - plotted[index - 1].saved) * 100) / 100;
  }, [active, plotted]);

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const values = plotted.map((point) => point.saved);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const pad = high === low ? Math.max(Math.abs(high) * 0.25, 1) : (high - low) * 0.25;
  const yTicks = axisTicks(low >= 0 ? Math.max(0, low - pad) : low - pad, high + pad);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const yOf = (value: number) => {
    const span = yMax - yMin || 1;
    return PAD.t + plotH - ((value - yMin) / span) * plotH;
  };
  const xOf = (index: number) => {
    if (plotted.length <= 1) return PAD.l + plotW / 2;
    return PAD.l + (plotW * index) / (plotted.length - 1);
  };
  const linePoints = plotted
    .map((point, index) => `${xOf(index)},${yOf(point.saved)}`)
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
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Заощадження по днях, ${monthMeta?.label ?? monthKey}`}
          >
            <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="#fff" stroke={GRID} />
            {yTicks.map((tick) => (
              <g key={`y-${tick}`}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={yOf(tick)}
                  y2={yOf(tick)}
                  stroke={GRID}
                />
                <text
                  x={PAD.l - 8}
                  y={yOf(tick) + 4}
                  textAnchor="end"
                  fill={AXIS}
                  fontSize={12}
                >
                  {axisMoney(tick)}
                </text>
              </g>
            ))}
            {plotted.map((point, index) => (
              <line
                key={`vx-${point.date}`}
                x1={xOf(index)}
                x2={xOf(index)}
                y1={PAD.t}
                y2={PAD.t + plotH}
                stroke={GRID}
              />
            ))}
            {linePoints && (
              <polyline
                points={linePoints}
                fill="none"
                stroke={LINE}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}
            {plotted.map((point, index) => {
              const on = active?.date === point.date;
              const x = xOf(index);
              return (
                <g key={point.date}>
                  <text
                    x={x}
                    y={H - 12}
                    textAnchor="middle"
                    fill={on ? LINE : AXIS}
                    fontSize={12}
                    fontWeight={on ? 700 : 400}
                  >
                    {point.day}
                  </text>
                  <circle
                    cx={x}
                    cy={yOf(point.saved)}
                    r={14}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-pressed={on}
                    aria-label={`${formatDate(point.date).full}, за день ${money(point.saved)}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setPickedDate(point.date)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPickedDate(point.date);
                      }
                    }}
                  />
                  <circle
                    cx={x}
                    cy={yOf(point.saved)}
                    r={on ? 6 : 4.5}
                    fill={LINE}
                    pointerEvents="none"
                  />
                </g>
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
                  <b className={lineChange != null && lineChange < 0 ? "drop" : "pos"}>
                    {formatChange(lineChange)}
                  </b>
                  <span className="muted">проти попередньої точки</span>
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

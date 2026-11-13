"use client";

import { useMemo, useState } from "react";
import { torontoDateIso } from "@/lib/activity-log";
import { formatEconomy, money, summarize, type Day } from "./data";
import { monthKeyFromIso, monthSeries, savingsMonths } from "./monthly-savings";

const W = 640;
const H = 260;
const PAD = { l: 46, r: 16, t: 16, b: 32 };
const GREEN = "#2f6a3a";
const GRID = "rgba(47, 74, 58, 0.14)";
const AXIS = "#5c665c";

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const padded = value * 1.12;
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

export function SavingsChart({ days }: { days: Day[] }) {
  const today = torontoDateIso();
  const months = useMemo(() => savingsMonths(days, today), [days, today]);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);

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
  const savedPercent = economy.expensive > 0 ? (economy.saved / economy.expensive) * 100 : 0;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const yMax = niceMax(Math.max(0, ...series.map((point) => point.cumulative)));
  const yOf = (value: number) => PAD.t + plotH - (value / yMax) * plotH;
  const xOf = (day: number) => {
    if (series.length <= 1) return PAD.l + plotW / 2;
    return PAD.l + ((day - 1) / (series.length - 1)) * plotW;
  };
  const coords = series.map((point) => ({ x: xOf(point.day), y: yOf(point.cumulative) }));
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const baseline = yOf(0);
  const area =
    coords.length > 1
      ? `${coords[0].x},${baseline} ${line} ${coords[coords.length - 1].x},${baseline}`
      : "";
  const ticks = [0, yMax / 2, yMax];

  return (
    <section className="chart" aria-label="Заощадження за місяць">
      <div className="head">
        <h2>Крива заощаджень</h2>
        <p>
          {monthMeta?.label ?? monthKey}
          {monthMeta && monthMeta.runs > 0
            ? ` · ${formatEconomy(economy.saved, savedPercent)}`
            : " · ще немає зданих закупівель"}
        </p>
      </div>
      <div className="month-bar" role="tablist" aria-label="Місяць">
        {months.map((month) => {
          const on = month.key === monthKey;
          return (
            <button
              key={month.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPickedMonth(month.key)}
            >
              <strong>{month.label}</strong>
              <span>{month.runs > 0 ? `− ${money(month.saved)}` : "немає даних"}</span>
            </button>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Крива заощаджень, ${monthMeta?.label ?? monthKey}`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yOf(tick)} y2={yOf(tick)} stroke={GRID} />
            <text x={PAD.l - 8} y={yOf(tick) + 4} textAnchor="end" fill={AXIS} fontSize={12}>
              {axisMoney(tick)}
            </text>
          </g>
        ))}
        {area && <polygon points={area} fill="rgba(47, 106, 58, 0.14)" stroke="none" />}
        {line && (
          <polyline
            points={line}
            fill="none"
            stroke={GREEN}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {series.map((point) => {
          const show = point.day === 1 || point.day === series.length || point.day % 5 === 0;
          if (!show) return null;
          return (
            <text
              key={`x-${point.date}`}
              x={xOf(point.day)}
              y={H - 10}
              textAnchor="middle"
              fill={AXIS}
              fontSize={12}
            >
              {point.day}
            </text>
          );
        })}
        {series
          .filter((point) => point.hasRun)
          .map((point) => (
            <circle
              key={point.date}
              cx={xOf(point.day)}
              cy={yOf(point.cumulative)}
              r={4.5}
              fill={GREEN}
            />
          ))}
      </svg>
      <style jsx>{`
        .chart {
          margin: 0 0 1.15rem;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.85rem 0.85rem 0.7rem;
        }
        .head h2 {
          margin: 0;
          font-size: 1.05rem;
          color: #1e281e;
        }
        .head p {
          margin: 0.2rem 0 0.7rem;
          font-size: 0.86rem;
          color: #2f6a3a;
          font-weight: 700;
        }
        .month-bar {
          display: flex;
          gap: 0.4rem;
          overflow-x: auto;
          padding-bottom: 0.15rem;
          margin-bottom: 0.55rem;
        }
        .month-bar button {
          flex: 0 0 auto;
          text-align: left;
          font: inherit;
          cursor: pointer;
          border: 1px solid rgba(47, 74, 58, 0.18);
          background: #f7f3ec;
          color: #1e281e;
          border-radius: 999px;
          padding: 0.38rem 0.8rem;
        }
        .month-bar button[aria-selected="true"] {
          background: #2f4a3a;
          border-color: #2f4a3a;
          color: #f7f3ec;
        }
        .month-bar strong {
          display: block;
          font-size: 0.82rem;
        }
        .month-bar span {
          display: block;
          margin-top: 0.05rem;
          font-size: 0.72rem;
          opacity: 0.8;
        }
        svg {
          width: 100%;
          height: auto;
          display: block;
        }
      `}</style>
    </section>
  );
}

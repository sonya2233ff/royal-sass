"use client";

import { useEffect, useMemo, useState } from "react";
import { WAITER_LIST_STORAGE_KEY } from "@/lib/product-config";
import {
  computePlans,
  DRIVER_SALARY,
  mapUrl,
  money,
  type MapProvider,
  type Plan,
} from "./route-plan";

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
  const [localLines, setLocalLines] = useState<Line[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [submitOpen, setSubmitOpen] = useState(false);
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [mapsFor, setMapsFor] = useState<Plan | null>(null);

  useEffect(() => {
    setLocalLines(readLocalWaiterDraft());
    fetch("/api/staples")
      .then(async (res) => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; items?: CatalogItem[] };
        if (data.ok && Array.isArray(data.items)) setCatalog(data.items);
      })
      .catch(() => undefined);
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

  const { plans, recommended } = useMemo(
    () => computePlans(combined),
    [combined],
  );

  function labelOf(id: string): string {
    return byId.get(id)?.label ?? id.replace(/_/g, " ");
  }

  function toggleChecked(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
    if (next.length) {
      setPhotos((prev) => [...prev, ...next]);
      setSubmitted(false);
    }
  }

  function removePhoto(url: string) {
    setPhotos((prev) => {
      const hit = prev.find((p) => p.url === url);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((p) => p.url !== url);
    });
  }

  function closeSubmit() {
    if (submitted) {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setSubmitted(false);
    }
    setSubmitOpen(false);
  }

  return (
    <div className="portal">
      <header className="hero">
        <p className="kicker">Driver&apos;s Portal</p>
        <h1>Shopping List</h1>
      </header>

      <section className="summary" aria-label="Зведення">
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
              const isChecked = checked[row.id] ?? false;
              return (
                <li key={row.id} className={isChecked ? "done-row" : undefined}>
                  {item?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="ph" />
                  )}
                  <span className="pick">
                    <strong>{labelOf(row.id)}</strong>
                  </span>
                  <em>{row.qty}×</em>
                  <button
                    type="button"
                    className={isChecked ? "check on" : "check"}
                    aria-pressed={isChecked}
                    aria-label={
                      isChecked
                        ? `Прибрати позначку: ${labelOf(row.id)}`
                        : `Позначити набране: ${labelOf(row.id)}`
                    }
                    onClick={() => toggleChecked(row.id)}
                  >
                    {isChecked ? "✓" : ""}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="combined-actions">
            <button
              type="button"
              className="submit-shopping"
              onClick={() => {
                setSubmitted(false);
                setSubmitOpen(true);
              }}
            >
              Submit the shopping
            </button>
          </div>
        </section>
      )}

      {recommended && (
        <section className="plan" aria-label="Рекомендований маршрут">
          <h2>Рекомендований маршрут</h2>
          <p className="plan-hint">
            Авто-вибір найвигіднішого варіанту: вартість товарів + дорога (км) +
            ${DRIVER_SALARY} зарплата водія.
          </p>
          <button
            type="button"
            className="rec"
            onClick={() => setMapsFor(recommended)}
          >
            <span className="rec-badge">Рекомендовано</span>
            <strong className="rec-title">{recommended.label}</strong>
            <span className="rec-route">
              {recommended.stops.map((s) => s.name).join(" → ")}
            </span>
            <span className="rec-nums">
              <span>Товари {money(recommended.productCost)}</span>
              <span>
                Дорога {recommended.distanceKm} км ·{" "}
                {money(recommended.drivingCost)}
              </span>
              <span>Зарплата {money(recommended.salary)}</span>
            </span>
            <span className="rec-total">
              Разом <b>{money(recommended.total)}</b>
            </span>
            <span className="rec-cta">Прокласти маршрут ›</span>
          </button>

          {plans.length > 1 && (
            <ul className="alts">
              {plans
                .filter((p) => p.key !== recommended.key)
                .map((p) => (
                  <li key={p.key}>
                    <span className="alt-label">{p.label}</span>
                    <span className="alt-route">
                      {p.storeIds.length} зуп. · {p.distanceKm} км
                    </span>
                    <span className="alt-total">
                      {money(p.total)}{" "}
                      <em>+{money(p.total - recommended.total)}</em>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {submitOpen && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSubmit();
          }}
        >
          <div className="sheet">
            <h2 id="submit-title">Фото чеків за день</h2>
            <p className="lede sm">
              Завантаж фото всіх чеків за сьогоднішні покупки.
            </p>

            {submitted ? (
              <div className="done">
                <p className="ok">✓ Надіслано {photos.length} фото (макет)</p>
                <p className="soon">Макет: фото нікуди не відправляються.</p>
              </div>
            ) : (
              <>
                <label className="dropzone">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => addPhotos(e.target.files)}
                  />
                  <span className="dz-icon" aria-hidden>
                    📷
                  </span>
                  <span>Натисни, щоб вибрати фото чеків</span>
                  <small>Можна кілька за раз</small>
                </label>

                {photos.length > 0 && (
                  <ul className="shots">
                    {photos.map((p) => (
                      <li key={p.url}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={p.name} />
                        <button
                          type="button"
                          className="rm"
                          aria-label="Прибрати"
                          onClick={() => removePhoto(p.url)}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <div className="actions">
              <button type="button" className="ghost" onClick={closeSubmit}>
                {submitted ? "Закрити" : "Скасувати"}
              </button>
              {!submitted && (
                <button
                  type="button"
                  className="send"
                  disabled={photos.length === 0}
                  onClick={() => setSubmitted(true)}
                >
                  Надіслати{photos.length ? ` (${photos.length})` : ""}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {mapsFor && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="maps-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMapsFor(null);
          }}
        >
          <div className="sheet">
            <h2 id="maps-title">Відкрити маршрут у застосунку</h2>
            <p className="lede sm">
              {mapsFor.stops.map((s) => s.name).join(" → ")}
            </p>
            <ol className="stop-list">
              {mapsFor.stops.map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  <strong>{s.name}</strong>
                  <span>{s.address}</span>
                </li>
              ))}
            </ol>
            <div className="maps">
              {(
                [
                  ["google", "Google Maps"],
                  ["waze", "Waze"],
                  ["apple", "Apple Maps"],
                ] as [MapProvider, string][]
              ).map(([prov, label]) => (
                <button
                  key={prov}
                  type="button"
                  className="map-btn"
                  onClick={() =>
                    window.open(
                      mapUrl(prov, mapsFor.stops),
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="soon">
              Waze веде до першої зупинки; Google/Apple прокладають весь маршрут
              між магазинами.
            </p>
            <div className="actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setMapsFor(null)}
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
          opacity: 0.78;
          line-height: 1.4;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
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
        .combined li {
          grid-template-columns: 2.4rem minmax(0, 1fr) auto auto;
        }
        .pick {
          display: grid;
          min-width: 0;
        }
        .pick strong {
          font-size: 0.9rem;
          line-height: 1.2;
        }
        .check {
          width: 1.7rem;
          height: 1.7rem;
          border-radius: 999px;
          border: 1.5px solid rgba(47, 74, 58, 0.5);
          background: #fffdf8;
          color: #2f6a3a;
          font: inherit;
          font-size: 0.95rem;
          line-height: 1;
          cursor: pointer;
          display: grid;
          place-items: center;
        }
        .check.on {
          background: #2f6a3a;
          border-color: #2f6a3a;
          color: #fff;
        }
        .done-row strong {
          text-decoration: line-through;
          opacity: 0.5;
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
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(20, 24, 20, 0.42);
          display: grid;
          place-items: end center;
        }
        .sheet {
          width: min(28rem, 100%);
          background: #f7f3ec;
          padding: 1.1rem 1rem 1.3rem;
          border-top: 1px solid rgba(40, 50, 40, 0.14);
          max-height: 88vh;
          overflow: auto;
        }
        .combined-actions {
          margin-top: 0.85rem;
        }
        .submit-shopping {
          width: 100%;
          font: inherit;
          cursor: pointer;
          border: 1px solid #2f4a3a;
          background: #2f4a3a;
          color: #f7f3ec;
          border-radius: 999px;
          padding: 0.62rem 0.9rem;
          font-weight: 700;
          font-size: 0.9rem;
        }
        .submit-shopping:hover {
          background: #263b2e;
        }
        .plan {
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.14);
          padding: 0.85rem 0.85rem 1rem;
          margin-bottom: 1rem;
        }
        .plan h2 {
          margin: 0 0 0.3rem;
          font-size: 1.05rem;
        }
        .plan-hint {
          margin: 0 0 0.7rem;
          font-size: 0.82rem;
          opacity: 0.72;
        }
        .rec {
          display: grid;
          gap: 0.35rem;
          width: 100%;
          text-align: left;
          font: inherit;
          cursor: pointer;
          background: #eef4ee;
          border: 1.5px solid #2f4a3a;
          border-radius: 8px;
          padding: 0.75rem 0.8rem;
          color: inherit;
        }
        .rec:hover {
          background: #e4efe4;
        }
        .rec-badge {
          justify-self: start;
          font-size: 0.66rem;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          background: #2f4a3a;
          color: #f7f3ec;
          padding: 0.12rem 0.5rem;
          border-radius: 999px;
        }
        .rec-title {
          font-size: 1.05rem;
        }
        .rec-route {
          font-size: 0.86rem;
          opacity: 0.85;
        }
        .rec-nums {
          display: flex;
          flex-wrap: wrap;
          gap: 0.2rem 0.9rem;
          font-size: 0.8rem;
          opacity: 0.8;
          margin-top: 0.1rem;
        }
        .rec-total {
          font-size: 0.95rem;
        }
        .rec-total b {
          font-size: 1.15rem;
        }
        .rec-cta {
          justify-self: start;
          margin-top: 0.25rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        .alts {
          list-style: none;
          margin: 0.8rem 0 0;
          padding: 0;
          display: grid;
          gap: 0.4rem;
        }
        .alts li {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 0.6rem;
          align-items: baseline;
          font-size: 0.86rem;
          padding: 0.4rem 0.2rem;
          border-top: 1px solid rgba(40, 50, 40, 0.08);
        }
        .alt-route {
          opacity: 0.65;
          font-size: 0.78rem;
          white-space: nowrap;
        }
        .alt-total em {
          font-style: normal;
          color: #8a5a1f;
          font-size: 0.78rem;
        }
        .stop-list {
          list-style: none;
          margin: 0.55rem 0 0.35rem;
          padding: 0;
          display: grid;
          gap: 0.35rem;
          counter-reset: stop;
        }
        .stop-list li {
          display: grid;
          grid-template-columns: 1.4rem 1fr;
          column-gap: 0.45rem;
          align-items: start;
          font-size: 0.84rem;
        }
        .stop-list li::before {
          counter-increment: stop;
          content: counter(stop);
          width: 1.4rem;
          height: 1.4rem;
          border-radius: 999px;
          background: #2f4a3a;
          color: #f7f3ec;
          font-size: 0.72rem;
          font-weight: 800;
          display: grid;
          place-items: center;
          grid-row: 1 / span 2;
        }
        .stop-list strong {
          font-size: 0.86rem;
        }
        .stop-list span {
          grid-column: 2;
          opacity: 0.72;
          font-size: 0.78rem;
          line-height: 1.35;
        }
        .maps {
          display: grid;
          gap: 0.45rem;
          margin: 0.3rem 0 0.2rem;
        }
        .map-btn {
          font: inherit;
          cursor: pointer;
          border: 1px solid #2f4a3a;
          background: #fffdf8;
          color: #2f4a3a;
          border-radius: 999px;
          padding: 0.6rem 0.8rem;
          font-weight: 700;
          font-size: 0.9rem;
        }
        .map-btn:hover {
          background: #eef4ee;
        }
        .dropzone {
          display: grid;
          justify-items: center;
          gap: 0.2rem;
          text-align: center;
          cursor: pointer;
          border: 1.5px dashed rgba(47, 74, 58, 0.45);
          background: #fffdf8;
          border-radius: 8px;
          padding: 1.1rem 0.9rem;
          margin-bottom: 0.7rem;
        }
        .dropzone input {
          display: none;
        }
        .dz-icon {
          font-size: 1.5rem;
        }
        .dropzone span {
          font-size: 0.9rem;
          font-weight: 600;
        }
        .dropzone small {
          font-size: 0.76rem;
          opacity: 0.65;
        }
        .shots {
          list-style: none;
          margin: 0 0 0.3rem;
          padding: 0.3rem 0.3rem 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
          gap: 0.55rem;
        }
        .shots li {
          position: relative;
        }
        .shots img {
          width: 100%;
          height: 4.5rem;
          object-fit: cover;
          border-radius: 6px;
          border: 1px solid rgba(40, 50, 40, 0.15);
          display: block;
        }
        .shots .rm {
          position: absolute;
          top: -0.4rem;
          right: -0.4rem;
          width: 1.3rem;
          height: 1.3rem;
          border-radius: 999px;
          border: 0;
          background: #2f4a3a;
          color: #f7f3ec;
          font-size: 0.7rem;
          line-height: 1;
          cursor: pointer;
        }
        .done {
          margin: 0.4rem 0 0.2rem;
        }
        .ok {
          margin: 0 0 0.3rem;
          font-weight: 700;
          color: #2f6a3a;
        }
        .sheet h2 {
          margin: 0 0 0.2rem;
          font-size: 1.1rem;
        }
        .lede.sm {
          font-size: 0.9rem;
          margin: 0 0 0.9rem;
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

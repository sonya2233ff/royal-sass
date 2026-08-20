"use client";

import { useEffect, useMemo, useState } from "react";
import {
  searchShownCatalog,
  type CatalogSearchItem,
} from "@/domain/staple-search";
import { WAITER_LIST_STORAGE_KEY } from "@/lib/product-config";

type CatalogItem = CatalogSearchItem & {
  image?: string | null;
  restaurantProduct?: { category?: string };
};

type ListLine = {
  id: string;
  qty: number;
  note: string;
};

const CATEGORY_UA: Record<string, string> = {
  produce: "Овочі / фрукти",
  frozen: "Заморозка",
  eggs: "Яйця",
  dairy: "Молочне",
  bakery: "Випічка",
  grocery: "Бакалія",
  supplies: "Витратники",
};

function categoryOf(item: CatalogItem): string {
  return item.restaurantProduct?.category?.trim() || "other";
}

function categoryLabel(key: string): string {
  return CATEGORY_UA[key] ?? "Інше";
}

function ukLineCount(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} позиція`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} позиції`;
  return `${n} позицій`;
}

function loadDraft(): ListLine[] {
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

export function WaiterPortal() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [lines, setLines] = useState<ListLine[]>([]);
  const [preview, setPreview] = useState(false);
  const [mockNote, setMockNote] = useState(false);

  useEffect(() => {
    setLines(loadDraft());
    fetch("/api/staples")
      .then(async (res) => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; items?: CatalogItem[] };
        if (!data.ok || !Array.isArray(data.items)) {
          throw new Error("catalog failed");
        }
        setItems(data.items);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Не вдалося завантажити каталог"),
      )
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(WAITER_LIST_STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* ignore quota */
    }
  }, [lines]);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const categories = useMemo(() => {
    const keys = [...new Set(items.map(categoryOf))].sort((a, b) =>
      categoryLabel(a).localeCompare(categoryLabel(b), "uk"),
    );
    return keys;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim();
    let pool =
      q.length >= 2 ? searchShownCatalog(items, q, items.length) : items;
    if (category !== "all") {
      pool = pool.filter((item) => categoryOf(item) === category);
    }
    return pool;
  }, [items, query, category]);

  function add(id: string) {
    setLines((prev) => {
      const hit = prev.find((row) => row.id === id);
      if (hit) {
        return prev.map((row) =>
          row.id === id ? { ...row, qty: Math.min(99, row.qty + 1) } : row,
        );
      }
      return [...prev, { id, qty: 1, note: "" }];
    });
  }

  function setQty(id: string, qty: number) {
    const next = Math.max(0, Math.min(99, Math.round(qty)));
    setLines((prev) => {
      if (next <= 0) return prev.filter((row) => row.id !== id);
      return prev.map((row) => (row.id === id ? { ...row, qty: next } : row));
    });
  }

  function setNote(id: string, note: string) {
    setLines((prev) =>
      prev.map((row) => (row.id === id ? { ...row, note: note.slice(0, 80) } : row)),
    );
  }

  const lineCount = lines.length;

  return (
    <div className="portal">
      <header className="hero">
        <p className="kicker">Портал офіціанта</p>
        <h1>Список для водія</h1>
        <p className="lede">
          Знайди продукт із каталогу кафе, додай у список. Відправка водію поки
          лише макет.
        </p>
      </header>

      {error && <p className="err">{error}</p>}

      <div className="layout">
        <section className="catalog" aria-label="Каталог">
          <label className="sr" htmlFor="waiter-search">
            Пошук продукту
          </label>
          <input
            id="waiter-search"
            type="search"
            autoComplete="off"
            placeholder="Яйця, молоко, стаканчики…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chips" role="tablist" aria-label="Категорія">
            <button
              type="button"
              className={category === "all" ? "chip on" : "chip"}
              onClick={() => setCategory("all")}
            >
              Усі
            </button>
            {categories.map((key) => (
              <button
                key={key}
                type="button"
                className={category === key ? "chip on" : "chip"}
                onClick={() => setCategory(key)}
              >
                {categoryLabel(key)}
              </button>
            ))}
          </div>
          {!ready && <p className="hint">Завантаження каталогу…</p>}
          {ready && visible.length === 0 && (
            <p className="hint">У списку немає такого продукту</p>
          )}
          <ul className="grid">
            {visible.map((item) => {
              const onList = lines.find((row) => row.id === item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={onList ? "card on" : "card"}
                    onClick={() => add(item.id)}
                  >
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="ph" />
                    )}
                    <span className="meta">
                      <strong>{item.label}</strong>
                      <em>
                        {onList
                          ? `У списку · ${onList.qty}`
                          : categoryLabel(categoryOf(item))}
                      </em>
                    </span>
                    <span className="plus" aria-hidden>
                      {onList ? "+" : "Додати"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="ticket" aria-label="Список для водія">
          <div className="ticket-head">
            <h2>Для водія</h2>
            <span className="count">{ukLineCount(lineCount)}</span>
          </div>
          {lines.length === 0 ? (
            <p className="hint">Порожньо. Натисни продукт у каталозі.</p>
          ) : (
            <ul className="lines">
              {lines.map((row) => {
                const item = byId.get(row.id);
                return (
                  <li key={row.id} className="line">
                    <div className="line-top">
                      <strong>{item?.label ?? row.id}</strong>
                      <div className="stepper">
                        <button
                          type="button"
                          onClick={() => setQty(row.id, row.qty - 1)}
                          aria-label="Менше"
                        >
                          −
                        </button>
                        <span>{row.qty}</span>
                        <button
                          type="button"
                          onClick={() => setQty(row.id, row.qty + 1)}
                          aria-label="Більше"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Нотатка для водія (необов’язково)"
                      value={row.note}
                      onChange={(e) => setNote(row.id, e.target.value)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="actions">
            <button
              type="button"
              className="ghost"
              disabled={lines.length === 0}
              onClick={() => setLines([])}
            >
              Очистити
            </button>
            <button
              type="button"
              className="send"
              disabled={lines.length === 0}
              onClick={() => {
                setPreview(true);
                setMockNote(false);
              }}
            >
              Відправити водію
            </button>
          </div>
        </aside>
      </div>

      {preview && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="driver-preview-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreview(false);
          }}
        >
          <div className="sheet">
            <h2 id="driver-preview-title">Макет для водія</h2>
            <p className="lede sm">Це як виглядатиме список. Нікому не надсилається.</p>
            <ol className="preview">
              {lines.map((row) => (
                <li key={row.id}>
                  <b>{row.qty}×</b> {byId.get(row.id)?.label ?? row.id}
                  {row.note ? <i> — {row.note}</i> : null}
                </li>
              ))}
            </ol>
            {mockNote && (
              <p className="soon">Поки лише макет — водію нічого не пішло.</p>
            )}
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setPreview(false)}>
                Назад
              </button>
              <button
                type="button"
                className="send"
                onClick={() => setMockNote(true)}
              >
                Відправити
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .portal {
          max-width: 1120px;
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
          max-width: 36rem;
          opacity: 0.78;
          line-height: 1.4;
        }
        .lede.sm {
          font-size: 0.9rem;
          margin-bottom: 0.8rem;
        }
        .err {
          color: #8a1f1f;
          background: #f8e4e0;
          padding: 0.55rem 0.75rem;
          margin: 1rem 0 0;
        }
        .layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 20rem;
          gap: 1.2rem;
          margin-top: 1.2rem;
          align-items: start;
        }
        .catalog input[type="search"],
        .line input[type="text"] {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid rgba(40, 50, 40, 0.22);
          background: #fffdf8;
          padding: 0.7rem 0.8rem;
          font: inherit;
          font-size: 1rem;
          color: inherit;
        }
        .catalog input[type="search"]:focus,
        .line input[type="text"]:focus {
          outline: 2px solid #2f4a3a;
          outline-offset: 1px;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          margin: 0.75rem 0 0.9rem;
        }
        .chip,
        .ghost,
        .send,
        .stepper button,
        .card {
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
        .hint {
          opacity: 0.7;
          font-size: 0.92rem;
        }
        .grid {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.45rem;
        }
        .card {
          display: grid;
          grid-template-columns: 3rem 1fr auto;
          gap: 0.7rem;
          align-items: center;
          width: 100%;
          text-align: left;
          border: 1px solid rgba(40, 50, 40, 0.12);
          background: #fffdf8;
          padding: 0.45rem 0.55rem;
          color: inherit;
        }
        .card.on {
          border-color: #2f4a3a;
          background: #e7efe8;
        }
        .card img,
        .ph {
          width: 3rem;
          height: 3rem;
          object-fit: cover;
          background: #e9e4da;
          display: block;
        }
        .meta strong {
          display: block;
          font-size: 0.92rem;
          line-height: 1.25;
        }
        .meta em {
          display: block;
          font-style: normal;
          font-size: 0.75rem;
          opacity: 0.65;
          margin-top: 0.12rem;
        }
        .plus {
          font-size: 0.75rem;
          font-weight: 700;
          color: #2f4a3a;
          white-space: nowrap;
        }
        .ticket {
          position: sticky;
          top: 4.2rem;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.14);
          padding: 0.9rem 0.85rem 1rem;
        }
        .ticket-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 0.5rem;
        }
        .ticket-head h2 {
          margin: 0;
          font-size: 1.05rem;
        }
        .count {
          font-size: 0.78rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        .lines {
          list-style: none;
          margin: 0.7rem 0 0;
          padding: 0;
          display: grid;
          gap: 0.65rem;
          max-height: 55vh;
          overflow: auto;
        }
        .line-top {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
          align-items: center;
          margin-bottom: 0.3rem;
        }
        .line-top strong {
          font-size: 0.88rem;
        }
        .stepper {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          border: 1px solid rgba(47, 74, 58, 0.25);
          border-radius: 999px;
          padding: 0.05rem;
        }
        .stepper button {
          width: 1.7rem;
          height: 1.7rem;
          border: 0;
          background: transparent;
          color: inherit;
          font-size: 1rem;
        }
        .stepper span {
          min-width: 1.2rem;
          text-align: center;
          font-weight: 700;
          font-size: 0.88rem;
        }
        .actions {
          display: flex;
          gap: 0.45rem;
          margin-top: 0.9rem;
        }
        .ghost,
        .send {
          flex: 1;
          border-radius: 999px;
          padding: 0.62rem 0.7rem;
          font-weight: 700;
          font-size: 0.88rem;
        }
        .ghost {
          border: 1px solid rgba(47, 74, 58, 0.3);
          background: transparent;
          color: #3d4a40;
        }
        .send {
          border: 1px solid #2f4a3a;
          background: #2f4a3a;
          color: #f7f3ec;
        }
        .send:disabled,
        .ghost:disabled {
          opacity: 0.4;
          cursor: not-allowed;
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
          width: min(32rem, 100%);
          background: #f7f3ec;
          padding: 1.1rem 1rem 1.3rem;
          border-top: 1px solid rgba(40, 50, 40, 0.14);
        }
        .sheet h2 {
          margin: 0 0 0.2rem;
          font-size: 1.15rem;
        }
        .preview {
          margin: 0;
          padding: 0 0 0 1.1rem;
          display: grid;
          gap: 0.35rem;
        }
        .preview i {
          font-style: normal;
          opacity: 0.7;
        }
        .soon {
          margin: 0.8rem 0 0;
          padding: 0.5rem 0.65rem;
          background: #efe6d2;
          font-size: 0.88rem;
        }
        .sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        @media (max-width: 840px) {
          .layout {
            grid-template-columns: 1fr;
          }
          .ticket {
            position: static;
          }
        }
      `}</style>
    </div>
  );
}

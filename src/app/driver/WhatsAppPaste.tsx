"use client";

import { useMemo, useState } from "react";
import {
  toWaiterLinesFromWhatsApp,
  type WhatsAppConfirmLine,
  type WhatsAppDecision,
} from "@/domain/whatsapp-list";
import type { WaiterTicket } from "@/domain/waiter-tickets";
import { readCustomStaples, readProductOverrides } from "@/lib/product-config";
import {
  notifyWaiterTicket,
  readDriverClientId,
  upsertDriverInbox,
} from "@/lib/waiter-tickets";
import { searchShownCatalog } from "@/domain/staple-search";

type CatalogItem = {
  id: string;
  label: string;
  image?: string | null;
  searchHay?: string;
  queries?: string[];
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
};

type DraftRow = WhatsAppDecision & {
  skip: boolean;
  pickId: string;
};

const STATUS_UA: Record<WhatsAppDecision["status"], string> = {
  matched: "Знайдено",
  unsure: "Уточни",
  unmatched: "Неясно",
};

function asDraft(row: WhatsAppDecision): DraftRow {
  return {
    ...row,
    skip: row.status === "unmatched",
    pickId: row.matchedId ?? row.alternatives[0]?.id ?? "",
  };
}

export function WhatsAppPaste({
  catalog,
  onTicket,
}: {
  catalog: CatalogItem[];
  onTicket: (ticket: WaiterTicket) => void;
}) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [picker, setPicker] = useState<{ index: number; query: string } | null>(
    null,
  );

  const byId = useMemo(() => new Map(catalog.map((item) => [item.id, item])), [catalog]);

  const pickerHits = useMemo(() => {
    if (!picker || picker.query.trim().length < 2) return [];
    return searchShownCatalog(catalog, picker.query, 8);
  }, [catalog, picker]);

  async function parseList() {
    if (!text.trim() || parsing) return;
    setParsing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/driver/whatsapp-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          customStaples: readCustomStaples(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        decisions?: WhatsAppDecision[];
        skipped?: string[];
      };
      if (!res.ok || !data.ok || !Array.isArray(data.decisions)) {
        throw new Error(data.error ?? "не вдалося розпізнати список");
      }
      setDrafts(data.decisions.map(asDraft));
      setSkipped(Array.isArray(data.skipped) ? data.skipped : []);
      if (!data.decisions.length) {
        setNotice("У тексті немає рядків з продуктами.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося розпізнати список.");
    } finally {
      setParsing(false);
    }
  }

  function setQty(index: number, qty: number) {
    const next = Math.max(1, Math.min(99, Math.round(qty)));
    setDrafts((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              qty: next,
              requestedAmount:
                row.unit === "kg" || row.unit === "g"
                  ? next
                  : next,
            }
          : row,
      ),
    );
  }

  function pickProduct(index: number, id: string) {
    const item = byId.get(id);
    setDrafts((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              pickId: id,
              skip: false,
              status: "matched",
              matchedId: id,
              matchedLabel: item?.label ?? row.matchedLabel,
            }
          : row,
      ),
    );
    setPicker(null);
  }

  const readyLines = drafts.filter((row) => !row.skip && row.pickId);

  async function confirm() {
    if (!readyLines.length || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    const confirmed: WhatsAppConfirmLine[] = readyLines.map((row) => ({
      id: row.pickId,
      label: byId.get(row.pickId)?.label ?? row.matchedLabel ?? row.pickId,
      qty: row.qty,
      unit: row.unit,
      requestedAmount: row.requestedAmount,
      note: row.raw,
    }));
    const lines = toWaiterLinesFromWhatsApp(confirmed);
    try {
      const res = await fetch("/api/waiter/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waiterClientId: readDriverClientId(),
          waiter: "WhatsApp",
          station: "Водій",
          lines,
          customStaples: readCustomStaples(),
          productOverrides: readProductOverrides(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        ticket?: WaiterTicket;
      };
      if (!res.ok || !data.ok || !data.ticket) {
        throw new Error(data.error ?? "не вдалося додати до закупки");
      }
      upsertDriverInbox(data.ticket);
      notifyWaiterTicket(data.ticket);
      onTicket(data.ticket);
      setDrafts([]);
      setSkipped([]);
      setText("");
      setNotice(
        data.ticket.compare
          ? "Список додано. Нижче — готові варіанти закупки."
          : "Список додано. Порівняння з каталогу ще без цін — N/A, не $0.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося додати список.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="wa" aria-label="Список з WhatsApp">
      <h2>Вставити список з WhatsApp</h2>
      <p className="lede">
        Скопіюй переписку зі списком. Розпізнаємо лише продукти з каталогу кафе.
        Якщо неясно — обери сам, не вгадуємо SKU.
      </p>
      <label className="sr" htmlFor="wa-paste">
        Текст зі WhatsApp
      </label>
      <textarea
        id="wa-paste"
        rows={6}
        placeholder={"2 milk\nfrozen blueberries\nфрозен блуперіс 2\negg whites x2\ntomato 5kg\nще 2 milk"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="actions">
        <button
          type="button"
          className="ghost"
          disabled={!text.trim()}
          onClick={() => {
            setText("");
            setDrafts([]);
            setSkipped([]);
            setNotice(null);
            setError(null);
          }}
        >
          Очистити
        </button>
        <button
          type="button"
          className="send"
          disabled={!text.trim() || parsing}
          onClick={() => void parseList()}
        >
          {parsing ? "Читаю…" : "Розпізнати"}
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      {notice && <p className="ok">{notice}</p>}
      {skipped.length > 0 && (
        <p className="tiny mute">Пропущено: {skipped.slice(0, 6).join(" · ")}</p>
      )}
      {drafts.length > 0 && (
        <ul className="rows">
          {drafts.map((row, index) => {
            const item = byId.get(row.pickId);
            const options =
              row.alternatives.length > 0
                ? row.alternatives
                : item
                  ? [{ id: item.id, label: item.label, score: 0 }]
                  : [];
            return (
              <li key={`${row.raw}-${index}`} className={row.skip ? "row skip" : "row"}>
                {item?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="ph" />
                )}
                <div className="meta">
                  <strong>{item?.label ?? row.matchedLabel ?? row.query}</strong>
                  <em>
                    {row.raw} · {STATUS_UA[row.status]}
                    {row.unit === "kg" || row.unit === "g"
                      ? ` · ${row.requestedAmount} ${row.unit}`
                      : ""}
                  </em>
                  {options.length > 1 && !row.skip && (
                    <label className="pick">
                      Продукт
                      <select
                        value={row.pickId}
                        onChange={(e) => pickProduct(index, e.target.value)}
                      >
                        {options.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {row.status !== "matched" && (
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        setPicker({ index, query: row.query })
                      }
                    >
                      Обрати з каталогу
                    </button>
                  )}
                </div>
                <div className="side">
                  <div className="stepper">
                    <button
                      type="button"
                      onClick={() => setQty(index, row.qty - 1)}
                      aria-label="Менше"
                    >
                      −
                    </button>
                    <span>{row.qty}</span>
                    <button
                      type="button"
                      onClick={() => setQty(index, row.qty + 1)}
                      aria-label="Більше"
                    >
                      +
                    </button>
                  </div>
                  <label className="chk">
                    <input
                      type="checkbox"
                      checked={!row.skip}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((r, i) =>
                            i === index ? { ...r, skip: !e.target.checked } : r,
                          ),
                        )
                      }
                    />
                    Взяти
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {picker && (
        <div className="finder">
          <label>
            Пошук у каталозі
            <input
              type="search"
              value={picker.query}
              onChange={(e) =>
                setPicker({ index: picker.index, query: e.target.value })
              }
              autoComplete="off"
            />
          </label>
          <ul>
            {pickerHits.map((hit) => (
              <li key={hit.id}>
                <button type="button" onClick={() => pickProduct(picker.index, hit.id)}>
                  {hit.label}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ghost" onClick={() => setPicker(null)}>
            Скасувати
          </button>
        </div>
      )}
      {drafts.length > 0 && (
        <div className="actions">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setDrafts([]);
              setSkipped([]);
            }}
          >
            Назад
          </button>
          <button
            type="button"
            className="send"
            disabled={!readyLines.length || sending}
            onClick={() => void confirm()}
          >
            {sending ? "Додаю…" : "Додати до закупки"}
          </button>
        </div>
      )}
      <style jsx>{`
        .wa {
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.12);
          padding: 0.85rem 0.85rem 1rem;
          margin: 0 0 1rem;
        }
        .wa h2 {
          margin: 0 0 0.25rem;
          font-size: 0.95rem;
        }
        .lede {
          margin: 0 0 0.65rem;
          font-size: 0.86rem;
          opacity: 0.78;
          line-height: 1.35;
        }
        textarea,
        .finder input,
        .pick select {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid rgba(40, 50, 40, 0.22);
          background: #fffdf8;
          padding: 0.65rem 0.7rem;
          font: inherit;
          color: inherit;
        }
        textarea:focus,
        .finder input:focus,
        .pick select:focus {
          outline: 2px solid #2f4a3a;
          outline-offset: 1px;
        }
        .actions {
          display: flex;
          gap: 0.45rem;
          margin-top: 0.7rem;
        }
        .ghost,
        .send,
        .stepper button,
        .link,
        .finder button {
          font: inherit;
          cursor: pointer;
        }
        .ghost,
        .send {
          flex: 1;
          border-radius: 999px;
          padding: 0.55rem 0.7rem;
          font-weight: 700;
          font-size: 0.86rem;
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
        .ghost:disabled,
        .send:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .err {
          color: #8a1f1f;
          background: #f8e4e0;
          padding: 0.45rem 0.6rem;
          margin: 0.55rem 0 0;
        }
        .ok {
          color: #1e4030;
          background: #e7efe8;
          padding: 0.45rem 0.6rem;
          margin: 0.55rem 0 0;
        }
        .tiny {
          font-size: 0.78rem;
          margin: 0.45rem 0 0;
        }
        .mute {
          opacity: 0.7;
        }
        .rows {
          list-style: none;
          margin: 0.75rem 0 0;
          padding: 0;
          display: grid;
          gap: 0.45rem;
        }
        .row {
          display: grid;
          grid-template-columns: 2.4rem 1fr auto;
          gap: 0.55rem;
          align-items: center;
          border: 1px solid rgba(40, 50, 40, 0.1);
          padding: 0.4rem 0.45rem;
        }
        .row.skip {
          opacity: 0.55;
        }
        img,
        .ph {
          width: 2.4rem;
          height: 2.4rem;
          object-fit: cover;
          background: #e9e4da;
          display: block;
        }
        .meta strong {
          display: block;
          font-size: 0.88rem;
        }
        .meta em {
          display: block;
          font-style: normal;
          font-size: 0.75rem;
          opacity: 0.65;
          margin-top: 0.1rem;
        }
        .pick {
          display: grid;
          gap: 0.15rem;
          font-size: 0.72rem;
          margin-top: 0.3rem;
        }
        .link {
          border: 0;
          background: transparent;
          color: #2f4a3a;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.2rem 0 0;
          text-align: left;
        }
        .side {
          display: grid;
          gap: 0.3rem;
          justify-items: end;
        }
        .stepper {
          display: inline-flex;
          align-items: center;
          gap: 0.2rem;
          border: 1px solid rgba(47, 74, 58, 0.25);
          border-radius: 999px;
          padding: 0.05rem;
        }
        .stepper button {
          width: 1.6rem;
          height: 1.6rem;
          border: 0;
          background: transparent;
        }
        .stepper span {
          min-width: 1.1rem;
          text-align: center;
          font-weight: 700;
          font-size: 0.85rem;
        }
        .chk {
          font-size: 0.72rem;
          display: inline-flex;
          gap: 0.25rem;
          align-items: center;
        }
        .finder {
          margin-top: 0.7rem;
          border: 1px dashed rgba(47, 74, 58, 0.35);
          padding: 0.55rem;
        }
        .finder ul {
          list-style: none;
          margin: 0.4rem 0;
          padding: 0;
          display: grid;
          gap: 0.25rem;
        }
        .finder li button {
          width: 100%;
          text-align: left;
          border: 1px solid rgba(40, 50, 40, 0.12);
          background: #fff;
          padding: 0.4rem 0.5rem;
        }
        .sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        @media (max-width: 640px) {
          .row {
            grid-template-columns: 2.4rem 1fr;
          }
          .side {
            grid-column: 1 / -1;
            justify-items: start;
            grid-template-columns: auto auto;
            justify-content: space-between;
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}

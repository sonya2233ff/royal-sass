"use client";

import { useEffect, useMemo, useState } from "react";
import {
  decideManualProduct,
  type ManualProductDecision,
  type ReceiptStapleDraft,
} from "@/domain/receipt-import";
import { identityKeywords } from "@/domain/pack-tokens";
import type { CatalogSearchItem } from "@/domain/staple-search";

type MatchChoice = "auto" | "exact" | "cheapest_equivalent";

type Props = {
  open: boolean;
  busy: boolean;
  initialLabel?: string;
  catalog: CatalogSearchItem[];
  occupiedIds?: Iterable<string>;
  onClose: () => void;
  onPickExisting: (id: string) => void;
  onAdopt: (drafts: ReceiptStapleDraft[], rematch: boolean) => Promise<void>;
};

function parseCommaList(raw: string): string[] {
  return identityKeywords(raw.split(/[,;\n]+/));
}

export function AddProduct({
  open,
  busy,
  initialLabel = "",
  catalog,
  occupiedIds,
  onClose,
  onPickExisting,
  onAdopt,
}: Props) {
  const [label, setLabel] = useState(initialLabel);
  const [query, setQuery] = useState("");
  const [matchChoice, setMatchChoice] = useState<MatchChoice>("auto");
  const [includeRaw, setIncludeRaw] = useState("");
  const [excludeRaw, setExcludeRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(initialLabel);
    setQuery("");
    setMatchChoice("auto");
    setIncludeRaw("");
    setExcludeRaw("");
    setError(null);
  }, [open, initialLabel]);

  const decision: ManualProductDecision | null = useMemo(() => {
    const name = label.trim();
    if (!open || name.length < 3) return null;
    return decideManualProduct(
      {
        label: name,
        query: query.trim() || undefined,
        matchMode: matchChoice === "auto" ? undefined : matchChoice,
        mustIncludeAny: parseCommaList(includeRaw),
        mustNotInclude: parseCommaList(excludeRaw),
      },
      catalog,
      occupiedIds,
    );
  }, [open, label, query, matchChoice, includeRaw, excludeRaw, catalog, occupiedIds]);

  if (!open) return null;

  function resetAndClose() {
    setError(null);
    onClose();
  }

  async function adopt(rematch: boolean) {
    if (!decision || decision.status !== "new" || !decision.draft) {
      setError("Немає нового продукту для додавання.");
      return;
    }
    setError(null);
    await onAdopt([decision.draft], rematch);
  }

  const existing =
    decision?.status === "eggs" || decision?.status === "existing"
      ? decision
      : null;

  return (
    <div
      className="rc-back"
      role="dialog"
      aria-modal="true"
      aria-label="Додати продукт"
    >
      <div className="rc-panel">
        <header>
          <strong>Додати продукт</strong>
          <button type="button" onClick={resetAndClose}>
            Закрити
          </button>
        </header>
        <p className="rc-hint">
          Нова картка кафе, не живий пошук Walmart / No Frills. Ціну не
          вигадуємо — спочатку порожньо (N/A), потім «Додати і знайти» лише
          цей id. Яйця завжди йдуть на одну картку Large eggs.
        </p>
        <label>
          Назва
          <input
            type="text"
            value={label}
            disabled={busy}
            autoComplete="off"
            placeholder="Haolam farmer cheese"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label>
          Додатковий пошуковий запит (необовʼязково)
          <input
            type="text"
            value={query}
            disabled={busy}
            autoComplete="off"
            placeholder="farmer cheese"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Як підбирати
          <select
            value={matchChoice}
            disabled={busy}
            onChange={(e) => setMatchChoice(e.target.value as MatchChoice)}
          >
            <option value="auto">Авто (А бренд / Б овочі й постачання)</option>
            <option value="exact">А — точний продукт</option>
            <option value="cheapest_equivalent">Б — найдешевший відповідний</option>
          </select>
        </label>
        <label>
          Include (через кому; розмір пачки ігнорується)
          <input
            type="text"
            value={includeRaw}
            disabled={busy}
            autoComplete="off"
            placeholder="haolam, farmer"
            onChange={(e) => setIncludeRaw(e.target.value)}
          />
        </label>
        <label>
          Exclude
          <input
            type="text"
            value={excludeRaw}
            disabled={busy}
            autoComplete="off"
            placeholder="imitation, fat free"
            onChange={(e) => setExcludeRaw(e.target.value)}
          />
        </label>

        {decision?.status === "invalid" && (
          <p className="rc-err">{decision.reason}</p>
        )}
        {existing && (
          <p className="rc-exist">
            {existing.status === "eggs"
              ? "Яйця вже є однією карткою."
              : "Такий продукт уже в каталозі."}{" "}
            <button
              type="button"
              className="rc-link"
              disabled={busy}
              onClick={() => {
                onPickExisting(existing.matchedId);
                resetAndClose();
              }}
            >
              Відкрити {existing.matchedLabel}
            </button>
          </p>
        )}
        {decision?.status === "new" && decision.draft && (
          <p className="rc-hint">
            Новий id <code>{decision.draft.id}</code> ·{" "}
            {decision.draft.matchMode === "exact" ? "А точний" : "Б найдешевший"}
            {decision.draft.category ? ` · ${decision.draft.category}` : ""}.
            Ціни магазинів ще немає.
          </p>
        )}

        {error && <p className="rc-err">{error}</p>}

        <div className="rc-actions">
          <button
            type="button"
            className="rc-go"
            disabled={busy || decision?.status !== "new"}
            onClick={() => void adopt(false)}
          >
            Додати
          </button>
          <button
            type="button"
            className="rc-go rc-rematch"
            disabled={busy || decision?.status !== "new"}
            title="Додати і знайти лише цей новий id у магазинах"
            onClick={() => void adopt(true)}
          >
            Додати і знайти в магазинах
          </button>
        </div>
      </div>
      <style jsx>{`
        .rc-back {
          position: fixed;
          inset: 0;
          background: rgba(20, 24, 20, 0.45);
          z-index: 80;
          display: grid;
          place-items: end center;
        }
        .rc-panel {
          width: min(560px, 100%);
          max-height: 92vh;
          overflow: auto;
          background: #fffdf8;
          padding: 1rem 1.1rem 1.4rem;
          display: grid;
          gap: 0.55rem;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        label {
          display: grid;
          gap: 0.2rem;
          font-size: 0.82rem;
        }
        input,
        select,
        button {
          font: inherit;
        }
        input,
        select {
          padding: 0.4rem 0.5rem;
        }
        .rc-hint {
          font-size: 0.75rem;
          opacity: 0.75;
          line-height: 1.35;
          margin: 0;
        }
        .rc-hint code {
          font-size: 0.72rem;
        }
        .rc-err {
          color: #8a1f1f;
          font-size: 0.82rem;
          margin: 0;
        }
        .rc-exist {
          font-size: 0.85rem;
          margin: 0;
          line-height: 1.4;
        }
        .rc-link {
          background: none;
          border: 0;
          padding: 0;
          color: #2f4a3a;
          text-decoration: underline;
          cursor: pointer;
          font-weight: 650;
        }
        .rc-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .rc-go {
          background: #2f4a3a;
          color: #fff;
          border: 0;
          padding: 0.55rem 0.8rem;
          cursor: pointer;
        }
        .rc-rematch {
          background: #1e4030;
        }
        .rc-go:disabled {
          opacity: 0.55;
          cursor: default;
        }
      `}</style>
    </div>
  );
}

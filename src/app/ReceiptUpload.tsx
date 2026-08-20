"use client";

import { useMemo, useState } from "react";
import type { ReceiptLineDecision, ReceiptStapleDraft } from "@/domain/receipt-import";
import { readCustomStaples } from "@/lib/product-config";

type Props = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onAdopt: (drafts: ReceiptStapleDraft[], rematch: boolean) => Promise<void>;
};

async function fileToJpeg(
  file: File,
): Promise<{ mime: "image/jpeg"; dataBase64: string }> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("canvas");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("jpeg"))),
      "image/jpeg",
      0.72,
    );
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { mime: "image/jpeg", dataBase64: btoa(binary) };
}

export function ReceiptUpload({ open, busy, onClose, onAdopt }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [decisions, setDecisions] = useState<ReceiptLineDecision[] | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const newRows = useMemo(
    () =>
      (decisions ?? [])
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.status === "new" && row.draft),
    [decisions],
  );

  if (!open) return null;

  function reset() {
    setFiles([]);
    setText("");
    setError(null);
    setDecisions(null);
    setSelected({});
  }

  async function parse() {
    setError(null);
    setParsing(true);
    try {
      const images = [];
      for (const file of files.slice(0, 4)) {
        images.push(await fileToJpeg(file));
      }
      const res = await fetch("/api/staples/receipts/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images,
          text: text.trim() || undefined,
          customStaples: readCustomStaples(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        decisions?: ReceiptLineDecision[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(
          data.error ?? "Не вдалося прочитати чек. Вставте текст або зробіть чіткіше фото.",
        );
      }
      const next = data.decisions ?? [];
      setDecisions(next);
      const pick: Record<number, boolean> = {};
      next.forEach((row, index) => {
        if (row.status === "new" && row.draft) pick[index] = true;
      });
      setSelected(pick);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  async function adopt(rematch: boolean) {
    const drafts = newRows
      .filter(({ index }) => selected[index] !== false)
      .map(({ row }) => row.draft!)
      .filter(Boolean);
    if (!drafts.length) {
      setError("Позначте нові продукти, які треба додати.");
      return;
    }
    setError(null);
    await onAdopt(drafts, rematch);
    reset();
  }

  return (
    <div className="rc-back" role="dialog" aria-modal="true" aria-label="Чек">
      <div className="rc-panel">
        <header>
          <strong>Чек</strong>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Закрити
          </button>
        </header>
        <p className="rc-hint">
          Фото чека не зберігається. Продукти, яких ще немає в каталозі, можна
          додати картками. Яйця завжди йдуть на одну картку Large eggs.
        </p>
        <label>
          Фото чека
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={parsing || busy}
            onChange={(e) =>
              setFiles(Array.from(e.target.files ?? []).slice(0, 4))
            }
          />
        </label>
        {files.length > 0 && (
          <p className="rc-hint">{files.length} фото (стиснемо перед відправкою)</p>
        )}
        <label>
          або вставте текст чека
          <textarea
            rows={6}
            value={text}
            disabled={parsing || busy}
            onChange={(e) => setText(e.target.value)}
            placeholder={"HAOLAM RICOTTA CHEESE 6.99\nLARGE EGGS 18 4.99\nHST 0.65"}
          />
        </label>
        <div className="rc-actions">
          <button
            type="button"
            className="rc-go"
            disabled={parsing || busy || (!files.length && !text.trim())}
            onClick={() => void parse()}
          >
            {parsing ? "Читаю чек…" : "Розпізнати"}
          </button>
        </div>

        {error && <p className="rc-err">{error}</p>}

        {decisions && (
          <ul className="rc-list">
            {decisions.map((row, index) => (
              <li key={`${row.name}-${index}`} className={row.status}>
                {row.status === "new" && row.draft ? (
                  <label className="rc-check">
                    <input
                      type="checkbox"
                      checked={selected[index] !== false}
                      onChange={(e) =>
                        setSelected((prev) => ({
                          ...prev,
                          [index]: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      <strong>новий</strong> · {row.name}
                    </span>
                  </label>
                ) : row.status === "existing" ? (
                  <span>
                    <strong>вже в каталозі</strong> · {row.name}
                    {row.matchedLabel ? ` → ${row.matchedLabel}` : ""}
                  </span>
                ) : (
                  <span>
                    <strong>пропустити</strong> · {row.name}
                    {row.reason ? ` (${row.reason})` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {newRows.length > 0 && (
          <div className="rc-actions">
            <button
              type="button"
              className="rc-go"
              disabled={busy || parsing}
              onClick={() => void adopt(false)}
            >
              Додати нові
            </button>
            <button
              type="button"
              className="rc-go rc-rematch"
              disabled={busy || parsing}
              title="Додати і знайти лише ці нові id у магазинах"
              onClick={() => void adopt(true)}
            >
              Додати і знайти в магазинах
            </button>
          </div>
        )}
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
        textarea,
        button {
          font: inherit;
        }
        textarea,
        input[type="file"] {
          padding: 0.35rem 0.45rem;
        }
        .rc-hint {
          font-size: 0.75rem;
          opacity: 0.75;
          line-height: 1.35;
          margin: 0;
        }
        .rc-err {
          color: #8a1f1f;
          font-size: 0.82rem;
          margin: 0;
        }
        .rc-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          gap: 0.35rem;
          font-size: 0.82rem;
        }
        .rc-list li {
          border: 1px solid #e4ddd0;
          padding: 0.4rem 0.5rem;
        }
        .rc-list li.existing {
          opacity: 0.8;
        }
        .rc-list li.skip {
          opacity: 0.55;
        }
        .rc-check {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .rc-check input {
          width: auto;
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

"use client";

import { useState } from "react";
import {
  adoptWhatsAppDecisions,
  toWaiterLinesFromWhatsApp,
  type WhatsAppDecision,
} from "@/domain/whatsapp-list";
import type { WaiterTicket } from "@/domain/waiter-tickets";
import { readCustomStaples, readProductOverrides } from "@/lib/product-config";
import {
  notifyWaiterTicket,
  readDriverClientId,
  upsertDriverInbox,
} from "@/lib/waiter-tickets";

export function WhatsAppPaste({
  onTicket,
}: {
  onTicket: (ticket: WaiterTicket) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function findAndLoad() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const parsedRes = await fetch("/api/driver/whatsapp-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          customStaples: readCustomStaples(),
        }),
      });
      const parsed = (await parsedRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        decisions?: WhatsAppDecision[];
        skipped?: string[];
      };
      if (!parsedRes.ok || !parsed.ok || !Array.isArray(parsed.decisions)) {
        throw new Error(parsed.error ?? "не вдалося знайти продукти");
      }
      const { confirmed, missed } = adoptWhatsAppDecisions(parsed.decisions);
      const lines = toWaiterLinesFromWhatsApp(confirmed);
      if (!lines.length) {
        throw new Error("у списку немає продуктів з каталогу кафе");
      }
      const ticketRes = await fetch("/api/waiter/tickets", {
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
      const data = (await ticketRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        ticket?: WaiterTicket;
      };
      if (!ticketRes.ok || !data.ok || !data.ticket) {
        throw new Error(data.error ?? "не вдалося додати список");
      }
      upsertDriverInbox(data.ticket);
      notifyWaiterTicket(data.ticket);
      onTicket(data.ticket);
      setText("");
      const notFound = [
        ...(Array.isArray(parsed.skipped) ? parsed.skipped : []),
        ...missed,
      ];
      setNotice(
        notFound.length
          ? `Знайдено ${lines.length}. Не в каталозі: ${notFound.slice(0, 6).join(" · ")}`
          : `Знайдено ${lines.length}. Обери магазини нижче.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося знайти продукти.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wa" aria-label="Список з WhatsApp">
      <h2>Вставити список з WhatsApp</h2>
      <p className="lede">
        Встав список продуктів. Додаток сам знайде їх у каталозі. Далі ти лише
        обираєш магазини.
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
          disabled={!text.trim() || busy}
          onClick={() => {
            setText("");
            setNotice(null);
            setError(null);
          }}
        >
          Очистити
        </button>
        <button
          type="button"
          className="send"
          disabled={!text.trim() || busy}
          onClick={() => void findAndLoad()}
        >
          {busy ? "Шукаю продукти…" : "Знайти продукти"}
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      {notice && <p className="ok">{notice}</p>}
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
        textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid rgba(40, 50, 40, 0.22);
          background: #fffdf8;
          padding: 0.65rem 0.7rem;
          font: inherit;
          color: inherit;
        }
        textarea:focus {
          outline: 2px solid #2f4a3a;
          outline-offset: 1px;
        }
        .actions {
          display: flex;
          gap: 0.45rem;
          margin-top: 0.7rem;
        }
        .ghost,
        .send {
          font: inherit;
          cursor: pointer;
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
        .sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
      `}</style>
    </section>
  );
}

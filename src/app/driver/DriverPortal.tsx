"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  compressImageSource,
  recordDriverRun,
  saveReceipts,
  torontoDateIso,
} from "@/lib/activity-log";
import {
  buildDriverPickList,
  completeDriverShopping,
  importDriverJobsPayload,
  loadDriverJobs,
  loadWaiterList,
  subscribeWaiterDriver,
  type DriverJob,
  type WaiterLine,
} from "@/lib/waiter-driver";
import {
  computePlans,
  livePriceTableFromStaples,
  mapUrl,
  money,
  setLivePriceTable,
  STORES,
  type MapProvider,
  type Plan,
  type StoreId,
} from "./route-plan";

function kmDelta(plan: Plan, vs: Plan): string {
  const d = Math.round((plan.distanceKm - vs.distanceKm) * 10) / 10;
  if (d === 0) return "той самий км";
  return d > 0 ? `+${d} км` : `${d} км`;
}

type CatalogItem = {
  id: string;
  label: string;
  image?: string | null;
  walmartCached?: { price?: number } | null;
  noFrillsCached?: { price?: number } | null;
  wholesaleClubCached?: { price?: number } | null;
  mvrCached?: { price?: number } | null;
};

const STORE_SHORT: Record<StoreId, string> = {
  walmart: "WM",
  nofrills: "NF",
  wholesaleclub: "WC",
  mvr: "MVR",
};

function ukLineCount(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} позиція`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} позиції`;
  return `${n} позицій`;
}

export function DriverPortal() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [liveLines, setLiveLines] = useState<WaiterLine[]>([]);
  const [jobs, setJobs] = useState<DriverJob[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [submitOpen, setSubmitOpen] = useState(false);
  const [photos, setPhotos] = useState<
    { name: string; url: string; file: File }[]
  >([]);
  const [submitted, setSubmitted] = useState(false);
  const [receiptSaved, setReceiptSaved] = useState(0);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mapsFor, setMapsFor] = useState<Plan | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);

  function refreshFromWaiter() {
    const nextLive = loadWaiterList();
    const nextJobs = loadDriverJobs();
    setLiveLines((prev) =>
      JSON.stringify(prev) === JSON.stringify(nextLive) ? prev : nextLive,
    );
    setJobs((prev) =>
      JSON.stringify(prev) === JSON.stringify(nextJobs) ? prev : nextJobs,
    );
  }

  useEffect(() => {
    refreshFromWaiter();
    fetch("/api/staples")
      .then(async (res) => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        const data = (await res.json()) as { ok?: boolean; items?: CatalogItem[] };
        if (data.ok && Array.isArray(data.items)) setCatalog(data.items);
      })
      .catch(() => undefined);
    return subscribeWaiterDriver(refreshFromWaiter);
  }, []);

  useEffect(() => {
    setLivePriceTable(
      catalog.length ? livePriceTableFromStaples(catalog) : null,
    );
    return () => setLivePriceTable(null);
  }, [catalog]);

  const byId = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );

  const combined = useMemo(
    () => buildDriverPickList(liveLines, jobs),
    [liveLines, jobs],
  );

  // Drop ✓ for items no longer on the pick list (waiter removed them).
  useEffect(() => {
    const ids = new Set(combined.map((row) => row.id));
    setChecked((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, on] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = on;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [combined]);

  const noteById = useMemo(
    () => new Map(combined.map((row) => [row.id, row.note])),
    [combined],
  );

  // Recompute when live shelf table changes (setLivePriceTable from catalog).
  const { plans, recommended } = useMemo(
    () =>
      computePlans(combined.map((row) => ({ id: row.id, qty: row.qty }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog feeds livePriceTable
    [combined, catalog],
  );

  const activePlan = useMemo(() => {
    if (!plans.length) return null;
    return plans.find((p) => p.key === planKey) ?? recommended;
  }, [plans, planKey, recommended]);

  /** Products grouped by store, in route stop order for the active plan. */
  const storeGroups = useMemo(() => {
    if (!activePlan) return [];
    return activePlan.storeIds.map((storeId) => ({
      store: STORES[storeId],
      items: activePlan.items.filter((item) => item.store === storeId),
    }));
  }, [activePlan]);

  useEffect(() => {
    if (!recommended) {
      setPlanKey(null);
      return;
    }
    if (planKey && !plans.some((p) => p.key === planKey)) {
      setPlanKey(recommended.key);
    }
  }, [plans, planKey, recommended]);

  const openJobCount = jobs.filter((j) => j.status === "open").length;
  const fromWaiterLive = liveLines.length > 0;
  const allBought =
    combined.length > 0 && combined.every((row) => checked[row.id]);
  const boughtCount = combined.filter((row) => checked[row.id]).length;

  function labelOf(id: string): string {
    return byId.get(id)?.label ?? id.replace(/_/g, " ");
  }

  function toggleChecked(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function finishShopping() {
    if (submitting) return;
    setSubmitting(true);
    setReceiptError(null);
    setReceiptSaved(0);
    try {
      const plan = activePlan;
      let receipt = "";
      if (photos.length) {
        const compressed: string[] = [];
        for (const p of photos) {
          const dataUrl = await compressImageSource(p.file ?? p.url);
          if (dataUrl) compressed.push(dataUrl);
        }
        if (compressed.length) {
          const date = torontoDateIso();
          receipt = await saveReceipts(date, compressed);
          setReceiptSaved(compressed.length);
        } else if (photos.length) {
          setReceiptError(
            "Не вдалося стиснути фото чека — закупівлю не здано. Спробуй інше фото.",
          );
          return;
        }
      }
      if (plan?.items.length) {
        recordDriverRun({
          items: plan.items,
          labelOf,
          driver: "Водій",
          receipt,
        });
      }
      completeDriverShopping();
      setLiveLines([]);
      setJobs(loadDriverJobs());
      setChecked({});
      setPlanKey(null);
      setSubmitted(true);
    } catch (e) {
      setReceiptError(
        e instanceof Error ? e.message : "Не вдалося зберегти закупівлю / чек",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function pasteDriverJobs() {
    try {
      const text = await navigator.clipboard.readText();
      const n = importDriverJobsPayload(text);
      if (!n) {
        setReceiptError(null);
        window.alert("У буфері немає списку від офіціанта.");
        return;
      }
      refreshFromWaiter();
    } catch {
      window.alert("Не вдалося прочитати буфер обміну.");
    }
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith("image/") || f.type === "")
      .map((f) => ({
        name: f.name || "receipt.jpg",
        url: URL.createObjectURL(f),
        file: f,
      }));
    if (next.length) {
      setPhotos((prev) => [...prev, ...next]);
      setSubmitted(false);
      setReceiptError(null);
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
        <p className="kicker">Портал водія</p>
        <h1>Список закупівлі</h1>
        <p className="lede">
          Список з порталу офіціанта на <strong>цьому телефоні</strong>. Інший
          телефон — встав список з буфера (офіціант копіює JSON). Ціни планів
          беруться з живого каталогу; маршрут рекомендується за найкоротшими км.
        </p>
        <button type="button" className="paste-jobs" onClick={() => void pasteDriverJobs()}>
          Вставити список з буфера
        </button>
      </header>

      <section className="summary" aria-label="Зведення">
        <div>
          <b>{ukLineCount(combined.length)}</b>
          <span>у списку від офіціанта</span>
        </div>
        <div>
          <b>{combined.reduce((n, row) => n + row.qty, 0)}</b>
          <span>одиниць набрати</span>
        </div>
        <div>
          <b>{openJobCount}</b>
          <span>зафіксованих партій</span>
        </div>
      </section>

      {combined.length === 0 || !activePlan ? (
        <section className="empty-list" aria-label="Порожній список">
          <p>
            Поки порожньо. Відкрий{" "}
            <Link href="/waiter">Офіціант</Link> на цьому телефоні або встав
            список з буфера обміну.
          </p>
        </section>
      ) : (
        <section className="combined" aria-label="Зведений список">
          <h2>Що набрати</h2>
          <p className="plan-for">
            За планом: <strong>{activePlan.label}</strong>
            {activePlan.key === recommended?.key ? " (рекомендовано)" : ""}
          </p>
          {fromWaiterLive && (
            <p className="live-hint">● Чернетка офіціанта оновлюється наживо</p>
          )}
          <div className="store-groups">
            {storeGroups.map((group) => (
              <section
                key={group.store.id}
                className="store-group"
                aria-label={group.store.name}
              >
                <header className="store-head">
                  <span className={`store-badge ${group.store.id}`}>
                    {STORE_SHORT[group.store.id]}
                  </span>
                  <div>
                    <strong>{group.store.name}</strong>
                    <small>{group.store.address}</small>
                  </div>
                  <em className="store-count">
                    {group.items.length}{" "}
                    {group.items.length === 1 ? "позиція" : "поз."}
                  </em>
                </header>
                <ul>
                  {group.items.map((row) => {
                    const item = byId.get(row.id);
                    const note = noteById.get(row.id);
                    const isChecked = checked[row.id] ?? false;
                    return (
                      <li
                        key={row.id}
                        className={isChecked ? "done-row" : undefined}
                      >
                        {item?.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.image}
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="ph" />
                        )}
                        <span className="pick">
                          <strong>{labelOf(row.id)}</strong>
                          {note ? <small>{note}</small> : null}
                          <span className="pick-meta">
                            {STORE_SHORT[row.store]} · {money(row.price)} / шт
                          </span>
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
              </section>
            ))}
          </div>
          <div className="combined-actions">
            {!allBought && (
              <p className="buy-hint">
                Познач усі позиції ✓ ({boughtCount}/{combined.length}), тоді
                можна здати закупівлю — список очиститься.
              </p>
            )}
            <button
              type="button"
              className="submit-shopping"
              disabled={!allBought}
              onClick={() => {
                setSubmitted(false);
                setSubmitOpen(true);
              }}
            >
              Здати закупівлю
            </button>
          </div>
        </section>
      )}

      {activePlan && recommended && (
        <section className="plan" aria-label="Рекомендований маршрут">
          <h2>Рекомендований маршрут</h2>
          <p className="plan-hint">
            Рекомендовано найкоротший маршрут (км). Ціни товарів і зарплата
            водія в вибір не входять. Натисни інший план — список вище
            перегрупується по магазинах.
          </p>
          <button
            type="button"
            className={
              activePlan.key === recommended.key ? "rec on-plan" : "rec"
            }
            onClick={() => {
              setPlanKey(recommended.key);
              setMapsFor(recommended);
            }}
          >
            <span className="rec-badge">Рекомендовано</span>
            <strong className="rec-title">{recommended.label}</strong>
            <span className="rec-route">
              {recommended.stops.map((s) => s.name).join(" → ")}
            </span>
            <span className="rec-stores">
              {recommended.storeIds
                .map((id) => STORE_SHORT[id])
                .join(" + ")}
              {" · "}
              {recommended.items
                .map(
                  (i) =>
                    `${labelOf(i.id).slice(0, 18)}→${STORE_SHORT[i.store]}`,
                )
                .slice(0, 4)
                .join(", ")}
              {recommended.items.length > 4 ? "…" : ""}
            </span>
            <span className="rec-nums">
              <span>
                Маршрут <b>{recommended.distanceKm} км</b>
              </span>
              <span>Товари {money(recommended.productCost)} (довідково)</span>
            </span>
            <span className="rec-total">
              Найкоротший · {recommended.distanceKm} км
            </span>
            <span className="rec-cta">Прокласти маршрут ›</span>
          </button>

          {plans.length > 1 && (
            <ul className="alts">
              {plans
                .filter((p) => p.key !== recommended.key)
                .map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      className={
                        activePlan.key === p.key ? "alt-btn on" : "alt-btn"
                      }
                      onClick={() => setPlanKey(p.key)}
                    >
                      <span className="alt-label">{p.label}</span>
                      <span className="alt-route">
                        {p.storeIds.map((id) => STORE_SHORT[id]).join("+")} ·{" "}
                        {p.distanceKm} км
                      </span>
                      <span className="alt-total">
                        {p.distanceKm} км{" "}
                        <em>{kmDelta(p, recommended)}</em>
                      </span>
                    </button>
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
                <p className="ok">✓ Закупівлю здано · список очищено</p>
                <p className="soon">
                  Запис додано в{" "}
                  <Link href="/activity" style={{ color: "#2f4a3a", fontWeight: 700 }}>
                    Історію
                  </Link>
                  {receiptSaved
                    ? ` · ${receiptSaved} фото чека збережено на цьому телефоні.`
                    : " · без фото чека."}
                </p>
              </div>
            ) : (
              <>
                <label className="dropzone">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={(e) => addPhotos(e.target.files)}
                  />
                  <span className="dz-icon" aria-hidden>
                    📷
                  </span>
                  <span>Натисни, щоб зробити / вибрати фото чеків</span>
                  <small>
                    Фото стиснеться і збережеться в Історії на цьому телефоні
                  </small>
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
                {receiptError && <p className="shot-err">{receiptError}</p>}
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
                  disabled={!allBought || submitting}
                  onClick={() => {
                    void finishShopping();
                  }}
                >
                  {submitting
                    ? "Зберігаю…"
                    : `Здати закупівлю${photos.length ? ` · ${photos.length} фото` : ""}`}
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
        .paste-jobs {
          margin-top: 0.75rem;
          font: inherit;
          cursor: pointer;
          border: 1px solid #2f4a3a;
          background: #fffdf8;
          color: #2f4a3a;
          border-radius: 999px;
          padding: 0.4rem 0.85rem;
          font-weight: 700;
          font-size: 0.84rem;
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
          margin: 0.35rem 0 0;
          max-width: 36rem;
          opacity: 0.78;
          line-height: 1.4;
          font-size: 0.92rem;
        }
        .lede.sm {
          font-size: 0.9rem;
          margin-bottom: 0.8rem;
        }
        .empty-list {
          background: #fffdf8;
          border: 1px dashed rgba(40, 50, 40, 0.25);
          padding: 1rem 0.9rem;
          margin-bottom: 1rem;
        }
        .empty-list p {
          margin: 0;
          line-height: 1.45;
          opacity: 0.85;
        }
        .empty-list a {
          color: #2f4a3a;
          font-weight: 700;
        }
        .live-hint {
          margin: 0 0 0.55rem;
          font-size: 0.78rem;
          color: #2f4a3a;
          font-weight: 600;
        }
        .plan-for {
          margin: -0.2rem 0 0.55rem;
          font-size: 0.82rem;
          opacity: 0.8;
        }
        .plan-for strong {
          color: #2f4a3a;
        }
        .store-groups {
          display: grid;
          gap: 0.75rem;
        }
        .store-group {
          border: 1px solid rgba(40, 50, 40, 0.12);
          background: #f7faf7;
          padding: 0.55rem 0.55rem 0.4rem;
        }
        .store-head {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 0.55rem;
          align-items: center;
          margin-bottom: 0.4rem;
          padding-bottom: 0.4rem;
          border-bottom: 1px solid rgba(40, 50, 40, 0.1);
        }
        .store-head strong {
          display: block;
          font-size: 0.92rem;
        }
        .store-head small {
          display: block;
          font-size: 0.72rem;
          opacity: 0.65;
          line-height: 1.3;
        }
        .store-count {
          font-style: normal;
          font-size: 0.72rem;
          opacity: 0.65;
          white-space: nowrap;
        }
        .store-badge {
          display: grid;
          place-items: center;
          min-width: 2.2rem;
          height: 1.6rem;
          padding: 0 0.35rem;
          border-radius: 4px;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #fffdf8;
          background: #2f4a3a;
        }
        .store-badge.walmart {
          background: #1a5f9e;
        }
        .store-badge.nofrills {
          background: #b33b2e;
        }
        .store-badge.wholesaleclub {
          background: #3d5a80;
        }
        .store-badge.mvr {
          background: #6b4f1d;
        }
        .pick {
          display: grid;
          gap: 0.1rem;
          min-width: 0;
        }
        .pick strong {
          font-size: 0.9rem;
          line-height: 1.2;
        }
        .pick small {
          font-size: 0.75rem;
          opacity: 0.7;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pick-meta {
          font-size: 0.72rem;
          font-weight: 700;
          color: #2f4a3a;
          opacity: 0.85;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
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
        .buy-hint {
          margin: 0 0 0.45rem;
          font-size: 0.8rem;
          opacity: 0.75;
          line-height: 1.35;
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
        .submit-shopping:hover:not(:disabled) {
          background: #263b2e;
        }
        .submit-shopping:disabled {
          opacity: 0.45;
          cursor: not-allowed;
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
        .rec-stores {
          font-size: 0.75rem;
          opacity: 0.72;
          line-height: 1.35;
        }
        .rec.on-plan {
          box-shadow: inset 0 0 0 2px #2f4a3a;
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
          border-top: 1px solid rgba(40, 50, 40, 0.08);
        }
        .alt-btn {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 0.6rem;
          align-items: baseline;
          font: inherit;
          font-size: 0.86rem;
          padding: 0.5rem 0.35rem;
          text-align: left;
          color: inherit;
          background: transparent;
          border: 0;
          border-radius: 6px;
          cursor: pointer;
        }
        .alt-btn:hover {
          background: #eef4ee;
        }
        .alt-btn.on {
          background: #e4efe4;
          box-shadow: inset 0 0 0 1.5px #2f4a3a;
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
        .shot-err {
          margin: 0.45rem 0 0;
          color: #8a2f2f;
          font-size: 0.84rem;
          font-weight: 600;
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

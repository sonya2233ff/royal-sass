"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type MouseEvent,
} from "react";
import { ProductSearch } from "./ProductSearch";

type OfferStatus =
  | "ok"
  | "unavailable"
  | "wrong_pack"
  | "wrong_size"
  | "stale"
  | "no_match"
  | "rejected";

type Staple = {
  id: string;
  label: string;
  image: string | null;
  notes?: string;
  status: OfferStatus;
  statusReason?: string | null;
  ageLabel?: string | null;
  confirmed?: boolean;
  preferredProductId?: string | null;
  matchMode?: "preferred" | "cheapest";
  weightCompare?: boolean;
  soldByWeight?: boolean;
  walmartCached: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    checkedAt?: string;
    pricePerKg?: number | null;
    pricePerLb?: number | null;
    nativeUnit?: "kg" | "lb" | null;
    nativeUnitPrice?: number | null;
    nativeUnitLabel?: string | null;
    nativeUnitPriceLabel?: string | null;
    wasPrice?: number | null;
    onSale?: boolean;
  } | null;
  noFrillsCached: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    checkedAt?: string;
    ageLabel?: string | null;
    pricePerKg?: number | null;
    pricePerLb?: number | null;
    nativeUnit?: "kg" | "lb" | null;
    nativeUnitPrice?: number | null;
    nativeUnitLabel?: string | null;
    nativeUnitPriceLabel?: string | null;
    wasPrice?: number | null;
    onSale?: boolean;
  } | null;
  onSale?: boolean;
};

type SideResult = {
  name?: string;
  shelfPrice?: number;
  lineTotal: number | null;
  note?: string;
  compareUnitLabel?: string | null;
  status?: OfferStatus;
  statusReason?: string;
  ageLabel?: string | null;
  productId?: string;
  pricePerKg?: number;
  pricePerLb?: number;
  nativeUnit?: "kg" | "lb";
  nativeUnitPrice?: number;
  nativeUnitLabel?: string;
  nativeUnitPriceLabel?: string;
};

type CompareRow = {
  id: string;
  label: string;
  image: string | null;
  confirmed?: boolean;
  walmart: SideResult;
  noFrills: SideResult;
  cheaper: string;
  delta: number | null;
  soldByWeight?: boolean;
  grams?: number | null;
  fairLabel?: string | null;
  fairBasis?: string | null;
  matchKind?: string | null;
};

function tidyOfferName(name: string): string {
  const parts = name
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(", ");
}

function saleTitle(item: Staple): string {
  const bits: string[] = [];
  if (item.walmartCached?.onSale) {
    bits.push(
      item.walmartCached.wasPrice
        ? `WM знижка: було $${item.walmartCached.wasPrice.toFixed(2)}`
        : "WM зараз на знижці",
    );
  }
  if (item.noFrillsCached?.onSale) {
    bits.push(
      item.noFrillsCached.wasPrice
        ? `NF знижка: було $${item.noFrillsCached.wasPrice.toFixed(2)}`
        : "NF зараз на знижці",
    );
  }
  return bits.join(" · ") || "Зараз на знижці";
}

function statusLabel(s?: OfferStatus | string | null): string {
  switch (s) {
    case "ok":
      return "ok";
    case "unavailable":
      return "unavailable";
    case "wrong_pack":
      return "wrong pack";
    case "wrong_size":
      return "wrong size";
    case "stale":
      return "stale cache";
    case "no_match":
      return "no match";
    case "rejected":
      return "rejected";
    default:
      return s ?? "—";
  }
}

const HIDDEN_KEY = "royal-sass-hidden-staples";

function loadHiddenIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function StaplesCompare() {
  const [items, setItems] = useState<Staple[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [totals, setTotals] = useState<{
    walmart: number;
    noFrills: number;
    cheaper: string;
    completeCount: number;
    note?: string;
  } | null>(null);
  const [matchLogId, setMatchLogId] = useState<string | null>(null);
  const [logPreview, setLogPreview] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [catalogAt, setCatalogAt] = useState<string | null>(null);
  const [nfCatalogAt, setNfCatalogAt] = useState<string | null>(null);
  const [staleHours, setStaleHours] = useState(24);
  const [gramsById, setGramsById] = useState<Record<string, string>>({});
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    setHiddenIds(new Set(loadHiddenIds()));
  }, []);

  const reload = useCallback(async () => {
    const res = await fetch("/api/staples");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? "load failed");
    setItems(data.items);
    setCatalogAt(data.catalogCheckedAt ?? null);
    setNfCatalogAt(data.noFrillsCatalogCheckedAt ?? null);
    setStaleHours(data.cacheStaleHours ?? 24);
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(String(e.message ?? e)));
  }, [reload]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (hiddenIds.has(item.id)) return false;
      if (!q) return true;
      const blob = [
        item.label,
        item.walmartCached?.name,
        item.noFrillsCached?.name,
        item.walmartCached?.productId,
        item.noFrillsCached?.productId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [items, hiddenIds, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickStaple(id: string) {
    setHiddenIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
    setSelected((prev) => new Set(prev).add(id));
    setQuery("");
    window.setTimeout(() => {
      document
        .getElementById(`staple-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  async function onAdopted(id: string) {
    await reload();
    pickStaple(id);
  }

  function setGrams(id: string, value: string) {
    setGramsById((prev) => ({ ...prev, [id]: value }));
  }

  function gramsPayload(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of selected) {
      if (hiddenIds.has(id)) continue;
      const n = Number.parseFloat(gramsById[id] ?? "");
      if (Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  }

  function hideCard(id: string, e?: MouseEvent) {
    e?.stopPropagation();
    e?.preventDefault();
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
  }

  function restoreHiddenCards() {
    window.localStorage.removeItem(HIDDEN_KEY);
    setHiddenIds(new Set());
  }

  function runCompare() {
    setError(null);
    setBusy("compare");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selected].filter((id) => !hiddenIds.has(id)),
            grams: gramsPayload(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "compare failed");
        setRows(data.rows);
        setTotals(data.totals);
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshSelected() {
    setError(null);
    setBusy("refresh");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...selected] }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "refresh failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data.entries ?? null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshNoFrillsSelected() {
    setError(null);
    setBusy("refresh-nf");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh-nf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...selected] }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "NF refresh failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data.entries ?? null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  async function vote(
    id: string,
    vote: "up" | "down",
    productId?: string,
    e?: MouseEvent,
  ) {
    e?.stopPropagation();
    setError(null);
    try {
      const res = await fetch("/api/staples/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, vote, productId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "confirm failed");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="staples">
      <header className="hero">
        <p className="brand">Royal SASS</p>
        <h1>Cafe staples</h1>
        <p className="sub">
          Walmart #5831 vs No Frills #3660. Для овочів/фруктів і frozen: WM —{" "}
          <strong>за 1 kg</strong>, No Frills — <strong>за 1 lb</strong>. Товари
          на вагу: після галочки вкажи скільки <strong>грам</strong> потрібно.
          Решта — ціна за пачку. Produce/frozen — найдешевший матч (бренд не
          важливий).
        </p>
        <p className="meta">
          Cache TTL {staleHours}h
          {catalogAt
            ? ` · WM ${new Date(catalogAt).toLocaleString()}`
            : ""}
          {nfCatalogAt
            ? ` · NF ${new Date(nfCatalogAt).toLocaleString()}`
            : " · NF — після першого Compare"}
          {" · × на картці ховає її (можна відновити)"}
        </p>
        <ProductSearch
          query={query}
          onQueryChange={setQuery}
          onPickStaple={pickStaple}
          onAdopted={(id) => {
            void onAdopted(id);
          }}
        />
      </header>

      <section className="grid">
        {visibleItems.map((item) => {
          const on = selected.has(item.id);
          const gramsVal = gramsById[item.id] ?? "";
          const gramsN = Number.parseFloat(gramsVal);
          const estKg =
            item.soldByWeight && Number.isFinite(gramsN) && gramsN > 0
              ? gramsN / 1000
              : null;
          const wmEst =
            estKg != null && item.walmartCached?.pricePerKg
              ? item.walmartCached.pricePerKg * estKg
              : null;
          const nfEst =
            estKg != null && item.noFrillsCached?.pricePerKg
              ? item.noFrillsCached.pricePerKg * estKg
              : null;
          return (
            <div
              key={item.id}
              id={`staple-${item.id}`}
              className={on ? "card on" : "card"}
            >
              <button
                type="button"
                className="card-main"
                onClick={() => toggle(item.id)}
              >
                <div className="thumb">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.label} />
                  ) : (
                    <div className="ph">No photo</div>
                  )}
                  {item.onSale && (
                    <span className="sale-bang" title={saleTitle(item)}>
                      !
                    </span>
                  )}
                </div>
                <div className="body">
                  <strong>
                    {item.label}
                    {item.onSale ? (
                      <span className="sale-mark" title={saleTitle(item)}>
                        !
                      </span>
                    ) : null}
                  </strong>
                  <span className={`pill ${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                  {item.matchMode === "cheapest" && (
                    <span className="pill cheapest">cheapest</span>
                  )}
                  {item.walmartCached ? (
                    <>
                      <span className="sku">
                        WM {tidyOfferName(item.walmartCached.name)}
                      </span>
                      <span className="price">
                        WM ${item.walmartCached.price.toFixed(2)}
                        {item.walmartCached.onSale &&
                        item.walmartCached.wasPrice ? (
                          <s className="was">
                            ${item.walmartCached.wasPrice.toFixed(2)}
                          </s>
                        ) : null}
                        {item.walmartCached.packageSize
                          ? ` · ${item.walmartCached.packageSize}`
                          : ""}
                      </span>
                      {item.weightCompare &&
                        item.walmartCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {item.walmartCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає WM ціни</span>
                  )}
                  {item.noFrillsCached ? (
                    <>
                      <span className="sku">
                        NF {tidyOfferName(item.noFrillsCached.name)}
                      </span>
                      <span className="price">
                        NF ${item.noFrillsCached.price.toFixed(2)}
                        {item.noFrillsCached.onSale &&
                        item.noFrillsCached.wasPrice ? (
                          <s className="was">
                            ${item.noFrillsCached.wasPrice.toFixed(2)}
                          </s>
                        ) : null}
                        {item.noFrillsCached.packageSize
                          ? ` · ${item.noFrillsCached.packageSize}`
                          : ""}
                      </span>
                      {item.weightCompare &&
                        item.noFrillsCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {item.noFrillsCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає NF ціни</span>
                  )}
                  {item.ageLabel && (
                    <span className="age">
                      {"WM \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {item.ageLabel}
                    </span>
                  )}
                  {item.noFrillsCached?.ageLabel && (
                    <span className="age">
                      {"NF \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {item.noFrillsCached.ageLabel}
                    </span>
                  )}
                  {item.statusReason && (
                    <span className="reason">{item.statusReason}</span>
                  )}
                </div>
                <span className="check">{on ? "✓" : ""}</span>
              </button>
              <button
                type="button"
                className="hide-card"
                title="Видалити картку (dev)"
                onClick={(e) => hideCard(item.id, e)}
              >
                ×
              </button>
              {on && item.soldByWeight && (
                <label className="grams">
                  <span>грам</span>
                  <input
                    type="number"
                    min={1}
                    step={50}
                    inputMode="numeric"
                    placeholder="1000"
                    value={gramsVal}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setGrams(item.id, e.target.value)}
                  />
                  {(wmEst != null || nfEst != null) && (
                    <span className="grams-est">
                      {wmEst != null ? `WM $${wmEst.toFixed(2)}` : ""}
                      {wmEst != null && nfEst != null ? " · " : ""}
                      {nfEst != null ? `NF $${nfEst.toFixed(2)}` : ""}
                    </span>
                  )}
                </label>
              )}
              <div className="votes">
                <button
                  type="button"
                  title="Підтвердити матч"
                  onClick={(e) =>
                    vote(item.id, "up", item.walmartCached?.productId, e)
                  }
                >
                  👍{item.confirmed ? "✓" : ""}
                </button>
                <button
                  type="button"
                  title="Відхилити матч"
                  onClick={(e) => vote(item.id, "down", undefined, e)}
                >
                  👎
                </button>
              </div>
            </div>
          );
        })}
        {visibleItems.length === 0 && (
          <p className="empty-grid">
            {query.trim()
              ? "У списку немає такого товару — обери з підказок вище, щоб додати."
              : "Немає карток."}
          </p>
        )}
      </section>

      <div className="actions">
        <button
          type="button"
          className="cta"
          disabled={pending || selected.size === 0 || busy != null}
          onClick={runCompare}
        >
          {busy === "compare"
            ? "Comparing…"
            : `Compare ${selected.size} items`}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={pending || selected.size === 0 || busy != null}
          onClick={refreshSelected}
        >
          {busy === "refresh"
            ? "Refreshing WM…"
            : `Refresh WM (${selected.size})`}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={pending || selected.size === 0 || busy != null}
          onClick={refreshNoFrillsSelected}
        >
          {busy === "refresh-nf"
            ? "Refreshing NF…"
            : `Refresh NF (${selected.size})`}
        </button>
        {hiddenIds.size > 0 && (
          <button
            type="button"
            className="cta secondary"
            onClick={restoreHiddenCards}
          >
            Restore {hiddenIds.size} hidden
          </button>
        )}
      </div>

      {error && <p className="err">{error}</p>}

      {rows && (
        <section className="results">
          <h2>Results</h2>
          {matchLogId && (
            <p className="meta">Match log: data/runs/{matchLogId}.json</p>
          )}
          {rows.map((r) => (
            <article key={r.id} className="row">
              <div className="row-head">
                {r.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt="" className="mini" />
                )}
                <div>
                  <strong>
                    {r.label}
                    {r.confirmed ? " · locked" : ""}
                    {r.soldByWeight && r.grams
                      ? ` · ${r.grams} g`
                      : ""}
                  </strong>
                  <div className="badge">
                    {r.cheaper === "walmart"
                      ? "Walmart cheaper"
                      : r.cheaper === "nofrills"
                        ? "No Frills cheaper"
                        : r.cheaper === "tie"
                          ? "Tie"
                          : "Incomplete"}
                    {r.delta != null && r.cheaper !== "tie"
                      ? ` · Δ $${Math.abs(r.delta).toFixed(2)}`
                      : ""}
                    {r.fairLabel ? ` · ${r.fairLabel}` : ""}
                  </div>
                </div>
              </div>
              <div className="cols">
                <Side title="Walmart" side={r.walmart} grams={r.grams} />
                <Side title="No Frills" side={r.noFrills} grams={r.grams} />
              </div>
            </article>
          ))}

          {totals && totals.completeCount > 0 && (
            <div className="totals">
              <div>
                Walmart basket: <strong>${totals.walmart.toFixed(2)}</strong>
              </div>
              <div>
                No Frills basket: <strong>${totals.noFrills.toFixed(2)}</strong>
              </div>
              <div className="winner">
                {totals.cheaper === "walmart"
                  ? "Cheaper overall: Walmart"
                  : totals.cheaper === "nofrills"
                    ? "Cheaper overall: No Frills"
                    : "Overall: tie"}
              </div>
              {totals.note && <div className="tiny mute">{totals.note}</div>}
            </div>
          )}
        </section>
      )}

      {logPreview && (
        <section className="log">
          <h2>Останній лог матчів</h2>
          <pre>{JSON.stringify(logPreview, null, 2)}</pre>
        </section>
      )}

      <style jsx>{`
        .staples {
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
          color: #1c1914;
          max-width: 960px;
          margin: 0 auto;
          padding: 1.5rem 1rem 3rem;
        }
        .hero {
          padding: 1.25rem 0 1.5rem;
        }
        .brand {
          margin: 0;
          font-size: 0.75rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          font-weight: 700;
          color: #2f4a3a;
        }
        h1 {
          margin: 0.35rem 0 0.4rem;
          font-size: clamp(1.8rem, 4vw, 2.4rem);
          font-family: Georgia, "Iowan Old Style", serif;
          font-weight: 600;
        }
        .sub {
          margin: 0;
          opacity: 0.8;
          max-width: 40rem;
        }
        .meta {
          margin: 0.5rem 0 0;
          font-size: 0.8rem;
          opacity: 0.55;
        }
        .empty-grid {
          grid-column: 1 / -1;
          margin: 0.5rem 0 0;
          font-size: 0.9rem;
          opacity: 0.7;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
          gap: 0.75rem;
        }
        .card {
          border: 1px solid rgba(40, 50, 40, 0.15);
          background: rgba(255, 252, 246, 0.72);
          position: relative;
          overflow: hidden;
        }
        .card.on {
          outline: 2px solid #2f4a3a;
          background: #fffdf8;
        }
        .card-main {
          display: block;
          width: 100%;
          text-align: left;
          border: 0;
          background: transparent;
          padding: 0;
          cursor: pointer;
          color: inherit;
        }
        .thumb {
          aspect-ratio: 1;
          background: #e9e4da;
          overflow: hidden;
          position: relative;
        }
        .sale-bang {
          position: absolute;
          right: 0.4rem;
          bottom: 0.4rem;
          z-index: 2;
          width: 1.55rem;
          height: 1.55rem;
          border-radius: 2px;
          background: #c43c1a;
          color: #fff;
          font-weight: 800;
          font-size: 1.15rem;
          line-height: 1;
          display: grid;
          place-items: center;
          box-shadow: 0 1px 4px rgba(40, 20, 10, 0.28);
        }
        .sale-mark {
          margin-left: 0.2rem;
          color: #c43c1a;
          font-weight: 800;
          font-size: 1.05rem;
          line-height: 1;
        }
        .was {
          margin-left: 0.3rem;
          color: #8a6a62;
          font-weight: 500;
          text-decoration: line-through;
        }
        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .ph {
          height: 100%;
          display: grid;
          place-items: center;
          opacity: 0.5;
          font-size: 0.85rem;
        }
        .body {
          padding: 0.55rem 0.6rem 0.35rem;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .body strong {
          font-size: 0.88rem;
          line-height: 1.25;
        }
        .pill {
          align-self: flex-start;
          font-size: 0.68rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.12rem 0.35rem;
          background: #e6e0d4;
        }
        .pill.ok {
          background: #d5e6d8;
        }
        .pill.stale {
          background: #efe3b8;
        }
        .pill.unavailable,
        .pill.no_match {
          background: #e8e4de;
        }
        .pill.wrong_pack,
        .pill.wrong_size,
        .pill.rejected {
          background: #ecd5d0;
        }
        .pill.cheapest {
          background: #d7e4ef;
          text-transform: none;
          letter-spacing: 0.02em;
        }
        .price {
          font-size: 0.8rem;
          color: #2f4a3a;
        }
        .sku {
          font-size: 0.72rem;
          line-height: 1.25;
          color: #3a4038;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .unitprice {
          font-size: 0.72rem;
          color: #2f4a3a;
          font-weight: 600;
        }
        .age,
        .reason {
          font-size: 0.72rem;
          opacity: 0.65;
          line-height: 1.25;
        }
        .mute {
          opacity: 0.55;
        }
        .check {
          position: absolute;
          top: 0.4rem;
          right: 0.45rem;
          width: 1.35rem;
          height: 1.35rem;
          background: #2f4a3a;
          color: #fff;
          display: grid;
          place-items: center;
          font-size: 0.85rem;
          opacity: 0;
        }
        .card.on .check {
          opacity: 1;
        }
        .hide-card {
          position: absolute;
          top: 0.35rem;
          left: 0.35rem;
          z-index: 2;
          width: 1.45rem;
          height: 1.45rem;
          border: 0;
          border-radius: 2px;
          background: rgba(40, 30, 28, 0.72);
          color: #fff;
          font-size: 1.15rem;
          line-height: 1;
          cursor: pointer;
          display: grid;
          place-items: center;
          padding: 0;
        }
        .hide-card:hover {
          background: #8b2e2e;
        }
        .votes {
          display: flex;
          gap: 0.35rem;
          padding: 0 0.5rem 0.55rem;
        }
        .votes button {
          border: 1px solid rgba(30, 40, 30, 0.2);
          background: #fff;
          cursor: pointer;
          padding: 0.2rem 0.45rem;
          font-size: 0.85rem;
        }
        .grams {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.35rem;
          padding: 0 0.55rem 0.45rem;
          font-size: 0.75rem;
        }
        .grams input {
          width: 5.2rem;
          border: 1px solid rgba(30, 40, 30, 0.25);
          background: #fff;
          padding: 0.28rem 0.4rem;
          font-size: 0.85rem;
        }
        .grams-est {
          flex-basis: 100%;
          font-size: 0.72rem;
          color: #2f4a3a;
          font-weight: 600;
        }
        .actions {
          margin: 1.25rem 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .cta {
          background: #1f3d2f;
          color: #f6f1e7;
          border: 0;
          padding: 0.85rem 1.25rem;
          font-size: 1rem;
          cursor: pointer;
        }
        .cta.secondary {
          background: transparent;
          color: #1f3d2f;
          border: 1px solid #1f3d2f;
        }
        .cta:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .err {
          color: #8b1e1e;
        }
        .results {
          margin-top: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }
        h2 {
          font-family: Georgia, serif;
          margin: 0 0 0.25rem;
        }
        .row {
          border-top: 1px solid rgba(30, 40, 30, 0.18);
          padding-top: 0.85rem;
        }
        .row-head {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-bottom: 0.55rem;
        }
        .mini {
          width: 52px;
          height: 52px;
          object-fit: cover;
        }
        .badge {
          font-size: 0.8rem;
          opacity: 0.75;
        }
        .cols {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }
        .store {
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.6;
        }
        .big {
          font-size: 1.35rem;
          font-weight: 650;
          margin: 0.15rem 0;
        }
        .tiny {
          font-size: 0.78rem;
          line-height: 1.3;
        }
        .unit {
          font-size: 0.72rem;
          color: #2f4a3a;
          margin-top: 0.15rem;
        }
        .totals {
          margin-top: 0.5rem;
          padding: 1rem;
          background: rgba(47, 74, 58, 0.08);
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .winner {
          margin-top: 0.25rem;
          font-weight: 650;
          color: #2f4a3a;
        }
        .log {
          margin-top: 1.5rem;
        }
        .log pre {
          overflow: auto;
          max-height: 320px;
          font-size: 0.72rem;
          background: rgba(0, 0, 0, 0.04);
          padding: 0.75rem;
        }
      `}</style>
    </div>
  );
}

function Side({
  title,
  side,
  grams,
}: {
  title: string;
  side: SideResult;
  grams?: number | null;
}) {
  const usable =
    side.lineTotal != null &&
    (side.status === "ok" || side.status === "stale" || !side.status);
  const byWeight = side.nativeUnitPrice != null && side.nativeUnit != null;
  const scaled =
    grams != null &&
    grams > 0 &&
    side.pricePerKg != null &&
    (side.status === "ok" || side.status === "stale" || !side.status)
      ? side.pricePerKg * (grams / 1000)
      : null;
  const primary =
    scaled != null
      ? scaled
      : byWeight
        ? side.nativeUnitPrice!
        : (side.lineTotal ?? null);
  const unitLabel =
    scaled != null
      ? `за ${grams} g`
      : byWeight
        ? (side.nativeUnitLabel ?? side.compareUnitLabel ?? null)
        : (side.compareUnitLabel ?? null);
  const otherUnit =
    byWeight && side.nativeUnit === "kg" && side.pricePerLb != null
      ? `= $${side.pricePerLb.toFixed(2)} / lb`
      : byWeight && side.nativeUnit === "lb" && side.pricePerKg != null
        ? `= $${side.pricePerKg.toFixed(2)} / kg`
        : null;

  return (
    <div>
      <span className="store">{title}</span>
      <div>
        <span className={`pill ${side.status ?? "no_match"}`}>
          {statusLabel(side.status)}
        </span>
      </div>
      {usable && primary != null ? (
        <>
          <div className="big">${primary.toFixed(2)}</div>
          {unitLabel && <div className="unit">{unitLabel}</div>}
          {otherUnit && <div className="tiny mute">{otherUnit}</div>}
          {byWeight &&
            side.shelfPrice != null &&
            side.nativeUnitPrice != null &&
            Math.abs(side.shelfPrice - side.nativeUnitPrice) > 0.005 && (
              <div className="tiny mute">
                полиця ${side.shelfPrice.toFixed(2)}
              </div>
            )}
          {side.name && <div className="tiny">{side.name}</div>}
          {side.note && <div className="tiny mute">{side.note}</div>}
          {side.ageLabel && (
            <div className="tiny mute">
              {"\u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
              {side.ageLabel}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mute">немає порівнянної ціни</div>
          {side.statusReason && (
            <div className="tiny mute">{side.statusReason}</div>
          )}
          {side.name && <div className="tiny mute">saw: {side.name}</div>}
        </>
      )}
      <style jsx>{`
        .store {
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.6;
        }
        .pill {
          display: inline-block;
          font-size: 0.68rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.12rem 0.35rem;
          background: #e6e0d4;
          margin: 0.25rem 0;
        }
        .pill.ok {
          background: #d5e6d8;
        }
        .pill.stale {
          background: #efe3b8;
        }
        .pill.wrong_pack,
        .pill.wrong_size,
        .pill.rejected {
          background: #ecd5d0;
        }
        .big {
          font-size: 1.35rem;
          font-weight: 650;
          margin: 0.15rem 0;
        }
        .unit {
          font-size: 0.78rem;
          font-weight: 650;
          color: #2f4a3a;
        }
        .tiny {
          font-size: 0.78rem;
          line-height: 1.3;
        }
        .mute {
          opacity: 0.55;
        }
      `}</style>
    </div>
  );
}

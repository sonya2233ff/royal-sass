"use client";

import { useEffect, useId, useRef, useState } from "react";

type StapleHit = {
  id: string;
  label: string;
  image: string | null;
  wmName?: string | null;
  nfName?: string | null;
  wmPrice?: number | null;
  nfPrice?: number | null;
};

type StoreHit = {
  retailer: "walmart_ca" | "no_frills";
  productId: string;
  name: string;
  price: number;
  packageSize?: string;
  sourceUrl?: string;
  image?: string | null;
  onSale?: boolean;
  wasPrice?: number;
  stapleId?: string | null;
};

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  onPickStaple: (id: string) => void;
  onAdopted: (id: string) => void;
};

export function ProductSearch({
  query,
  onQueryChange,
  onPickStaple,
  onAdopted,
}: Props) {
  const boxId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [staples, setStaples] = useState<StapleHit[]>([]);
  const [walmart, setWalmart] = useState<StoreHit[]>([]);
  const [noFrills, setNoFrills] = useState<StoreHit[]>([]);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setStaples([]);
      setWalmart([]);
      setNoFrills([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/staples/search?q=${encodeURIComponent(q)}`, {
        signal: ac.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data.ok) throw new Error(data.error ?? "search failed");
          setStaples(data.staples ?? []);
          setWalmart(data.walmart ?? []);
          setNoFrills(data.noFrills ?? []);
          if (data.walmartSourceWarning && !(data.walmart ?? []).length) {
            setErr(
              "WM пошук через RapidAPI вимкнено — немає ключа. No Frills нижче.",
            );
          }
          setOpen(true);
          setActive(0);
        })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => setLoading(false));
    }, 350);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const rows: Array<
    | { kind: "staple"; hit: StapleHit }
    | { kind: "store"; hit: StoreHit }
  > = [
    ...staples.map((hit) => ({ kind: "staple" as const, hit })),
    ...walmart.map((hit) => ({ kind: "store" as const, hit })),
    ...noFrills.map((hit) => ({ kind: "store" as const, hit })),
  ];

  async function adopt(hit: StoreHit) {
    if (hit.stapleId) {
      onPickStaple(hit.stapleId);
      setOpen(false);
      return;
    }
    setAdopting(true);
    setErr(null);
    try {
      const res = await fetch("/api/staples/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hit),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "adopt failed");
      onAdopted(data.id);
      onQueryChange("");
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAdopting(false);
    }
  }

  function choose(i: number) {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "staple") {
      onPickStaple(row.hit.id);
      setOpen(false);
      return;
    }
    void adopt(row.hit);
  }

  const showPanel =
    open && query.trim().length >= 2 && (loading || rows.length > 0 || err);

  return (
    <div className="product-search" ref={wrapRef}>
      <label className="search-label" htmlFor={boxId}>
        Пошук продукту
      </label>
      <div className="search-row">
        <input
          id={boxId}
          type="search"
          autoComplete="off"
          placeholder="Назва або посилання Walmart…"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          onKeyDown={(e) => {
            if (!showPanel) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((n) => Math.min(n + 1, Math.max(rows.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((n) => Math.max(n - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {(loading || adopting) && <span className="search-spin">…</span>}
      </div>
      {showPanel && (
        <div className="search-panel" role="listbox">
          {err && <div className="search-err">{err}</div>}
          {adopting && <div className="search-hint">Додаю в список…</div>}
          {staples.length > 0 && (
            <div className="search-sec">У списку</div>
          )}
          {staples.map((hit, i) => (
            <button
              key={`s-${hit.id}`}
              type="button"
              role="option"
              className={active === i ? "search-hit on" : "search-hit"}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {hit.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hit.image} alt="" />
              ) : (
                <span className="ph" />
              )}
              <span>
                <strong>{hit.label}</strong>
                <em>
                  {hit.wmPrice != null ? `WM $${hit.wmPrice.toFixed(2)}` : ""}
                  {hit.wmPrice != null && hit.nfPrice != null ? " · " : ""}
                  {hit.nfPrice != null ? `NF $${hit.nfPrice.toFixed(2)}` : ""}
                </em>
              </span>
            </button>
          ))}
          {walmart.length > 0 && <div className="search-sec">Walmart</div>}
          {walmart.map((hit, i) => {
            const idx = staples.length + i;
            return (
              <button
                key={`w-${hit.productId}`}
                type="button"
                role="option"
                className={active === idx ? "search-hit on" : "search-hit"}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(idx)}
              >
                {hit.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hit.image} alt="" />
                ) : (
                  <span className="ph" />
                )}
                <span>
                  <strong>{hit.name}</strong>
                  <em>
                    ${hit.price.toFixed(2)}
                    {hit.packageSize ? ` · ${hit.packageSize}` : ""}
                    {hit.stapleId ? " · уже в списку" : " · додати"}
                  </em>
                </span>
              </button>
            );
          })}
          {noFrills.length > 0 && <div className="search-sec">No Frills</div>}
          {noFrills.map((hit, i) => {
            const idx = staples.length + walmart.length + i;
            return (
              <button
                key={`n-${hit.productId}`}
                type="button"
                role="option"
                className={active === idx ? "search-hit on" : "search-hit"}
                onMouseEnter={() => setActive(idx)}
                onClick={() => choose(idx)}
              >
                {hit.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hit.image} alt="" />
                ) : (
                  <span className="ph" />
                )}
                <span>
                  <strong>{hit.name}</strong>
                  <em>
                    ${hit.price.toFixed(2)}
                    {hit.packageSize ? ` · ${hit.packageSize}` : ""}
                    {hit.stapleId ? " · уже в списку" : " · додати"}
                  </em>
                </span>
              </button>
            );
          })}
          {!loading && rows.length === 0 && !err && (
            <div className="search-hint">Нічого не знайдено</div>
          )}
        </div>
      )}
      <style jsx>{`
        .product-search {
          position: relative;
          margin: 1rem 0 0;
          max-width: 36rem;
        }
        .search-label {
          display: block;
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 700;
          color: #2f4a3a;
          margin-bottom: 0.3rem;
        }
        .search-row {
          position: relative;
        }
        input {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid rgba(40, 50, 40, 0.22);
          background: #fffdf8;
          padding: 0.65rem 2rem 0.65rem 0.75rem;
          font: inherit;
          font-size: 1rem;
          color: inherit;
        }
        input:focus {
          outline: 2px solid #2f4a3a;
          outline-offset: 1px;
        }
        .search-spin {
          position: absolute;
          right: 0.7rem;
          top: 50%;
          transform: translateY(-50%);
          opacity: 0.55;
        }
        .search-panel {
          position: absolute;
          z-index: 20;
          left: 0;
          right: 0;
          top: calc(100% + 0.25rem);
          max-height: 22rem;
          overflow: auto;
          background: #fffdf8;
          border: 1px solid rgba(40, 50, 40, 0.18);
          box-shadow: 0 8px 24px rgba(40, 30, 20, 0.12);
        }
        .search-sec {
          padding: 0.4rem 0.7rem 0.2rem;
          font-size: 0.68rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-weight: 700;
          color: #2f4a3a;
          background: #f3eee4;
        }
        .search-hit {
          display: grid;
          grid-template-columns: 2.4rem 1fr;
          gap: 0.55rem;
          align-items: center;
          width: 100%;
          text-align: left;
          border: 0;
          border-bottom: 1px solid rgba(40, 50, 40, 0.08);
          background: transparent;
          padding: 0.45rem 0.65rem;
          cursor: pointer;
          color: inherit;
          font: inherit;
        }
        .search-hit.on {
          background: #e7efe8;
        }
        .search-hit img,
        .search-hit .ph {
          width: 2.4rem;
          height: 2.4rem;
          object-fit: cover;
          background: #e9e4da;
          display: block;
        }
        .search-hit strong {
          display: block;
          font-size: 0.86rem;
          line-height: 1.25;
        }
        .search-hit em {
          display: block;
          font-style: normal;
          font-size: 0.75rem;
          opacity: 0.7;
          margin-top: 0.1rem;
        }
        .search-hint,
        .search-err {
          padding: 0.55rem 0.7rem;
          font-size: 0.82rem;
        }
        .search-err {
          color: #8a2f22;
        }
      `}</style>
    </div>
  );
}

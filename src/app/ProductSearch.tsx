"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  searchShownCatalog,
  type CatalogSearchItem,
} from "@/domain/staple-search";

export type CatalogSearchHit = CatalogSearchItem & {
  image?: string | null;
  wmPrice?: number | null;
  nfPrice?: number | null;
  wcPrice?: number | null;
  mvrPrice?: number | null;
};

type Props = {
  query: string;
  onQueryChange: (q: string) => void;
  onPickStaple: (id: string) => void;
  catalog: CatalogSearchHit[];
  catalogReady?: boolean;
};

function priceLine(hit: CatalogSearchHit): string {
  const bits: string[] = [];
  if (hit.wmPrice != null) bits.push(`WM $${hit.wmPrice.toFixed(2)}`);
  if (hit.nfPrice != null) bits.push(`NF $${hit.nfPrice.toFixed(2)}`);
  if (hit.wcPrice != null) bits.push(`WC $${hit.wcPrice.toFixed(2)}`);
  if (hit.mvrPrice != null) bits.push(`MVR $${hit.mvrPrice.toFixed(2)}`);
  return bits.join(" · ");
}

export function ProductSearch({
  query,
  onQueryChange,
  onPickStaple,
  catalog,
  catalogReady = true,
}: Props) {
  const boxId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const staples = useMemo(
    () => (catalogReady ? searchShownCatalog(catalog, query, 12) : []),
    [catalog, catalogReady, query],
  );

  useEffect(() => {
    setActive(0);
  }, [query, staples.length]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(i: number) {
    const hit = staples[i];
    if (!hit) return;
    onPickStaple(hit.id);
    setOpen(false);
  }

  const q = query.trim();
  const showPanel = open && q.length >= 2;

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
          placeholder="Назва зі списку кафе…"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q.length >= 2 && setOpen(true)}
          onKeyDown={(e) => {
            if (!showPanel) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((n) => Math.min(n + 1, Math.max(staples.length - 1, 0)));
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
      </div>
      {showPanel && (
        <div className="search-panel" role="listbox">
          {!catalogReady && (
            <div className="search-hint">Завантаження каталогу…</div>
          )}
          {catalogReady && staples.length > 0 && (
            <div className="search-sec">У списку</div>
          )}
          {catalogReady &&
            staples.map((hit, i) => (
              <button
                key={`s-${hit.id}`}
                type="button"
                role="option"
                aria-selected={active === i}
                className={active === i ? "search-hit on" : "search-hit"}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {hit.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hit.image} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span className="ph" />
                )}
                <span>
                  <strong>{hit.label}</strong>
                  <em>{priceLine(hit)}</em>
                </span>
              </button>
            ))}
          {catalogReady && staples.length === 0 && (
            <div className="search-hint">У списку немає такого продукту</div>
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
        .search-hint {
          padding: 0.55rem 0.7rem;
          font-size: 0.82rem;
        }
      `}</style>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

type ProbeOffer = {
  productId: string;
  name: string;
  brand?: string;
  price: number;
  unitPrice?: number;
  packageSize?: string;
  availability?: string;
  confidence?: string;
  sourceUrl?: string;
};

type ProbeResponse = {
  ok: boolean;
  query?: string;
  storeId?: string;
  httpStatus?: number | null;
  originTried?: string | null;
  mappedCount?: number;
  tileCount?: number;
  ms?: number;
  error?: string;
  offers?: ProbeOffer[];
  rawTiles?: unknown[];
  bodyPreview?: string;
  tip?: string;
};

export default function NoFrillsProbePage() {
  const [q, setQ] = useState("bananas");
  const [storeId, setStoreId] = useState("3660");
  const [raw, setRaw] = useState(true);
  const [data, setData] = useState<ProbeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const url = new URL("/api/staples/nofrills-probe", window.location.origin);
        url.searchParams.set("q", q.trim());
        url.searchParams.set("storeId", storeId.trim() || "3660");
        if (raw) url.searchParams.set("raw", "1");
        const res = await fetch(url.toString());
        const json = (await res.json()) as ProbeResponse;
        setData(json);
        if (!json.ok && json.error) setError(json.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <main className="wrap">
      <header>
        <p className="eyebrow">
          <a href="/dev/match-inspector">match inspector</a>
        </p>
        <h1>No Frills API probe</h1>
        <p className="sub">
          Живий PCX search для store #{storeId || "3660"}. Дивись mapped price vs
          rawTiles.pricing якщо щось підозріле.
        </p>
      </header>

      <form
        className="bar"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label>
          Query
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="mehadrin milk / bananas / egg whites"
            autoFocus
          />
        </label>
        <label className="narrow">
          Store
          <input
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            placeholder="3660"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={raw}
            onChange={(e) => setRaw(e.target.checked)}
          />
          raw tiles
        </label>
        <button type="submit" disabled={pending || !q.trim()}>
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="err">{error}</p>}

      {data && (
        <section className="meta">
          <span>HTTP {data.httpStatus ?? "—"}</span>
          <span>{data.ms ?? "—"} ms</span>
          <span>
            tiles {data.tileCount ?? 0} → mapped {data.mappedCount ?? 0}
          </span>
          <span>{data.originTried ?? ""}</span>
        </section>
      )}

      {data?.offers && data.offers.length > 0 && (
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Price</th>
                <th>Unit</th>
                <th>Pack</th>
                <th>Id</th>
              </tr>
            </thead>
            <tbody>
              {data.offers.map((o) => (
                <tr key={o.productId}>
                  <td>
                    {o.sourceUrl ? (
                      <a href={o.sourceUrl} target="_blank" rel="noreferrer">
                        {o.name}
                      </a>
                    ) : (
                      o.name
                    )}
                    {o.brand ? <div className="muted">{o.brand}</div> : null}
                  </td>
                  <td>${o.price.toFixed(2)}</td>
                  <td>
                    {o.unitPrice != null ? `$${o.unitPrice.toFixed(2)}` : "—"}
                  </td>
                  <td>{o.packageSize ?? "—"}</td>
                  <td className="mono">{o.productId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data?.rawTiles && (
        <details open className="raw">
          <summary>rawTiles ({data.rawTiles.length})</summary>
          <pre>{JSON.stringify(data.rawTiles, null, 2)}</pre>
        </details>
      )}

      {data?.bodyPreview && (
        <details className="raw">
          <summary>bodyPreview</summary>
          <pre>{data.bodyPreview}</pre>
        </details>
      )}

      <p className="hint">
        CLI:{" "}
        <code>npm run probe:nofrills -- &quot;bananas&quot;</code>
        {" · "}
        API:{" "}
        <code>/api/staples/nofrills-probe?q=bananas&amp;raw=1</code>
      </p>

      <style jsx>{`
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 20px 60px;
          font-family: "Segoe UI", system-ui, sans-serif;
          color: #1c241c;
        }
        .eyebrow a {
          color: #3d5a3d;
          text-decoration: none;
          font-size: 0.85rem;
        }
        h1 {
          margin: 6px 0 8px;
          font-size: 1.7rem;
        }
        .sub {
          margin: 0 0 18px;
          color: #4a564a;
          max-width: 52rem;
        }
        .bar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: end;
          margin-bottom: 16px;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 0.8rem;
          color: #4a564a;
          flex: 1;
          min-width: 180px;
        }
        label.narrow {
          flex: 0 0 110px;
          min-width: 90px;
        }
        label.check {
          flex: 0;
          flex-direction: row;
          align-items: center;
          gap: 8px;
          padding-bottom: 10px;
        }
        input[type="text"],
        input:not([type]) {
          border: 1px solid #c5d0c5;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 1rem;
          background: #fff;
        }
        button {
          border: 0;
          border-radius: 8px;
          padding: 11px 18px;
          background: #2f4f2f;
          color: #fff;
          font-weight: 600;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .err {
          color: #8b1e1e;
          background: #fdeeee;
          padding: 10px 12px;
          border-radius: 8px;
        }
        .meta {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 0.85rem;
          color: #4a564a;
          margin-bottom: 14px;
        }
        .table-wrap {
          overflow: auto;
          border: 1px solid #d5ddd5;
          border-radius: 10px;
          background: #fff;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.92rem;
        }
        th,
        td {
          text-align: left;
          padding: 10px 12px;
          border-bottom: 1px solid #e6ebe6;
          vertical-align: top;
        }
        th {
          background: #f3f6f3;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #556055;
        }
        .mono {
          font-family: ui-monospace, Consolas, monospace;
          font-size: 0.8rem;
        }
        .muted {
          color: #6a766a;
          font-size: 0.8rem;
        }
        a {
          color: #1f4d1f;
        }
        .raw {
          margin-top: 16px;
          background: #121812;
          color: #d7e6d7;
          border-radius: 10px;
          padding: 10px 12px;
        }
        .raw summary {
          cursor: pointer;
          margin-bottom: 8px;
        }
        pre {
          margin: 0;
          overflow: auto;
          max-height: 420px;
          font-size: 0.78rem;
          line-height: 1.35;
        }
        .hint {
          margin-top: 22px;
          color: #5a665a;
          font-size: 0.85rem;
        }
        code {
          background: #e8eee8;
          padding: 2px 6px;
          border-radius: 4px;
        }
      `}</style>
    </main>
  );
}

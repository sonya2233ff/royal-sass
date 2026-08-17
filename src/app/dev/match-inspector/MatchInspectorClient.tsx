"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

type FieldScores = {
  name: number;
  brand: number;
  size: number;
  category: number;
  queryFit: number | null;
  structuredTotal: number;
};

type Explain = { stage: string; score: number; reason: string };

type Candidate = {
  retailer: "walmart_ca" | "no_frills";
  storeId: string;
  retailerProductId: string;
  name: string;
  brand?: string;
  currentPrice: number;
  priceSource: string;
  lastChecked: string | null;
  matchMethod: string;
  confidence: number;
  decision: string;
  status: "selected" | "rejected" | "candidate";
  mappingStatus: string;
  filterReason: string | null;
  fieldScores: FieldScores;
  explain: Explain[];
  queryFitScore: number | null;
  winner: boolean;
  normalized: unknown;
  raw?: unknown;
};

type InspectResult = {
  ok: boolean;
  originalQuery: string;
  normalizedQuery: string;
  queryTokens: string[];
  stapleId: string | null;
  stapleLabel: string | null;
  live: boolean;
  walmartSource: string;
  errors?: Partial<Record<"walmart_ca" | "no_frills", string>>;
  candidates: Candidate[];
  error?: string;
};

type StapleOpt = { id: string; label: string; queries: string[] };

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function pct(n: number) {
  return n.toFixed(2);
}

export function MatchInspectorClient() {
  const [query, setQuery] = useState("grape tomatoes");
  const [stapleId, setStapleId] = useState("");
  const [live, setLive] = useState(true);
  const [includeRaw, setIncludeRaw] = useState(true);
  const [retailers, setRetailers] = useState({
    walmart_ca: true,
    no_frills: true,
  });
  const [staples, setStaples] = useState<StapleOpt[]>([]);
  const [data, setData] = useState<InspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRaw, setOpenRaw] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mappingBusy, setMappingBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dev/match-inspector")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setStaples(j.staples ?? []);
      })
      .catch(() => undefined);
  }, []);

  function selectedRetailers() {
    const out: Array<"walmart_ca" | "no_frills"> = [];
    if (retailers.walmart_ca) out.push("walmart_ca");
    if (retailers.no_frills) out.push("no_frills");
    return out;
  }

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/dev/match-inspector", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: query.trim() || undefined,
            stapleId: stapleId || undefined,
            retailers: selectedRetailers(),
            live,
            includeRaw,
          }),
        });
        const json = (await res.json()) as InspectResult;
        setData(json);
        if (!json.ok) setError(json.error ?? "inspect failed");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function mapAction(
    action: "approve" | "reject",
    c: Candidate,
  ) {
    if (!stapleId) {
      setError("Pick a staple id before approve/reject — mappings are keyed by cafe staple id.");
      return;
    }
    setMappingBusy(`${action}:${c.retailerProductId}`);
    setError(null);
    try {
      const res = await fetch("/api/dev/match-inspector/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          stapleId,
          retailer: c.retailer,
          retailerProductId: c.retailerProductId,
          name: c.name,
          storeId: c.storeId,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "mapping failed");
        return;
      }
      run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMappingBusy(null);
    }
  }

  const grouped = useMemo(() => {
    const wm = data?.candidates.filter((c) => c.retailer === "walmart_ca") ?? [];
    const nf = data?.candidates.filter((c) => c.retailer === "no_frills") ?? [];
    return { wm, nf };
  }, [data]);

  return (
    <main className="wrap">
      <header>
        <p className="eyebrow">
          <a href="/">← staples</a>
          {" · "}
          <a href="/nf-probe">NF probe</a>
          {" · "}
          <span className="badge">DEV ONLY</span>
        </p>
        <h1>Match inspector</h1>
        <p className="sub">
          Debug query → retailer candidates → entity scores. Approve/reject writes
          <code>retailer-mappings.json</code> only. Does not change the customer compare UI.
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="grape tomatoes / 20094120003_EA"
            autoFocus
          />
        </label>
        <label>
          Staple (mapping key)
          <select
            value={stapleId}
            onChange={(e) => {
              const id = e.target.value;
              setStapleId(id);
              const st = staples.find((s) => s.id === id);
              if (st?.queries[0] && !query.trim()) setQuery(st.queries[0]);
            }}
          >
            <option value="">— none —</option>
            {staples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={retailers.walmart_ca}
            onChange={(e) =>
              setRetailers((r) => ({ ...r, walmart_ca: e.target.checked }))
            }
          />
          WM #5831
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={retailers.no_frills}
            onChange={(e) =>
              setRetailers((r) => ({ ...r, no_frills: e.target.checked }))
            }
          />
          NF #3660
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
          />
          live search
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={includeRaw}
            onChange={(e) => setIncludeRaw(e.target.checked)}
          />
          raw JSON
        </label>
        <button type="submit" disabled={pending || selectedRetailers().length === 0}>
          {pending ? "Searching…" : data ? "Rerun search" : "Search"}
        </button>
      </form>

      {error && <p className="err">{error}</p>}

      {data && (
        <section className="query-box">
          <div>
            <span className="k">original query</span>
            <code>{data.originalQuery || "—"}</code>
          </div>
          <div>
            <span className="k">normalized query</span>
            <code>{data.normalizedQuery || "—"}</code>
          </div>
          <div>
            <span className="k">tokens</span>
            <code>{data.queryTokens.join(" · ") || "—"}</code>
          </div>
          <div>
            <span className="k">staple</span>
            <code>{data.stapleId ? `${data.stapleId} (${data.stapleLabel})` : "—"}</code>
          </div>
          <div>
            <span className="k">price path</span>
            <code>
              {data.live ? "live" : "catalog"} · WM {data.walmartSource}
            </code>
          </div>
        </section>
      )}

      {data?.errors?.walmart_ca && (
        <p className="err">Walmart: {data.errors.walmart_ca}</p>
      )}
      {data?.errors?.no_frills && (
        <p className="err">No Frills: {data.errors.no_frills}</p>
      )}

      {data && (
        <div className="cols">
          <RetailerColumn
            title="Walmart Supercentre #5831"
            rows={grouped.wm}
            openRaw={openRaw}
            setOpenRaw={setOpenRaw}
            mappingBusy={mappingBusy}
            stapleId={stapleId}
            onApprove={(c) => void mapAction("approve", c)}
            onReject={(c) => void mapAction("reject", c)}
          />
          <RetailerColumn
            title="No Frills Anthony’s #3660"
            rows={grouped.nf}
            openRaw={openRaw}
            setOpenRaw={setOpenRaw}
            mappingBusy={mappingBusy}
            stapleId={stapleId}
            onApprove={(c) => void mapAction("approve", c)}
            onReject={(c) => void mapAction("reject", c)}
          />
        </div>
      )}

      {data && (
        <details className="raw dump">
          <summary>inspect full response JSON</summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}

      <style jsx>{`
        .wrap {
          max-width: 1400px;
          margin: 0 auto;
          padding: 24px 16px 80px;
          font-family: "Segoe UI", system-ui, sans-serif;
          color: #1c241c;
          background: #f4f1ea;
          min-height: 100vh;
        }
        .eyebrow {
          margin: 0 0 6px;
          font-size: 0.85rem;
        }
        .eyebrow a {
          color: #3d5a3d;
          text-decoration: none;
        }
        .badge {
          background: #5c3d16;
          color: #fff;
          border-radius: 999px;
          padding: 1px 8px;
          font-size: 0.72rem;
          letter-spacing: 0.04em;
        }
        h1 {
          margin: 4px 0 8px;
          font-size: 1.65rem;
        }
        .sub {
          margin: 0 0 16px;
          color: #4a564a;
          max-width: 52rem;
        }
        .sub code {
          margin-left: 4px;
        }
        .bar {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: end;
          margin-bottom: 14px;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 0.78rem;
          color: #4a564a;
        }
        label:first-child {
          flex: 1;
          min-width: 220px;
        }
        input,
        select {
          border: 1px solid #c5d0c5;
          border-radius: 8px;
          padding: 9px 11px;
          font-size: 0.95rem;
          background: #fff;
        }
        label.check {
          flex-direction: row;
          align-items: center;
          gap: 6px;
          padding-bottom: 10px;
        }
        button {
          border: 0;
          border-radius: 8px;
          padding: 10px 16px;
          background: #2f4f2f;
          color: #fff;
          font-weight: 600;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .err {
          color: #8b1e1e;
          background: #fdeeee;
          padding: 10px 12px;
          border-radius: 8px;
        }
        .query-box {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 10px;
          background: #fff;
          border: 1px solid #d5ddd5;
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 16px;
        }
        .k {
          display: block;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #6a766a;
          margin-bottom: 3px;
        }
        code {
          background: #e8eee8;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.82rem;
        }
        .cols {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        @media (max-width: 960px) {
          .cols {
            grid-template-columns: 1fr;
          }
        }
        .raw.dump {
          margin-top: 18px;
          background: #121812;
          color: #d7e6d7;
          border-radius: 10px;
          padding: 10px 12px;
        }
        .raw.dump summary {
          cursor: pointer;
        }
        pre {
          margin: 8px 0 0;
          overflow: auto;
          max-height: 480px;
          font-size: 0.74rem;
          line-height: 1.35;
        }
      `}</style>
    </main>
  );
}

function RetailerColumn(props: {
  title: string;
  rows: Candidate[];
  openRaw: string | null;
  setOpenRaw: (id: string | null) => void;
  mappingBusy: string | null;
  stapleId: string;
  onApprove: (c: Candidate) => void;
  onReject: (c: Candidate) => void;
}) {
  return (
    <section className="col">
      <h2>
        {props.title}{" "}
        <span className="count">{props.rows.length}</span>
      </h2>
      {props.rows.length === 0 && <p className="empty">No candidates</p>}
      {props.rows.map((c) => {
        const key = `${c.retailer}:${c.retailerProductId}`;
        const rawOpen = props.openRaw === key;
        return (
          <article key={key} className={`card ${c.status}`}>
            <div className="top">
              <strong>{c.name}</strong>
              <span className={`st ${c.status}`}>{c.status}</span>
            </div>
            {c.brand ? <div className="muted">{c.brand}</div> : null}
            <dl>
              <dt>retailer product ID</dt>
              <dd className="mono">{c.retailerProductId}</dd>
              <dt>store ID</dt>
              <dd>{c.storeId}</dd>
              <dt>current price</dt>
              <dd>{money(c.currentPrice)}</dd>
              <dt>price source</dt>
              <dd>{c.priceSource}</dd>
              <dt>last checked</dt>
              <dd>{c.lastChecked ? new Date(c.lastChecked).toLocaleString() : "—"}</dd>
              <dt>match_method</dt>
              <dd>{c.matchMethod}</dd>
              <dt>confidence</dt>
              <dd>{pct(c.confidence)}</dd>
              <dt>entity decision</dt>
              <dd>
                {c.decision}
                {c.winner ? " · search winner" : ""}
                {c.mappingStatus !== "none" ? ` · mapping ${c.mappingStatus}` : ""}
              </dd>
              {c.filterReason ? (
                <>
                  <dt>filter</dt>
                  <dd className="bad">{c.filterReason}</dd>
                </>
              ) : null}
            </dl>
            <div className="scores">
              <span>name {pct(c.fieldScores.name)}</span>
              <span>brand {pct(c.fieldScores.brand)}</span>
              <span>size {pct(c.fieldScores.size)}</span>
              <span>category {pct(c.fieldScores.category)}</span>
              <span>
                queryFit{" "}
                {c.fieldScores.queryFit == null
                  ? "drop"
                  : pct(c.fieldScores.queryFit)}
              </span>
              <span>total {pct(c.fieldScores.structuredTotal)}</span>
            </div>
            <details className="explain">
              <summary>score breakdown ({c.explain.length})</summary>
              <ul>
                {c.explain.map((e, i) => (
                  <li key={`${e.stage}-${i}`}>
                    <code>{e.stage}</code> {e.reason}{" "}
                    <em>{pct(e.score)}</em>
                  </li>
                ))}
              </ul>
            </details>
            <div className="actions">
              <button
                type="button"
                disabled={!props.stapleId || props.mappingBusy != null}
                onClick={() => props.onApprove(c)}
              >
                {props.mappingBusy === `approve:${c.retailerProductId}`
                  ? "…"
                  : "Approve mapping"}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={!props.stapleId || props.mappingBusy != null}
                onClick={() => props.onReject(c)}
              >
                {props.mappingBusy === `reject:${c.retailerProductId}`
                  ? "…"
                  : "Reject candidate"}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => props.setOpenRaw(rawOpen ? null : key)}
              >
                {rawOpen ? "Hide JSON" : "Inspect raw JSON"}
              </button>
            </div>
            {rawOpen && (
              <div className="jsons">
                <details open>
                  <summary>normalized candidate</summary>
                  <pre>{JSON.stringify(c.normalized, null, 2)}</pre>
                </details>
                <details open>
                  <summary>raw retailer product</summary>
                  <pre>{JSON.stringify(c.raw ?? null, null, 2)}</pre>
                </details>
              </div>
            )}
          </article>
        );
      })}
      <style jsx>{`
              .col h2 {
                font-size: 1.05rem;
                margin: 0 0 10px;
              }
              .count {
                font-weight: 500;
                color: #6a766a;
                font-size: 0.85rem;
              }
              .empty {
                color: #6a766a;
              }
              .card {
                background: #fff;
                border: 1px solid #d5ddd5;
                border-radius: 10px;
                padding: 12px;
                margin-bottom: 10px;
              }
              .card.selected {
                border-color: #3d7a3d;
                box-shadow: 0 0 0 1px #3d7a3d33;
              }
              .card.rejected {
                opacity: 0.78;
                border-style: dashed;
              }
              .top {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                align-items: start;
              }
              .st {
                font-size: 0.72rem;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                padding: 2px 7px;
                border-radius: 999px;
                background: #e8eee8;
              }
              .st.selected {
                background: #d4ecd4;
                color: #1a4a1a;
              }
              .st.rejected {
                background: #f8dcdc;
                color: #6a1a1a;
              }
              .muted {
                color: #6a766a;
                font-size: 0.85rem;
                margin-bottom: 6px;
              }
              dl {
                display: grid;
                grid-template-columns: 9.5rem 1fr;
                gap: 3px 8px;
                margin: 8px 0;
                font-size: 0.84rem;
              }
              dt {
                color: #6a766a;
              }
              dd {
                margin: 0;
              }
              .mono {
                font-family: ui-monospace, Consolas, monospace;
                font-size: 0.78rem;
                word-break: break-all;
              }
              .bad {
                color: #8b1e1e;
              }
              .scores {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin: 8px 0;
              }
              .scores span {
                background: #eef3ee;
                border-radius: 6px;
                padding: 3px 7px;
                font-size: 0.75rem;
              }
              .explain {
                font-size: 0.82rem;
                margin: 6px 0;
              }
              .explain ul {
                margin: 6px 0 0;
                padding-left: 16px;
              }
              .actions {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 8px;
              }
              button {
                border: 0;
                border-radius: 7px;
                padding: 7px 10px;
                background: #2f4f2f;
                color: #fff;
                font-size: 0.8rem;
                cursor: pointer;
              }
              button.ghost {
                background: #fff;
                color: #2f4f2f;
                border: 1px solid #c5d0c5;
              }
              button:disabled {
                opacity: 0.45;
                cursor: default;
              }
              .jsons {
                margin-top: 8px;
                background: #121812;
                color: #d7e6d7;
                border-radius: 8px;
                padding: 8px;
              }
              .jsons summary {
                cursor: pointer;
                font-size: 0.8rem;
              }
              pre {
                overflow: auto;
                max-height: 280px;
                font-size: 0.72rem;
              }
            `}</style>
    </section>
  );
}

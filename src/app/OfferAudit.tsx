"use client";

import { COMPARE_STORES, type CompareStoreId } from "@/domain/compare-stores";
import {
  lookupOfferVerdict,
  type OfferAuditCell,
  type OfferVerdictMap,
  type OfferVerdictValue,
} from "@/domain/offer-verdicts";

export function OfferVerdictButtons({
  cell,
  map,
  onRate,
}: {
  cell: OfferAuditCell;
  map: OfferVerdictMap;
  onRate: (cell: OfferAuditCell, verdict: OfferVerdictValue) => void;
}) {
  const current = lookupOfferVerdict(map, cell)?.verdict ?? null;
  const empty = !cell.productId;
  return (
    <div className="verdict-btns" role="group" aria-label="Оцінка підбору">
      <button
        type="button"
        className={current === "yes" ? "v-btn yes on" : "v-btn yes"}
        aria-pressed={current === "yes"}
        title={empty ? "Правильно, що немає товару" : "Це правильний товар"}
        onClick={(e) => {
          e.stopPropagation();
          onRate(cell, "yes");
        }}
      >
        Так
      </button>
      <button
        type="button"
        className={current === "no" ? "v-btn no on" : "v-btn no"}
        aria-pressed={current === "no"}
        title={empty ? "Тут має бути товар" : "Підміна / не той продукт"}
        onClick={(e) => {
          e.stopPropagation();
          onRate(cell, "no");
        }}
      >
        Ні
      </button>
      <style jsx>{`
        .verdict-btns {
          display: flex;
          gap: 0.28rem;
        }
        .v-btn {
          flex: 1;
          border: 1px solid rgba(47, 74, 58, 0.28);
          background: #fff;
          color: #3d4a40;
          font: inherit;
          font-size: 0.78rem;
          font-weight: 750;
          padding: 0.28rem 0.35rem;
          cursor: pointer;
        }
        .v-btn.yes.on {
          background: #2f4a3a;
          color: #f7f3ec;
          border-color: #2f4a3a;
        }
        .v-btn.no.on {
          background: #8a3b1a;
          color: #fffdf8;
          border-color: #8a3b1a;
        }
      `}</style>
    </div>
  );
}

export function OfferAuditGrid({
  cells,
  map,
  onRate,
}: {
  cells: OfferAuditCell[];
  map: OfferVerdictMap;
  onRate: (cell: OfferAuditCell, verdict: OfferVerdictValue) => void;
}) {
  if (!cells.length) return null;
  return (
    <div className="audit-grid">
      {cells.map((cell) => {
        const store = COMPARE_STORES.find((s) => s.id === cell.store);
        const current = lookupOfferVerdict(map, cell)?.verdict ?? null;
        const empty = !cell.productId;
        return (
          <div
            key={cell.store}
            className={
              current === "yes"
                ? "audit-cell yes"
                : current === "no"
                  ? "audit-cell no"
                  : "audit-cell"
            }
          >
            <div className="audit-photo">
              {cell.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cell.image}
                  alt={cell.name || store?.short || cell.store}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="audit-ph">{empty ? "немає" : "без фото"}</div>
              )}
              <span className="audit-store">{store?.short ?? cell.store}</span>
            </div>
            <p className="audit-name">
              {empty
                ? "немає товару"
                : (cell.name || cell.productId || "без назви").slice(0, 80)}
            </p>
            {cell.price != null && cell.price > 0 ? (
              <p className="audit-price">${cell.price.toFixed(2)}</p>
            ) : null}
            <OfferVerdictButtons cell={cell} map={map} onRate={onRate} />
          </div>
        );
      })}
      <style jsx>{`
        .audit-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.4rem;
          padding: 0.35rem 0.45rem 0.5rem;
        }
        .audit-cell {
          border: 1px solid rgba(40, 50, 40, 0.14);
          background: #fff;
          padding: 0.3rem;
          display: flex;
          flex-direction: column;
          gap: 0.22rem;
        }
        .audit-cell.yes {
          outline: 2px solid #2f4a3a;
        }
        .audit-cell.no {
          outline: 2px solid #8a3b1a;
        }
        .audit-photo {
          position: relative;
          aspect-ratio: 1;
          background: #e9e4da;
          overflow: hidden;
        }
        .audit-photo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .audit-ph {
          height: 100%;
          display: grid;
          place-items: center;
          font-size: 0.72rem;
          color: #7a7468;
        }
        .audit-store {
          position: absolute;
          left: 0.25rem;
          top: 0.25rem;
          background: rgba(47, 74, 58, 0.92);
          color: #f7f3ec;
          font-size: 0.62rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          padding: 0.08rem 0.28rem;
        }
        .audit-name {
          margin: 0;
          font-size: 0.68rem;
          line-height: 1.25;
          min-height: 2.1em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .audit-price {
          margin: 0;
          font-size: 0.72rem;
          font-weight: 700;
          color: #2f4a3a;
        }
      `}</style>
    </div>
  );
}

export function storeOfferCell(
  stapleId: string,
  label: string,
  store: CompareStoreId,
  offer: {
    productId?: string | null;
    name?: string | null;
    image?: string | null;
    price?: number | null;
  } | null,
): OfferAuditCell {
  return {
    stapleId,
    label,
    store,
    productId: offer?.productId ?? null,
    name: offer?.name ?? null,
    image: offer?.image ?? null,
    price: offer?.price ?? null,
  };
}

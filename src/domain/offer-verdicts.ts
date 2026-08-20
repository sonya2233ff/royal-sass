/**
 * Operator yes/no on each store photo (match audit).
 * Not the WM 👍 identity lock. Empty cell: yes = correctly missing, no = hole
 * (still do not invent a SKU).
 */
import {
  COMPARE_STORE_IDS,
  isCompareStoreId,
  type CompareStoreId,
} from "@/domain/compare-stores";

export const OFFER_VERDICTS_KIND = "royal-sass-offer-verdicts-v1";

export type OfferVerdictValue = "yes" | "no";

export type OfferVerdict = {
  stapleId: string;
  label: string;
  store: CompareStoreId;
  verdict: OfferVerdictValue;
  /** True when the cell had no matched offer at rate time. */
  empty: boolean;
  productId: string;
  name: string;
  image: string | null;
  price: number | null;
  ratedAt: string;
};

export type OfferVerdictMap = Record<string, OfferVerdict>;

export type OfferVerdictPayload = {
  kind: typeof OFFER_VERDICTS_KIND;
  updatedAt: string;
  yes: number;
  no: number;
  emptyYes: number;
  emptyNo: number;
  verdicts: OfferVerdict[];
};

export type OfferAuditCell = {
  stapleId: string;
  label: string;
  store: CompareStoreId;
  productId: string | null;
  name: string | null;
  image: string | null;
  price: number | null;
};

export function offerVerdictKey(
  stapleId: string,
  store: CompareStoreId,
): string {
  return `${stapleId}::${store}`;
}

export function skuKey(productId: string | null | undefined): string {
  return String(productId ?? "").trim();
}

export function verdictAppliesToCell(
  row: OfferVerdict | null | undefined,
  cell: Pick<OfferAuditCell, "productId">,
): boolean {
  if (!row) return false;
  return row.productId === skuKey(cell.productId);
}

export function lookupOfferVerdict(
  map: OfferVerdictMap,
  cell: Pick<OfferAuditCell, "stapleId" | "store" | "productId">,
): OfferVerdict | null {
  const row = map[offerVerdictKey(cell.stapleId, cell.store)];
  return verdictAppliesToCell(row, cell) ? row : null;
}

function asTrimmed(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

function parseVerdictValue(raw: unknown): OfferVerdictValue | null {
  if (raw === "yes" || raw === true || raw === "так") return "yes";
  if (raw === "no" || raw === false || raw === "ні" || raw === "ni") return "no";
  return null;
}

export function parseOfferVerdict(raw: unknown): OfferVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const stapleId = asTrimmed(r.stapleId ?? r.id, 80);
  const storeRaw = asTrimmed(r.store, 32);
  if (!stapleId || !isCompareStoreId(storeRaw)) return null;
  const verdict = parseVerdictValue(r.verdict);
  if (!verdict) return null;
  const empty = r.empty === true;
  const productId = asTrimmed(r.productId, 80);
  const priceN = Number(r.price);
  return {
    stapleId,
    label: asTrimmed(r.label, 120) || stapleId,
    store: storeRaw,
    verdict,
    empty: empty || productId === "",
    productId,
    name: asTrimmed(r.name, 200),
    image: asTrimmed(r.image, 500) || null,
    price: Number.isFinite(priceN) && priceN > 0 ? priceN : null,
    ratedAt:
      asTrimmed(r.ratedAt, 40) ||
      asTrimmed(r.updatedAt, 40) ||
      new Date(0).toISOString(),
  };
}

export function parseOfferVerdictMap(raw: unknown): OfferVerdictMap {
  if (!raw) return {};
  if (typeof raw === "string") return parseOfferVerdictMapFromText(raw);
  if (Array.isArray(raw)) {
    const out: OfferVerdictMap = {};
    for (const row of raw) {
      const parsed = parseOfferVerdict(row);
      if (!parsed) continue;
      out[offerVerdictKey(parsed.stapleId, parsed.store)] = parsed;
    }
    return out;
  }
  if (typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  if (rec.kind === OFFER_VERDICTS_KIND || Array.isArray(rec.verdicts)) {
    return parseOfferVerdictMap(rec.verdicts);
  }
  if (rec.verdicts && typeof rec.verdicts === "object") {
    return parseOfferVerdictMap(rec.verdicts);
  }
  const out: OfferVerdictMap = {};
  for (const [key, value] of Object.entries(rec)) {
    if (key === "kind" || key === "updatedAt" || key === "yes" || key === "no") {
      continue;
    }
    const parsed = parseOfferVerdict(value);
    if (!parsed) continue;
    out[offerVerdictKey(parsed.stapleId, parsed.store)] = parsed;
  }
  return out;
}

/** Strip markdown fences so a pasted chat blob still parses. */
export function parseOfferVerdictMapFromText(text: string): OfferVerdictMap {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/u, "")
    .trim();
  try {
    return parseOfferVerdictMap(JSON.parse(unfenced) as unknown);
  } catch {
    return {};
  }
}

/** Overlay wins when it has a newer or equal ratedAt. */
export function mergeOfferVerdictMaps(
  base: OfferVerdictMap,
  overlay: OfferVerdictMap,
): OfferVerdictMap {
  const out: OfferVerdictMap = { ...base };
  for (const [key, row] of Object.entries(overlay)) {
    const prev = out[key];
    if (!prev || row.ratedAt >= prev.ratedAt) out[key] = row;
  }
  return out;
}

export function makeOfferVerdict(
  cell: OfferAuditCell,
  verdict: OfferVerdictValue,
  ratedAt = new Date().toISOString(),
): OfferVerdict {
  const productId = skuKey(cell.productId);
  return {
    stapleId: cell.stapleId,
    label: cell.label,
    store: cell.store,
    verdict,
    empty: productId === "",
    productId,
    name: String(cell.name ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    image: cell.image,
    price: cell.price != null && cell.price > 0 ? cell.price : null,
    ratedAt,
  };
}

export function toggleOfferVerdict(
  map: OfferVerdictMap,
  cell: OfferAuditCell,
  verdict: OfferVerdictValue,
): OfferVerdictMap {
  const key = offerVerdictKey(cell.stapleId, cell.store);
  const current = lookupOfferVerdict(map, cell);
  const next = { ...map };
  if (current?.verdict === verdict) {
    delete next[key];
    return next;
  }
  next[key] = makeOfferVerdict(cell, verdict);
  return next;
}

export function summarizeOfferVerdicts(map: OfferVerdictMap): {
  yes: number;
  no: number;
  emptyYes: number;
  emptyNo: number;
  total: number;
} {
  let yes = 0;
  let no = 0;
  let emptyYes = 0;
  let emptyNo = 0;
  for (const row of Object.values(map)) {
    if (row.verdict === "yes") {
      yes += 1;
      if (row.empty) emptyYes += 1;
    } else {
      no += 1;
      if (row.empty) emptyNo += 1;
    }
  }
  return { yes, no, emptyYes, emptyNo, total: yes + no };
}

export function offerVerdictPayload(
  map: OfferVerdictMap,
  updatedAt = new Date().toISOString(),
): OfferVerdictPayload {
  const summary = summarizeOfferVerdicts(map);
  const verdicts = Object.values(map).sort((a, b) =>
    a.stapleId === b.stapleId
      ? COMPARE_STORE_IDS.indexOf(a.store) - COMPARE_STORE_IDS.indexOf(b.store)
      : a.stapleId.localeCompare(b.stapleId),
  );
  return {
    kind: OFFER_VERDICTS_KIND,
    updatedAt,
    yes: summary.yes,
    no: summary.no,
    emptyYes: summary.emptyYes,
    emptyNo: summary.emptyNo,
    verdicts,
  };
}

export function countOfferAuditProgress(
  cells: OfferAuditCell[],
  map: OfferVerdictMap,
): { rated: number; total: number; no: number; unrated: number } {
  let rated = 0;
  let no = 0;
  for (const cell of cells) {
    const row = lookupOfferVerdict(map, cell);
    if (!row) continue;
    rated += 1;
    if (row.verdict === "no") no += 1;
  }
  const total = cells.length;
  return { rated, total, no, unrated: Math.max(0, total - rated) };
}

export function cellIsUnrated(
  cell: OfferAuditCell,
  map: OfferVerdictMap,
): boolean {
  return lookupOfferVerdict(map, cell) == null;
}

export function stapleHasUnratedStore(
  cells: OfferAuditCell[],
  map: OfferVerdictMap,
): boolean {
  return cells.some((cell) => cellIsUnrated(cell, map));
}

export function stapleHasNoVerdict(
  cells: OfferAuditCell[],
  map: OfferVerdictMap,
): boolean {
  return cells.some((cell) => lookupOfferVerdict(map, cell)?.verdict === "no");
}

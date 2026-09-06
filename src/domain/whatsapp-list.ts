/**
 * Driver “paste WhatsApp list” → existing cafe Master Products only.
 * Understands messy human text (qty, units, UA phonetic). Does not
 * create staples, rematch retailers, or invent prices.
 */
import { queryLooksLikeShellEggs } from "@/domain/egg-pack";
import { stripPackNoise } from "@/domain/pack-tokens";
import {
  fromBase,
  sameDimension,
  toBase,
  type AmountUnit,
} from "@/domain/purchase-units";
import {
  catalogSearchScore,
  stapleMatchesCatalogQuery,
  type CatalogSearchItem,
} from "@/domain/staple-search";
import type { WaiterTicketLine } from "@/domain/waiter-tickets";

export type WhatsAppCatalogItem = CatalogSearchItem & {
  unit?: AmountUnit;
  defaultAmount?: number;
  soldByWeight?: boolean;
  category?: string;
};

export type WhatsAppHint = {
  id: string;
  label: string;
  score: number;
};

export type WhatsAppDecision = {
  raw: string;
  query: string;
  qty: number;
  unit: AmountUnit;
  requestedAmount: number;
  status: "matched" | "unsure" | "unmatched";
  matchedId?: string;
  matchedLabel?: string;
  alternatives: WhatsAppHint[];
};

export type WhatsAppParseResult = {
  decisions: WhatsAppDecision[];
  skipped: string[];
};

export type WhatsAppConfirmLine = {
  id: string;
  label: string;
  qty: number;
  unit: AmountUnit;
  requestedAmount: number;
  note?: string;
};

const UNSURE_SCORE = 40;
const MAX_ALTERNATIVES = 6;
const MAX_LINES = 80;

const WHATSAPP_NOISE =
  /end-to-end encrypted|omitted|voice message|video omitted|image omitted|sticker|gif omitted|this message was deleted|messages and calls/i;

/** Cafe-relevant UA / phonetic English → catalog English. Not retailer titles. */
const GLOSS: ReadonlyArray<readonly [RegExp, string]> = [
  [/фрозен/gi, "frozen"],
  [/заморож\w*/gi, "frozen"],
  [/блупер[іиiй]?с\w*/gi, "blueberries"],
  [/блубер[іиi]\w*/gi, "blueberries"],
  [/блуберр[іиi]\w*/gi, "blueberries"],
  [/лохини?/gi, "blueberries"],
  [/чорниц\w*/gi, "blueberries"],
  [/молока?/gi, "milk"],
  [/помідор\w*/gi, "tomato"],
  [/томат(?:и|ів|ы)?/gi, "tomato"],
  [/яєчн\w*\s*білк\w*/gi, "egg whites"],
  [/белок/gi, "egg whites"],
  [/білк[иіа]?/gi, "egg whites"],
  [/\begg\s*white\b/gi, "egg whites"],
  [/яйця/gi, "eggs"],
  [/яєць/gi, "eggs"],
  [/яйцо/gi, "eggs"],
];

function clip(raw: string, max: number): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

export function foldWhatsAppQuery(raw: string): string {
  let t = clip(raw, 120).toLowerCase();
  for (const [re, en] of GLOSS) t = t.replace(re, en);
  t = t.replace(/\s+/g, " ").trim();
  return stripPackNoise(t) || t;
}

function isWhatsAppNoise(line: string): boolean {
  const t = line.trim();
  if (t.length < 2) return true;
  if (WHATSAPP_NOISE.test(t)) return true;
  if (/^\d{1,2}:\d{2}(?:\s*[ap]m)?$/i.test(t)) return true;
  if (/^[\d/.,:\-\s]+$/.test(t)) return true;
  return false;
}

export function stripWhatsAppWrap(line: string): string {
  const t = line
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/^[-*•–]+\s*/, "")
    .trim();
  const stamped = t.match(/^\[[^\]]+\]\s*[^:]{1,40}:\s*(.*)$/);
  if (stamped?.[1]) return stamped[1].trim();
  const named = t.match(
    /^[A-Za-zА-Яа-яІіЇїЄєҐґ'’.\-\s]{2,40}:\s+(.+)$/u,
  );
  if (named?.[1]) return named[1].trim();
  return t;
}

const UNIT_ALIASES: Record<string, AmountUnit> = {
  kg: "kg",
  кг: "kg",
  kilo: "kg",
  kilos: "kg",
  g: "g",
  гр: "g",
  gram: "g",
  grams: "g",
  lb: "kg",
  lbs: "kg",
  pound: "kg",
  pounds: "kg",
  l: "l",
  л: "l",
  lt: "l",
  litre: "l",
  liter: "l",
  litres: "l",
  ml: "ml",
  мл: "ml",
  pack: "pack",
  packs: "pack",
  pk: "pack",
  ea: "ea",
  pc: "ea",
  pcs: "ea",
};

function parseUnitToken(raw: string): AmountUnit | null {
  const t = raw.trim().toLowerCase().replace(/\./g, "");
  return UNIT_ALIASES[t] ?? null;
}

function toNumber(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function lbToKg(n: number): number {
  return Math.round(n * 0.45359237 * 1000) / 1000;
}

export type WhatsAppRawLine = {
  raw: string;
  query: string;
  qty: number;
  unit: AmountUnit;
  requestedAmount: number;
};

/**
 * Pull a leading/trailing count and optional mass unit off a shopping line.
 * Volume tokens (2.63L) stay in the name — they are pack identity, not qty.
 */
export function parseWhatsAppRawLine(rawLine: string): WhatsAppRawLine | null {
  const raw = clip(stripWhatsAppWrap(rawLine), 160);
  if (!raw || isWhatsAppNoise(raw)) return null;
  let rest = raw
    .replace(/^(ще|also|and|plus|ще\s+й)\s+/i, "")
    .replace(/^\+\s*/, "")
    .trim();
  if (!rest) return null;

  let qty = 1;
  let unit: AmountUnit = "pack";
  let requestedAmount = 1;

  const times = rest.match(/^(.*?)(?:\s*[x×]\s*|\s+x\s+)(\d+(?:[.,]\d+)?)\s*$/i);
  const massEnd = rest.match(
    /^(.*?)(?:\s+|:)(\d+(?:[.,]\d+)?)\s*(kg|кг|g|гр|grams?|lb|lbs|pounds?)\s*$/i,
  );
  const leadMass = rest.match(
    /^(\d+(?:[.,]\d+)?)\s*(kg|кг|g|гр|grams?|lb|lbs|pounds?)\s+(.*)$/i,
  );
  const leadCount = rest.match(/^(\d+(?:[.,]\d+)?)\s+(?![%\d])(.*)$/);
  const trailCount = rest.match(/^(.*\D)\s+(\d+(?:[.,]\d+)?)\s*$/);

  if (massEnd) {
    const n = toNumber(massEnd[2]!);
    const u = parseUnitToken(massEnd[3]!);
    const name = massEnd[1]!.trim();
    if (n && u && name.length >= 2) {
      rest = name;
      unit = u === "kg" || u === "g" ? u : "kg";
      requestedAmount =
        massEnd[3]!.toLowerCase().startsWith("lb") ||
        massEnd[3]!.toLowerCase().startsWith("pound")
          ? lbToKg(n)
          : n;
      if (
        massEnd[3]!.toLowerCase().startsWith("lb") ||
        massEnd[3]!.toLowerCase().startsWith("pound")
      ) {
        unit = "kg";
      }
      qty = Math.max(1, Math.round(requestedAmount));
    }
  } else if (leadMass) {
    const n = toNumber(leadMass[1]!);
    const u = parseUnitToken(leadMass[2]!);
    const name = leadMass[3]!.trim();
    if (n && u && name.length >= 2) {
      rest = name;
      unit = u === "kg" || u === "g" ? u : "kg";
      requestedAmount = leadMass[2]!.toLowerCase().startsWith("lb")
        ? lbToKg(n)
        : n;
      if (leadMass[2]!.toLowerCase().startsWith("lb")) unit = "kg";
      qty = Math.max(1, Math.round(requestedAmount));
    }
  } else if (times) {
    const n = toNumber(times[2]!);
    const name = times[1]!.trim();
    if (n && name.length >= 2) {
      rest = name;
      qty = Math.max(1, Math.round(n));
      requestedAmount = qty;
      unit = "pack";
    }
  } else if (leadCount && !leadCount[2]!.startsWith("%")) {
    const n = toNumber(leadCount[1]!);
    const name = leadCount[2]!.trim();
    if (n && name.length >= 2 && !/\d+[.,]?\d*\s*(l|ml|oz)\b/i.test(leadCount[1]!)) {
      rest = name;
      qty = Math.max(1, Math.round(n));
      requestedAmount = qty;
      unit = "pack";
    }
  } else if (trailCount) {
    const n = toNumber(trailCount[2]!);
    const name = trailCount[1]!.trim();
    if (n && name.length >= 2 && Number.isInteger(n)) {
      rest = name;
      qty = Math.max(1, Math.round(n));
      requestedAmount = qty;
      unit = "pack";
    }
  }

  const query = foldWhatsAppQuery(rest);
  if (query.length < 2) return null;
  return { raw, query, qty, unit, requestedAmount };
}

function mergeRawLines(rows: WhatsAppRawLine[]): WhatsAppRawLine[] {
  const map = new Map<string, WhatsAppRawLine>();
  for (const row of rows) {
    const key = `${row.query}::${row.unit}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      continue;
    }
    prev.qty += row.qty;
    prev.requestedAmount += row.requestedAmount;
    prev.raw = `${prev.raw} + ${row.raw}`;
  }
  return [...map.values()];
}

function eggWhitesQuery(q: string): boolean {
  return /egg\s*whites?|яєчн\w*\s*білк|\bбілок\b|\bбілка\b|\bбілки\b/.test(q);
}

function rankCatalogHits(
  query: string,
  catalog: WhatsAppCatalogItem[],
): WhatsAppHint[] {
  return catalog
    .filter((item) => stapleMatchesCatalogQuery(item, query))
    .map((item) => ({
      id: item.id,
      label: item.label,
      score: catalogSearchScore(item, query),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "en"))
    .slice(0, MAX_ALTERNATIVES);
}

function specializeHits(
  query: string,
  hits: WhatsAppHint[],
  catalog: WhatsAppCatalogItem[],
): WhatsAppHint[] {
  if (eggWhitesQuery(query)) {
    const whites = hits.filter((h) => h.id === "simply_egg_whites");
    if (whites.length) return whites;
    const row = catalog.find((i) => i.id === "simply_egg_whites");
    if (row) return [{ id: row.id, label: row.label, score: 100 }];
  }
  if (queryLooksLikeShellEggs(query) && !eggWhitesQuery(query)) {
    const eggs = hits.filter((h) => h.id === "large_eggs_dozen");
    if (eggs.length) return eggs.map((h) => ({ ...h, score: Math.max(h.score, 100) }));
    const row = catalog.find((i) => i.id === "large_eggs_dozen");
    if (row) return [{ id: row.id, label: row.label, score: 100 }];
    return [];
  }
  if (/\bfrozen\b/.test(query) && /blueberr/.test(query)) {
    const frozen = hits.filter((h) => h.id === "frozen_blueberry");
    if (frozen.length) {
      return [
        { ...frozen[0]!, score: Math.max(frozen[0]!.score, 100) },
        ...hits.filter((h) => h.id !== "frozen_blueberry"),
      ].slice(0, MAX_ALTERNATIVES);
    }
  }
  if (/^milk$/.test(query)) {
    const twoPct = hits.find((h) => h.id === "milk_2pct_2l");
    if (twoPct) {
      return [
        { ...twoPct, score: Math.max(twoPct.score, 90) },
        ...hits.filter((h) => h.id !== "milk_2pct_2l"),
      ].slice(0, MAX_ALTERNATIVES);
    }
  }
  return hits;
}

export function matchWhatsAppQuery(
  query: string,
  catalog: WhatsAppCatalogItem[],
): { status: WhatsAppDecision["status"]; alternatives: WhatsAppHint[] } {
  const q = foldWhatsAppQuery(query);
  if (q.length < 2) return { status: "unmatched", alternatives: [] };
  const ranked = specializeHits(q, rankCatalogHits(q, catalog), catalog);
  const best = ranked[0];
  if (!best || best.score < UNSURE_SCORE) {
    return { status: "unmatched", alternatives: ranked };
  }
  return { status: "matched", alternatives: ranked };
}

export function parseWhatsAppList(
  text: string,
  catalog: WhatsAppCatalogItem[],
): WhatsAppParseResult {
  const skipped: string[] = [];
  const rawRows: WhatsAppRawLine[] = [];
  const rows = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n");
  for (const row of rows) {
    if (!row.trim()) continue;
    const parsed = parseWhatsAppRawLine(row);
    if (!parsed) {
      const shown = clip(row, 80);
      if (shown) skipped.push(shown);
      continue;
    }
    rawRows.push(parsed);
    if (rawRows.length >= MAX_LINES) break;
  }
  const merged = mergeRawLines(rawRows);
  const decisions: WhatsAppDecision[] = merged.map((row) => {
    const hit = matchWhatsAppQuery(row.query, catalog);
    const best = hit.alternatives[0];
    const byId = catalog.find((i) => i.id === best?.id);
    let unit = row.unit;
    let requestedAmount = row.requestedAmount;
    if (byId && (hit.status === "matched" || hit.status === "unsure")) {
      const productUnit = byId.unit ?? "pack";
      if (row.unit === "pack" || row.unit === "ea") {
        // "2 milk" is two cafe cartons, not 2 L. Checkout uses defaultAmount × qty.
        unit = "pack";
        requestedAmount = row.qty;
        if (isEggLike(byId)) {
          unit = "ea";
          const per =
            byId.defaultAmount && byId.defaultAmount > 0 ? byId.defaultAmount : 12;
          requestedAmount = row.qty * per;
        }
      } else if (sameDimension(row.unit, productUnit)) {
        unit = productUnit;
        requestedAmount = fromBase(
          toBase(row.requestedAmount, row.unit).amount,
          productUnit,
        );
      }
    }
    return {
      raw: row.raw,
      query: row.query,
      qty: row.qty,
      unit,
      requestedAmount,
      status: hit.status,
      matchedId: hit.status === "unmatched" ? undefined : best?.id,
      matchedLabel: hit.status === "unmatched" ? undefined : best?.label,
      alternatives: hit.alternatives,
    };
  });
  return { decisions, skipped };
}

function isEggLike(item: WhatsAppCatalogItem): boolean {
  return item.id === "large_eggs_dozen" || item.category === "eggs";
}

/** Apply a later AI hint only when local match was unsure/unmatched. */
export function applyWhatsAppAiHint(
  decision: WhatsAppDecision,
  productId: string | null | undefined,
  catalog: WhatsAppCatalogItem[],
  confidence = 0,
): WhatsAppDecision {
  if (decision.status === "matched") return decision;
  const id = String(productId ?? "").trim();
  if (!id) return decision;
  const item = catalog.find((row) => row.id === id);
  if (!item) return decision;
  const alts = [
    { id: item.id, label: item.label, score: Math.round(Math.min(1, confidence) * 100) },
    ...decision.alternatives.filter((a) => a.id !== item.id),
  ].slice(0, MAX_ALTERNATIVES);
  if (confidence >= 0.45) {
    return {
      ...decision,
      status: "matched",
      matchedId: item.id,
      matchedLabel: item.label,
      alternatives: alts,
    };
  }
  return { ...decision, alternatives: alts };
}

/** Take every catalog hit the parser found. Driver does not confirm rows. */
export function adoptWhatsAppDecisions(
  decisions: WhatsAppDecision[],
): { confirmed: WhatsAppConfirmLine[]; missed: string[] } {
  const confirmed: WhatsAppConfirmLine[] = [];
  const missed: string[] = [];
  for (const row of decisions) {
    const hitId = row.matchedId ?? row.alternatives[0]?.id;
    const hitLabel =
      row.matchedLabel ??
      row.alternatives.find((a) => a.id === hitId)?.label ??
      row.query;
    if (!hitId || row.status === "unmatched") {
      missed.push(row.raw);
      continue;
    }
    confirmed.push({
      id: hitId,
      label: hitLabel,
      qty: row.qty,
      unit: row.unit,
      requestedAmount: row.requestedAmount,
      note: row.raw,
    });
  }
  return { confirmed, missed };
}

export function toWaiterLinesFromWhatsApp(
  confirmed: WhatsAppConfirmLine[],
): WaiterTicketLine[] {
  const map = new Map<string, WaiterTicketLine & { requestedAmount?: number; unit?: AmountUnit }>();
  for (const row of confirmed) {
    const id = clip(row.id, 80);
    if (!id) continue;
    const label = clip(row.label, 80) || id.replace(/_/g, " ");
    const qty = Math.min(99, Math.max(1, Math.round(row.qty)));
    const requested =
      row.requestedAmount > 0 ? row.requestedAmount : qty;
    const prev = map.get(id);
    if (!prev) {
      const line: WaiterTicketLine & { requestedAmount?: number; unit?: AmountUnit } = {
        id,
        label,
        qty,
        note: clip(row.note ?? "WhatsApp", 80),
        requestedAmount: requested,
        unit: row.unit,
      };
      if (row.unit === "kg" || row.unit === "g") {
        line.qty = 1;
      }
      map.set(id, line);
      continue;
    }
    prev.qty = Math.min(99, prev.qty + (row.unit === "kg" || row.unit === "g" ? 0 : qty));
    if (row.unit === "kg" || row.unit === "g") prev.qty = 1;
    if (prev.requestedAmount != null && sameDimension(prev.unit ?? row.unit, row.unit)) {
      prev.requestedAmount += requested;
    }
  }
  return [...map.values()];
}

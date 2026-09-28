/**
 * Receipt OCR and homepage add → cafe staple drafts.
 * Existing shown cards stay as-is; unmatched lines / new names become
 * `custom: true` rows (`receipt_*` or `custom_*`). Fees, tax, and bag lines
 * are skipped on receipts. Shell eggs always map to `large_eggs_dozen`.
 */
import { queryLooksLikeShellEggs } from "@/domain/egg-pack";
import { identityKeywords, stripPackNoise } from "@/domain/pack-tokens";
import {
  catalogSearchScore,
  stapleMatchesCatalogQuery,
  type CatalogSearchItem,
} from "@/domain/staple-search";

export type ReceiptLineDraft = {
  name: string;
  qty?: number;
  price?: number;
};

export type ReceiptLineSkip = {
  name: string;
  reason: string;
};

export type ReceiptStapleDraft = {
  id: string;
  label: string;
  queries: string[];
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
  matchMode: "exact" | "cheapest_equivalent";
  category?: string;
  unit?: "g" | "kg" | "ml" | "ea" | "pack" | "l";
  soldByWeight?: boolean;
  custom: true;
  notes: string;
};

export type ManualStapleInput = {
  label: string;
  query?: string;
  matchMode?: "exact" | "cheapest_equivalent";
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
};

export type ManualProductDecision =
  | { status: "invalid"; reason: string }
  | { status: "eggs"; matchedId: "large_eggs_dozen"; matchedLabel: string }
  | { status: "existing"; matchedId: string; matchedLabel: string }
  | { status: "new"; draft: ReceiptStapleDraft };

export type ReceiptLineDecision = {
  name: string;
  qty?: number;
  price?: number;
  status: "skip" | "existing" | "new";
  reason?: string;
  matchedId?: string;
  matchedLabel?: string;
  draft?: ReceiptStapleDraft;
};

const SKIP_LINE =
  /\b(sub\s*total|subtotal|total|balance|change|hst|gst|pst|qst|tvq|tax|debit|credit|visa|mastercard|amex|cash|tender|payment|change due|you saved|savings|air\s*miles|pc\s*optimum|optimum|triangle|thank you|cashier|served by|store\s*#|tel\.?|www\.|http|invoice|receipt\s*#|gst\/hst|#\s*\d{5}|rounded|refund|void|approved|auth(?:orization)?|mid\b|tid\b|chip|pin\s*verified|copy)\b/i;

const SKIP_PRODUCT =
  /\b(paper bag|reusable bag|plastic bag|bag fee|bottle deposit|crv|eco fee|weighing fee)\b/i;

const PRICE_AT_END = /^(.*?)(?:\s{1,}|\t+)(\d+[.,]\d{2})\s*[A-Z]?$/i;
const ONLY_PRICE = /^\$?\s*(\d+[.,]\d{2})\s*[A-Z]?$/i;
const QTY_PREFIX = /^(\d+(?:[.,]\d+)?)\s*[@x×]\s+/i;
const QTY_AT_PRICE = /(\d+)\s*@\s*\$?\d+[.,]\d{2}/i;

function cleanName(raw: string): string {
  return raw
    .replace(/[|*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(raw: string): number | undefined {
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function isReceiptNoiseLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return true;
  if (/^\d{6,}$/.test(t.replace(/\s/g, ""))) return true;
  if (SKIP_LINE.test(t)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(t)) return true;
  if (/^\d{1,2}:\d{2}/.test(t)) return true;
  return false;
}

export function parseReceiptText(text: string): ReceiptLineDraft[] {
  const rows = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ReceiptLineDraft[] = [];
  let pendingName: string | null = null;

  const pushName = (name: string, price?: number, qty?: number) => {
    const n = cleanName(name.replace(QTY_PREFIX, ""));
    if (!n || n.length < 3) return;
    if (isReceiptNoiseLine(n) || SKIP_PRODUCT.test(n)) return;
    const qMatch = name.match(QTY_PREFIX) ?? name.match(QTY_AT_PRICE);
    const parsedQty =
      qty ??
      (qMatch ? Number.parseFloat(qMatch[1]!.replace(",", ".")) : undefined);
    out.push({
      name: n,
      price,
      qty:
        parsedQty != null && Number.isFinite(parsedQty) && parsedQty > 0
          ? parsedQty
          : undefined,
    });
  };

  for (const row of rows) {
    if (isReceiptNoiseLine(row) && !ONLY_PRICE.test(row)) {
      pendingName = null;
      continue;
    }
    const only = row.match(ONLY_PRICE);
    if (only) {
      const price = parsePrice(only[1]!);
      if (pendingName && price) {
        pushName(pendingName, price);
        pendingName = null;
      }
      continue;
    }
    const priced = row.match(PRICE_AT_END);
    if (priced && priced[1]!.trim().length >= 3) {
      pushName(priced[1]!, parsePrice(priced[2]!));
      pendingName = null;
      continue;
    }
    if (SKIP_PRODUCT.test(row)) {
      pendingName = null;
      continue;
    }
    pendingName = row;
  }
  if (pendingName && !isReceiptNoiseLine(pendingName) && !SKIP_PRODUCT.test(pendingName)) {
    pushName(pendingName);
  }

  const seen = new Set<string>();
  return out.filter((line) => {
    const key = line.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stapleSlug(name: string): string {
  return (
    stripPackNoise(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 42) || "item"
  );
}

export function receiptStapleId(name: string): string {
  return `receipt_${stapleSlug(name)}`;
}

/** Homepage / settings add — same slug rules as receipts, `custom_` prefix. */
export function customStapleId(name: string): string {
  return `custom_${stapleSlug(name)}`;
}

function uniqueKeywords(...lists: Array<readonly string[] | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of identityKeywords(list)) {
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
    }
  }
  return out;
}

function inferredIncludeTokens(label: string): string[] {
  return identityKeywords(
    stripPackNoise(label)
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  ).slice(0, 4);
}

function inferCategory(name: string): string | undefined {
  const t = name.toLowerCase();
  if (/\b(frozen|iqf|alasko)\b/.test(t)) return "frozen";
  if (
    /\b(cup|lid|lids|glove|gloves|foil|napkin|tray|wraps?|bagasse|nitrile|paddle|mitt|strainer|tablecloth)\b/.test(
      t,
    )
  ) {
    return "supplies";
  }
  if (
    /\b(milk|cheese|yogurt|butter|cream|ricotta|mozzarella|cheddar|havarti|muenster)\b/.test(
      t,
    )
  ) {
    return "dairy";
  }
  if (
    /\b(tomato|pepper|onion|lettuce|celery|carrot|apple|banana|berr|grape|melon|pear|peach|plum|lime|lemon|parsley|cilantro|garlic|potato|avocado|cucumber|mushroom|radish|broccoli|cauliflower|cabbage|spinach|kale|herb)\b/.test(
      t,
    )
  ) {
    return "produce";
  }
  return "grocery";
}

export function draftStapleFromReceiptLine(line: ReceiptLineDraft): ReceiptStapleDraft {
  const label = cleanName(line.name).replace(/\s+/g, " ").slice(0, 80);
  const category = inferCategory(label);
  const cheapest =
    category === "produce" ||
    category === "frozen" ||
    category === "supplies";
  const include = inferredIncludeTokens(label);
  const draft: ReceiptStapleDraft = {
    id: receiptStapleId(label),
    label,
    queries: [label],
    matchMode: cheapest ? "cheapest_equivalent" : "exact",
    category,
    custom: true,
    notes: "Added from receipt photo",
  };
  if (include.length) draft.mustIncludeAny = include;
  return draft;
}

export function draftStapleFromManualName(
  input: ManualStapleInput,
): ReceiptStapleDraft {
  const label = cleanName(input.label).replace(/\s+/g, " ").slice(0, 80);
  const category = inferCategory(label);
  const cheapest =
    category === "produce" ||
    category === "frozen" ||
    category === "supplies";
  const include = uniqueKeywords(
    inferredIncludeTokens(label),
    input.mustIncludeAny,
  );
  const exclude = uniqueKeywords(input.mustNotInclude);
  const queries = [label];
  const extra = cleanName(input.query ?? "").slice(0, 80);
  if (extra && extra.toLowerCase() !== label.toLowerCase()) {
    queries.push(extra);
  }
  const draft: ReceiptStapleDraft = {
    id: customStapleId(label),
    label,
    queries,
    matchMode: input.matchMode ?? (cheapest ? "cheapest_equivalent" : "exact"),
    category,
    custom: true,
    notes: "Added from homepage",
  };
  if (include.length) draft.mustIncludeAny = include;
  if (exclude.length) draft.mustNotInclude = exclude;
  return draft;
}

function uniqueDraftId(
  base: string,
  occupied: Iterable<string>,
): string {
  const taken = occupied instanceof Set ? occupied : new Set(occupied);
  if (!taken.has(base)) return base;
  let n = 2;
  let id = `${base}_${n}`;
  while (taken.has(id)) {
    n += 1;
    id = `${base}_${n}`;
  }
  return id;
}

/** Homepage add: refuse a second egg card; reuse a close catalog hit. */
export function decideManualProduct(
  input: ManualStapleInput,
  catalog: CatalogSearchItem[],
  occupiedIds?: Iterable<string>,
): ManualProductDecision {
  const label = cleanName(input.label).replace(/\s+/g, " ").slice(0, 80);
  if (label.length < 3) {
    return { status: "invalid", reason: "name too short" };
  }
  const extra = cleanName(input.query ?? "");
  if (
    queryLooksLikeShellEggs(label) ||
    (extra.length >= 3 && queryLooksLikeShellEggs(extra))
  ) {
    const eggs = catalog.find((item) => item.id === "large_eggs_dozen");
    return {
      status: "eggs",
      matchedId: "large_eggs_dozen",
      matchedLabel: eggs?.label ?? "Large eggs dozen",
    };
  }
  const hit = matchReceiptLineToCatalog({ name: label }, catalog);
  if (hit) {
    return {
      status: "existing",
      matchedId: hit.id,
      matchedLabel: hit.label,
    };
  }
  const draft = draftStapleFromManualName({ ...input, label });
  const taken = new Set(
    [...(occupiedIds ?? []), ...catalog.map((item) => item.id)].filter(Boolean),
  );
  draft.id = uniqueDraftId(draft.id, taken);
  return { status: "new", draft };
}

export function matchReceiptLineToCatalog(
  line: ReceiptLineDraft,
  catalog: CatalogSearchItem[],
): { id: string; label: string } | null {
  const name = line.name.trim();
  if (!name) return null;
  const searchName = stripPackNoise(name) || name;
  if (queryLooksLikeShellEggs(name) || queryLooksLikeShellEggs(searchName)) {
    const eggs = catalog.find((item) => item.id === "large_eggs_dozen");
    if (eggs) return { id: eggs.id, label: eggs.label };
  }
  const hits = catalog
    .filter(
      (item) =>
        stapleMatchesCatalogQuery(item, searchName) ||
        stapleMatchesCatalogQuery(item, name),
    )
    .map((item) => ({
      item,
      score: Math.max(
        catalogSearchScore(item, searchName),
        catalogSearchScore(item, name),
      ),
    }))
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  const best = hits[0];
  if (!best) return null;
  if (best.score >= 40) return { id: best.item.id, label: best.item.label };
  const identity = identityKeywords(
    stripPackNoise(name)
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
  if (
    identity.length &&
    identity.every((token) =>
      `${best.item.label} ${best.item.id}`.toLowerCase().includes(token.toLowerCase()),
    )
  ) {
    return { id: best.item.id, label: best.item.label };
  }
  return null;
}

export function decideReceiptLines(
  lines: ReceiptLineDraft[],
  catalog: CatalogSearchItem[],
  occupiedIds?: Iterable<string>,
): ReceiptLineDecision[] {
  const taken = new Set(
    [...(occupiedIds ?? []), ...catalog.map((item) => item.id)].filter(Boolean),
  );
  const out: ReceiptLineDecision[] = [];
  for (const line of lines) {
    if (SKIP_PRODUCT.test(line.name) || isReceiptNoiseLine(line.name)) {
      out.push({ ...line, status: "skip", reason: "fee or non-product" });
      continue;
    }
    const hit = matchReceiptLineToCatalog(line, catalog);
    if (hit) {
      out.push({
        ...line,
        status: "existing",
        matchedId: hit.id,
        matchedLabel: hit.label,
      });
      continue;
    }
    const draft = draftStapleFromReceiptLine(line);
    draft.id = uniqueDraftId(draft.id, taken);
    taken.add(draft.id);
    out.push({ ...line, status: "new", draft });
  }
  return out;
}

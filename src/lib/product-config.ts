/**
 * Client-first product config overrides (Vercel has a read-only FS).
 * Compare receives the merged config in the request body.
 */
import {
  applyProductOverride,
  toRestaurantProduct,
  type ProductOverride,
  type RestaurantProduct,
  type StapleLike,
} from "@/domain/restaurant-product";

export const PRODUCT_OVERRIDE_STORAGE_KEY = "royal-sass-product-overrides-v1";
export const CART_STORAGE_KEY = "royal-sass-cart-v1";
/** Waiter portal draft list (local only — not sent to a driver). */
export const WAITER_LIST_STORAGE_KEY = "royal-sass-waiter-list-v1";
/** Hidden cafe cards. Live store on Vercel (read-only FS); disk copy is best-effort. */
export const REMOVED_STAPLES_STORAGE_KEY = "royal-sass-removed-staples-v1";
/** Custom cards from receipt photos / search adopt. Vercel source of truth. */
export const CUSTOM_STAPLES_STORAGE_KEY = "royal-sass-custom-staples-v1";

const CLIENT_CUSTOM_ID = /^(receipt_|custom_)[a-z0-9_]{1,80}$/i;
const CUSTOM_UNITS = new Set(["g", "kg", "ml", "l", "ea", "pack"]);

export type ClientCustomStaple = {
  id: string;
  label: string;
  queries: string[];
  custom: true;
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
  matchMode?: "exact" | "cheapest_equivalent" | "preferred" | "cheapest";
  category?: string;
  unit?: "g" | "kg" | "ml" | "l" | "ea" | "pack";
  notes?: string;
  defaultAmount?: number;
  purchaseStrategy?: "exact_need" | "stock_up";
};

export function isClientCustomStapleId(id: string): boolean {
  return CLIENT_CUSTOM_ID.test(id);
}

export function parseRemovedStapleIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

export function readRemovedStapleIds(): string[] {
  try {
    const raw = window.localStorage.getItem(REMOVED_STAPLES_STORAGE_KEY);
    if (!raw) return [];
    return parseRemovedStapleIds(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeRemovedStapleIds(ids: Iterable<string>): string[] {
  const next = parseRemovedStapleIds([...ids]);
  try {
    window.localStorage.setItem(REMOVED_STAPLES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function effectiveProduct(
  item: StapleLike,
  override?: ProductOverride | null,
): RestaurantProduct {
  return applyProductOverride(toRestaurantProduct(item), override);
}

function asTrimmedList(raw: unknown, max: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
  return out.length ? out : undefined;
}

/** Client-posted custom rows. Only `custom: true` ids `receipt_*` / `custom_*`. */
export function parseCustomStapleDrafts(raw: unknown): ClientCustomStaple[] {
  if (!Array.isArray(raw)) return [];
  const out: ClientCustomStaple[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (r.custom !== true) continue;
    const id = String(r.id ?? "").trim();
    const label = String(r.label ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!CLIENT_CUSTOM_ID.test(id) || label.length < 3) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const queries = asTrimmedList(r.queries, 8) ?? [label];
    const item: ClientCustomStaple = {
      id,
      label,
      queries,
      custom: true,
    };
    const includeAny = asTrimmedList(r.mustIncludeAny, 8);
    const includeAll = asTrimmedList(r.mustIncludeAll, 8);
    const exclude = asTrimmedList(r.mustNotInclude, 12);
    if (includeAny) item.mustIncludeAny = includeAny;
    if (includeAll) item.mustIncludeAll = includeAll;
    if (exclude) item.mustNotInclude = exclude;
    const mode = String(r.matchMode ?? "");
    if (
      mode === "exact" ||
      mode === "cheapest_equivalent" ||
      mode === "preferred" ||
      mode === "cheapest"
    ) {
      item.matchMode = mode;
    }
    const category = String(r.category ?? "").trim().slice(0, 32);
    if (category) item.category = category;
    const unit = String(r.unit ?? "");
    if (CUSTOM_UNITS.has(unit)) {
      item.unit = unit as ClientCustomStaple["unit"];
    }
    const notes = String(r.notes ?? "").trim().slice(0, 160);
    if (notes) item.notes = notes;
    const amount = Number(r.defaultAmount);
    if (Number.isFinite(amount) && amount > 0) item.defaultAmount = amount;
    if (r.purchaseStrategy === "exact_need" || r.purchaseStrategy === "stock_up") {
      item.purchaseStrategy = r.purchaseStrategy;
    }
    out.push(item);
  }
  return out;
}

export function readCustomStaples(): ClientCustomStaple[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_STAPLES_STORAGE_KEY);
    if (!raw) return [];
    return parseCustomStapleDrafts(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeCustomStaples(
  items: Iterable<ClientCustomStaple>,
): ClientCustomStaple[] {
  const next = parseCustomStapleDrafts([...items]);
  try {
    window.localStorage.setItem(
      CUSTOM_STAPLES_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    /* ignore quota */
  }
  return next;
}

export function upsertCustomStaples(
  items: Iterable<ClientCustomStaple>,
): ClientCustomStaple[] {
  const byId = new Map(readCustomStaples().map((item) => [item.id, item]));
  for (const item of parseCustomStapleDrafts([...items])) {
    byId.set(item.id, item);
  }
  return writeCustomStaples([...byId.values()]);
}

export function dropCustomStaples(ids: Iterable<string>): ClientCustomStaple[] {
  const gone = new Set(ids);
  return writeCustomStaples(readCustomStaples().filter((item) => !gone.has(item.id)));
}

export function parseOverrideMap(raw: unknown): Record<string, ProductOverride> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ProductOverride> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object") continue;
    out[id] = value as ProductOverride;
  }
  return out;
}

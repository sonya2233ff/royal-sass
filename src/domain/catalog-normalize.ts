/**
 * Turn cached retailer catalog rows into ProductRecord.
 * Master identity is the staple id (cafe-staples), never a No Frills SKU.
 */
import { extractBarcodes, packMassKg } from "@/domain/fair-compare";
import { normalizeName, type ProductRecord } from "@/domain/entity-match";

export const NOFRILLS_RETAILER = "nofrills";
export const WALMART_RETAILER = "walmart_ca";
export const SOBEYS_RETAILER = "sobeys";
export const WHOLESALECLUB_RETAILER = "wholesaleclub";
export const MVR_RETAILER = "mvr";

export interface StapleFilterItem {
  id: string;
  category?: string;
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
  /** Extra impostor words for this staple only (on top of the produce default). */
  rejectNameIncludes?: string[];
  /** When the offer is sold as 1 ea with no grams, use this average fruit/veg weight. */
  typicalEachGrams?: number;
}

export interface CatalogOfferLike {
  productId: string;
  name: string;
  price?: number;
  packageSize?: string;
  parsedMassKg?: number;
  brand?: string;
  availability?: string;
  upc?: string;
  confidence?: string;
  checkedAt?: string;
  sourceUrl?: string;
}

export function isNoFrillsRetailerSku(id: string): boolean {
  return /^\d+[A-Z0-9]*_(EA|KG|LB)$/i.test(id);
}

export function upcFromOffer(
  offer: CatalogOfferLike,
  extra?: Array<string | undefined | null>,
): string | undefined {
  // Do not treat PCX ids like 20820130001_EA as GTINs.
  const id = offer.productId;
  const idUpc =
    id && !isNoFrillsRetailerSku(id) && /^\d{8,14}$/.test(id) ? id : undefined;
  const found = extractBarcodes(
    offer.upc,
    offer.name,
    offer.packageSize,
    idUpc,
    ...(extra ?? []),
  );
  return found[0];
}

export function catalogOfferToRecord(input: {
  retailer: string;
  offer: CatalogOfferLike;
  category?: string;
  brandHint?: string;
  upc?: string;
}): ProductRecord {
  const kg = packMassKg(
    input.offer.name,
    input.offer.packageSize,
    input.offer.parsedMassKg,
  );
  return {
    retailer: input.retailer,
    retailerProductId: input.offer.productId,
    name: input.offer.name,
    normalizedName: normalizeName(input.offer.name),
    brand: input.offer.brand ?? input.brandHint,
    category: input.category,
    upc: input.upc ?? upcFromOffer(input.offer),
    sizeValue: kg ?? undefined,
    sizeUnit: kg != null ? "kg" : undefined,
  };
}

export function stapleBrandHint(item: StapleFilterItem): string | undefined {
  if (item.category === "produce") return undefined;
  const hits = [...(item.mustIncludeAll ?? []), ...(item.mustIncludeAny ?? [])];
  const brandish = hits.find(
    (s) =>
      s.length >= 4 &&
      !s.includes(" ") &&
      !/\d/.test(s) &&
      !/(tomato|milk|egg|oil|sugar|flour|butter|pulp)/i.test(s),
  );
  return brandish;
}

export function isCategoryBStaple(item: { category?: string }): boolean {
  return item.category === "produce" || item.category === "frozen";
}

/**
 * Extra search strings for cheapest produce/frozen: warehouse word order
 * and mustIncludeAny. Category A keeps the staple queries only.
 */
export function categoryBSearchQueries(
  item: {
    category?: string;
    queries: string[];
    mustIncludeAny?: string[];
    label?: string;
  },
  limit?: number,
): string[] {
  const cap = limit ?? (isCategoryBStaple(item) ? 6 : 4);
  const out: string[] = [];
  const add = (q: string | undefined) => {
    const t = (q ?? "").replace(/\s+/g, " ").trim();
    if (t.length < 2) return;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };
  for (const q of item.queries) add(q);
  if (!isCategoryBStaple(item)) return out.slice(0, cap);
  for (const q of item.queries) {
    add(q.replace(/\bfresh\b/gi, " "));
  }
  for (const p of item.mustIncludeAny ?? []) add(p);
  if (item.label) add(item.label.replace(/[()]/g, " "));
  return out.slice(0, cap);
}

/**
 * Warehouse titles: "VEGETABLES - TOMATOES GRAPE 1 PINT" → grape pack.
 * Used for Category B cheapest only — not branded Category A SKUs.
 */
export function warehouseTitleView(name: string): string {
  return name
    .replace(/^(fruits|vegetables)\s*[-–]\s*/i, "")
    .replace(/\bcase\b/gi, " ")
    .replace(/\bper\s*kg\b/gi, "1 kg")
    .replace(/\bpints?\b/gi, "pack")
    .replace(/\b\d+\s*x\s*\d+(?:\.\d+)?\b/gi, " ");
}

export type StapleOfferFilterInput = {
  name: string;
  brand?: string;
  packageSize?: string;
  raw?: unknown;
  /** Persisted Shopify/PCX type+tags so catalog resolve still sees frozen vs produce. */
  taxonomyText?: string;
};

/** Shopify type/tags, PCX/Walmart category blobs already on offer.raw — no connector change. */
export function retailerTaxonomyText(raw?: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  const parts: string[] = [];
  const type =
    (typeof r.type === "string" && r.type) ||
    (typeof r.product_type === "string" && r.product_type) ||
    (typeof r.productType === "string" && r.productType) ||
    "";
  if (type) parts.push(type);

  const tags = r.tags;
  const tagList = Array.isArray(tags)
    ? tags.map(String)
    : typeof tags === "string"
      ? tags.split(",").map((t) => t.trim())
      : [];
  for (const tag of tagList) {
    if (
      /^(INSTOREPRICE|MARKUP|MARGIN|LASTUPDATED|SHELFLOCATION|TAXLEVEL):/i.test(
        tag,
      )
    ) {
      continue;
    }
    parts.push(
      tag
        .replace(/^(DEPARTMENT|CATEGORY|SUBDEPARTMENT)_/i, " ")
        .replace(/[_]/g, " "),
    );
  }

  for (const key of [
    "department",
    "category",
    "primaryCategory",
    "taxonomyName",
    "aisle",
    "product_category",
  ] as const) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) parts.push(v);
  }
  for (const key of ["categories", "aisles"] as const) {
    const v = r[key];
    if (Array.isArray(v)) {
      for (const row of v) {
        if (typeof row === "string") parts.push(row);
        else if (row && typeof row === "object") {
          const name = (row as { name?: unknown }).name;
          if (typeof name === "string") parts.push(name);
        }
      }
    }
  }
  return parts.filter(Boolean).join(" ");
}

export function retailerCategoryFromTaxonomy(
  raw?: unknown,
): "frozen" | "produce" | undefined {
  const hay = retailerTaxonomyText(raw).toLowerCase();
  if (/\bfrozen\b|\biqf\b/.test(hay)) return "frozen";
  if (/\b(fruit|fruits|vegetable|vegetables|produce)\b/.test(hay)) {
    return "produce";
  }
  return undefined;
}

/**
 * Phrase = substring; single token = word boundary (seed ≠ seedless, waffle = waffles).
 */
export function nameMatchesFilterToken(hay: string, needle: string): boolean {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  const h = hay.toLowerCase();
  if (n.includes(" ")) return h.includes(n);
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}(?:es|s)?([^a-z0-9]|$)`).test(h);
}

/**
 * Category B (cheapest produce/frozen): phrases may be split across title,
 * pack, and retailer department — "tomatoes grape" = "grape tomatoes",
 * DEPARTMENT_FROZEN + STRAWBERRIES = "frozen strawberries".
 * Category A stays contiguous title match.
 */
export function nameMatchesFilterPhrase(
  hay: string,
  needle: string,
  splitAcrossFields: boolean,
): boolean {
  if (nameMatchesFilterToken(hay, needle)) return true;
  if (!splitAcrossFields) return false;
  const parts = needle.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((part) => nameMatchesFilterToken(hay, part));
}

export function offerFailsStapleFilters(
  item: StapleFilterItem,
  name: string,
  brand?: string,
  extraHay?: string,
): string | null {
  const extra = extraHay?.trim() ?? "";
  const splitAcrossFields = isCategoryBStaple(item);
  const n = `${brand ?? ""} ${name} ${extra}`.toLowerCase();
  const banned = [
    ...(item.mustNotInclude ?? []),
    ...(item.rejectNameIncludes ?? []),
  ];
  for (const bad of banned) {
    if (bad && nameMatchesFilterToken(n, bad)) return `mustNotInclude:${bad}`;
  }
  const all = item.mustIncludeAll ?? [];
  for (const need of all) {
    if (need && !nameMatchesFilterPhrase(n, need, splitAcrossFields)) {
      return `mustIncludeAll:${need}`;
    }
  }
  const any = item.mustIncludeAny ?? [];
  if (
    any.length > 0 &&
    !any.some((s) => s && nameMatchesFilterPhrase(n, s, splitAcrossFields))
  ) {
    return "mustIncludeAny";
  }
  return null;
}

/** Category B uses warehouse title + pack + retailer taxonomy; Category A is title/brand only. */
export function offerFailsStapleOfferFilters(
  item: StapleFilterItem,
  offer: StapleOfferFilterInput,
): string | null {
  if (!isCategoryBStaple(item)) {
    return offerFailsStapleFilters(item, offer.name, offer.brand);
  }
  const name = warehouseTitleView(offer.name);
  const brand = /^(fruits|vegetables)$/i.test(offer.brand ?? "")
    ? undefined
    : offer.brand;
  const extra = [
    offer.packageSize ?? "",
    offer.taxonomyText ?? "",
    retailerTaxonomyText(offer.raw),
  ]
    .filter((s) => s.trim())
    .join(" ");
  const fail = offerFailsStapleFilters(item, name, brand, extra);
  if (fail) return fail;
  const taxonomy = `${offer.taxonomyText ?? ""} ${retailerTaxonomyText(offer.raw)}`;
  const hay = `${name} ${brand ?? ""} ${taxonomy}`;
  const taxFrozen =
    nameMatchesFilterToken(hay, "frozen") ||
    nameMatchesFilterToken(hay, "iqf");
  if (item.category === "produce" && taxFrozen) return "mustNotInclude:frozen";
  if (item.category === "frozen" && taxonomy.trim() && !taxFrozen) {
    return "needFrozenDepartment";
  }
  return null;
}

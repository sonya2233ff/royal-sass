/**
 * Turn cached retailer catalog rows into ProductRecord.
 * Master identity is the staple id (cafe-staples), never a No Frills SKU.
 */
import { extractBarcodes, packMassKg } from "@/domain/fair-compare";
import { normalizeName, type ProductRecord } from "@/domain/entity-match";
import {
  identityKeywords,
  stripPackNoise,
} from "@/domain/pack-tokens";
import type { AlternateProduct } from "@/domain/restaurant-product";

export const NOFRILLS_RETAILER = "nofrills";
export const WALMART_RETAILER = "walmart_ca";
export const SOBEYS_RETAILER = "sobeys";
export const WHOLESALECLUB_RETAILER = "wholesaleclub";
export const MVR_RETAILER = "mvr";

export interface StapleFilterItem {
  id: string;
  label?: string;
  category?: string;
  matchMode?: string;
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
  /** Extra impostor words for this staple only (on top of the produce default). */
  rejectNameIncludes?: string[];
  /** When the offer is sold as 1 ea with no grams, use this average fruit/veg weight. */
  typicalEachGrams?: number;
  queries?: string[];
  preferredProductId?: string;
  preferNameIncludes?: string[];
  matchRules?: {
    productType?: string;
    form?: string;
    variant?: string;
    mustIncludeAll?: string[];
    mustIncludeAny?: string[];
    mustNotInclude?: string[];
  };
  alternateProduct?: AlternateProduct | null;
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
/** Words that bias retailer search toward organic / marketing titles. */
const SEARCH_NOISE =
  /\b(fresh|pint|pints|clamshell|organic|organics|whole)\b/gi;

function cleanSearchQuery(q: string): string {
  return q.replace(SEARCH_NOISE, " ").replace(/\s+/g, " ").trim();
}

/** Numeric WM SKU or Rapid alphanumeric id (e.g. 72CDS4R4V81X). */
export function looksLikeWalmartProductId(q: string): string | null {
  const url = q.match(/walmart\.ca\/(?:en|fr)\/ip\/[^/?#]+\/([A-Za-z0-9]+)/i);
  if (url?.[1]) return url[1];
  const bare = q.trim();
  if (/^\d{6,14}$/.test(bare)) return bare;
  if (/^[A-Z0-9]{10,14}$/i.test(bare) && /\d/.test(bare) && /[A-Za-z]/.test(bare)) {
    return bare;
  }
  return null;
}

/**
 * Category B / cheapest eggs: getProduct these WM ids into the search pool
 * (Rapid text search often omits a known pack). Not an identity lock.
 */
export function walmartCheapestHintIds(
  item: { queries?: string[]; preferredProductId?: string },
  extraIds?: Array<string | null | undefined>,
): string[] {
  const out: string[] = [];
  const add = (raw?: string | null) => {
    const id = looksLikeWalmartProductId(raw ?? "");
    if (id && !out.includes(id)) out.push(id);
  };
  for (const q of item.queries ?? []) add(q);
  add(item.preferredProductId);
  for (const extra of extraIds ?? []) add(extra);
  return out;
}

/** "grape tomatoes" → "tomatoes grape" for MVR warehouse titles. */
function warehouseWordOrder(q: string): string | undefined {
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return undefined;
  return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`;
}

export function categoryBSearchQueries(
  item: {
    category?: string;
    queries: string[];
    mustIncludeAny?: string[];
    label?: string;
    matchRules?: { productType?: string };
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
  if (!isCategoryBStaple(item)) {
    for (const q of item.queries) add(q);
    add(item.matchRules?.productType);
    return out.slice(0, cap);
  }
  // Recall only: fruit token + warehouse order. Filter does precision.
  // SKU-like queries are WM getProduct hints, not NF/MVR search text.
  for (const q of item.queries) {
    if (looksLikeWalmartProductId(q)) continue;
    add(cleanSearchQuery(q));
  }
  for (const q of item.queries) {
    if (looksLikeWalmartProductId(q)) continue;
    const cleaned = cleanSearchQuery(q);
    add(warehouseWordOrder(cleaned));
  }
  for (const p of item.mustIncludeAny ?? []) add(p);
  if (item.label) {
    add(stripPackNoise(cleanSearchQuery(item.label.replace(/[()]/g, " "))));
  }
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
  /** Shopify handle / retailer id — titles can be relabeled while the handle stays grape-tomatoes. */
  productId?: string;
  sourceUrl?: string;
};

/**
 * Last path segment + hyphenated productId, so "vegetables-grape-tomatoes-case"
 * still reads as grape even when the live title says "TOMATOES LOOSE".
 */
export function offerHandleHay(offer: {
  productId?: string;
  sourceUrl?: string;
}): string {
  const id = (offer.productId ?? "").replace(/[-_]+/g, " ");
  let slug = "";
  const url = offer.sourceUrl ?? "";
  if (url) {
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const leaf =
        [...parts]
          .reverse()
          .find(
            (p) =>
              p !== "p" &&
              p !== "en" &&
              p !== "ip" &&
              p !== "products" &&
              !/^\d/.test(p) &&
              p.length > 2,
          ) ??
        parts.at(-1) ??
        "";
      slug = leaf.replace(/[-_]+/g, " ");
    } catch {
      slug = url.replace(/[-_/]+/g, " ");
    }
  }
  return `${id} ${slug}`.trim();
}

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

/** Cafe cottage cheese — never mozzarella, cheddar, or another cheese form. */
export function isCottageCheeseStaple(item: {
  id?: string;
  label?: string;
}): boolean {
  const id = (item.id ?? "").toLowerCase().replace(/_/g, " ");
  const label = (item.label ?? "").toLowerCase();
  if ((item.id ?? "").toLowerCase() === "cottage_cheese") return true;
  const hay = `${id} ${label}`;
  return /\bcottage\b/.test(hay) && /\bcheese\b/.test(hay);
}

/**
 * Mozzerella (NF typo) is not the token "mozzarella". Require the word
 * cottage, and reject other cheese forms even when Include is only "cheese".
 */
export function cottageCheeseFormFail(
  item: { id?: string; label?: string },
  hay: string,
): string | null {
  if (!isCottageCheeseStaple(item)) return null;
  const t = hay.toLowerCase();
  if (
    /\bmozz/.test(t) ||
    /\b(cheddar|shredded|pizza|marble|ricotta|parmesan|swiss|gouda|havarti)\b/.test(
      t,
    ) ||
    /\bstring\s+cheese\b/.test(t)
  ) {
    return "cottage cheese ≠ mozzarella/cheddar";
  }
  if (/\bcream\s+cheese\b/.test(t)) return "cottage cheese ≠ cream cheese";
  if (!/\bcottage\b/.test(t)) return "cottage cheese ≠ other cheese";
  return null;
}

/**
 * Durable form gates for receipt/grocery impostors that OR-includes miss
 * (`cream` OR `cheese` → mozzarella). Prefer no_match over a fill-in SKU.
 */
export function cafeOfferFormFail(
  item: { id?: string; label?: string; category?: string },
  hay: string,
): string | null {
  const id = (item.id ?? "").toLowerCase();
  const t = hay.toLowerCase();
  if (
    item.category === "produce" &&
    /\b\d+(?:[.,]\d+)?\s*ml\b/.test(t)
  ) {
    return "fresh ≠ canned ml";
  }
  if (id === "cream_cheese_bars") {
    if (/\bmozz/.test(t) || /\bpizza\b/.test(t)) {
      return "cream cheese bars ≠ mozzarella";
    }
    if (!/\bcream\s+cheese\b/.test(t)) {
      return "cream cheese bars need cream cheese";
    }
    if (!/\bbar/.test(t)) return "cream cheese bars ≠ tub";
    return null;
  }
  if (id === "cups_16oz_pet") {
    if (/\b(2\s*oz|2oz|4\s*oz|4oz|shot cup|portion cup)\b/.test(t)) {
      return "16oz PET ≠ mini/shot cup";
    }
    return null;
  }
  if (id === "jam_apple_strawberry") {
    if (!/\bapple\b/.test(t) || !/\bstrawberr/.test(t)) {
      return "apple strawberry jam needs both fruits";
    }
    return null;
  }
  if (id === "fresh_mozzarella") {
    const fresh = /\b(fresh|fresca|buffalo|bocconcini)\b/.test(t);
    if (/\b(block|loaf|shredded)\b/.test(t) && !fresh) {
      return "fresh mozzarella ≠ block";
    }
    if (!fresh) return "fresh mozzarella needs fresh/fresca";
    return null;
  }
  if (id === "cantaloupe") {
    if (/\b(chunk|chunks|cubed|cut fruit)\b/.test(t)) {
      return "whole cantaloupe ≠ chunks";
    }
    return null;
  }
  if (id === "bamboo_paddles") {
    if (/\b(kayak|canoe|oar|boat|marine|wood paddle)\b/.test(t)) {
      return "tasting paddle ≠ boat paddle";
    }
    if (/\bwood\b/.test(t) && !/\bbamboo\b/.test(t)) {
      return "bamboo paddles ≠ wood paddle";
    }
    return null;
  }
  if (id === "floor_cleaner_lavender") {
    if (!/\blavender\b/.test(t)) return "floor cleaner needs lavender";
    return null;
  }
  if (id === "splenda_sweetener_cal") {
    if (/\bstevia\b/.test(t)) return "splenda ≠ stevia";
    return null;
  }
  if (id === "shredded_cheddar_cheese") {
    if (/\bflavou?red\s+topping\b/.test(t) || /\bimitation\b/.test(t)) {
      return "shredded cheddar ≠ flavoured topping";
    }
    return null;
  }
  if (id === "gloves_nitrile_large" || id === "gloves_nitrile_medium") {
    if (/\bcleaning gloves\b/.test(t)) return "nitrile exam ≠ cleaning gloves";
    return null;
  }
  if (id === "mushrooms_sliced") {
    if (/\b(cremini|crimini|portobello|shiitake|blanched)\b/.test(t)) {
      return "white mushrooms ≠ cremini/blanched";
    }
    return null;
  }
  if (id === "lids_dome_12_24oz") {
    if (/\b20\s*x\s*50\b/.test(t) || /\b400\s+per\s+case\b/.test(t)) {
      return "12-24oz dome lids ≠ warehouse case";
    }
    return null;
  }
  if (id === "brown_sugar") {
    if (!/\bdark\b/.test(t)) return "dark brown sugar needs dark";
    if (/\b(light|golden)\b/.test(t)) return "dark brown ≠ light brown";
    return null;
  }
  if (id === "oven_mitts") {
    if (
      /\b1[0-2](?:\.\d+)?\s*(in|inch|")/.test(t) ||
      /\b1[0-2](?:\.\d+)?\s*x/.test(t)
    ) {
      return "15in oven mitt ≠ mini mitt";
    }
    return null;
  }
  if (id === "measuring_cup") {
    if (
      /\b(filter cup|fruit washing|gadget|beater|multifunctional)\b/.test(t)
    ) {
      return "measuring cup ≠ gadget";
    }
    return null;
  }
  if (id === "edible_decor") {
    if (/\b(barbie|disney|marvel|peppa)\b/.test(t)) {
      return "edible decor ≠ character sprinkles";
    }
    return null;
  }
  if (id === "guest_towel_napkins") {
    if (/\b(party|parties|bow tie|shower)\b/.test(t)) {
      return "guest towel ≠ party napkin";
    }
    return null;
  }
  if (id === "lids_deli_round") {
    if (/\bcombo\b/.test(t)) return "deli lids ≠ combo container";
    return null;
  }
  if (id === "san_pellegrino_aranciata_or") {
    if (/\brossa\b/.test(t) || /\bblood\b/.test(t)) {
      return "aranciata ≠ rossa";
    }
    return null;
  }
  if (id === "cake_kits") {
    if (/\b(nozzle|decorating kit|72 pcs)\b/.test(t)) {
      return "cake kit ≠ decorating tools";
    }
    return null;
  }
  if (id === "wraps_plain_10in") {
    if (/\b(6|7|8)\s*(in|inch|")/.test(t)) {
      return "10in wrap ≠ small tortilla";
    }
    // 7–8" 10-count packs are ~320–340 g. Ignore PCX "$/100g" unit prices.
    if (/(?<!\/)\b([2-3]\d{2})\s*g\b/.test(t)) {
      return "10in wrap ≠ 7in pack";
    }
    return null;
  }
  return null;
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
  const cottageForm = cottageCheeseFormFail(item, n);
  if (cottageForm) return cottageForm;
  const cafeForm = cafeOfferFormFail(item, n);
  if (cafeForm) return cafeForm;
  const banned = [
    ...(item.mustNotInclude ?? []),
    ...(item.rejectNameIncludes ?? []),
  ];
  for (const bad of banned) {
    if (bad && nameMatchesFilterToken(n, bad)) return `mustNotInclude:${bad}`;
  }
  const all = identityKeywords(item.mustIncludeAll);
  for (const need of all) {
    if (!nameMatchesFilterPhrase(n, need, splitAcrossFields)) {
      return `mustIncludeAll:${need}`;
    }
  }
  const any = identityKeywords(item.mustIncludeAny);
  if (
    any.length > 0 &&
    !any.some((s) => nameMatchesFilterPhrase(n, s, splitAcrossFields))
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
    const extra = [offer.packageSize ?? "", offerHandleHay(offer)]
      .filter((s) => s.trim())
      .join(" ");
    return offerFailsStapleFilters(item, offer.name, offer.brand, extra);
  }
  const name = warehouseTitleView(offer.name);
  const brand = /^(fruits|vegetables)$/i.test(offer.brand ?? "")
    ? undefined
    : offer.brand;
  const frozenHint =
    item.category === "frozen" &&
    /\b(iqf|alasko)\b/i.test(`${offer.name} ${offer.brand ?? ""}`)
      ? "frozen"
      : "";
  const extra = [
    offer.packageSize ?? "",
    offer.taxonomyText ?? "",
    retailerTaxonomyText(offer.raw),
    frozenHint,
    offerHandleHay(offer),
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
  if (item.category === "frozen" && !taxFrozen && taxonomy.trim()) {
    return "needFrozenDepartment";
  }
  return null;
}

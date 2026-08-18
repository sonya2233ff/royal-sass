/**
 * Category B: keep the actual staple (fresh lemon / grape tomato pack),
 * not a flavored grocery SKU that happens to say the same word.
 *
 * Shared default junk is only the produce baseline. Per-staple extras
 * go on `mustNotInclude` / `rejectNameIncludes` / `typicalEachGrams`
 * in cafe-staples.json — those lists differ and grow by product.
 */
import { packMassKg } from "@/domain/fair-compare";
import {
  isCategoryBStaple,
  nameMatchesFilterToken,
  offerFailsStapleFilters,
  offerFailsStapleOfferFilters,
  warehouseTitleView,
  type StapleFilterItem,
} from "@/domain/catalog-normalize";

/** Shared produce impostors. Frozen staples skip "frozen". Juice staples skip "juice". */
export const DEFAULT_PRODUCE_JUNK = [
  "pop",
  "pops",
  "popsicle",
  "tea",
  "extract",
  "juice",
  "frozen",
  "ice cream",
  "candy",
  "stick",
  "balm",
  "drink",
  "soda",
  "yogurt",
  "cookie",
  "sauce",
  "jam",
  "pie",
  "soap",
  "cleaner",
  "concentrate",
  "syrup",
  "muffin",
  "bread",
  "smoothie",
  "gummy",
  "chocolate",
  "cake",
  "pastry",
  "snapple",
  "detox",
  "herbal",
  "seasoning",
  "spice",
  "zest",
  "peel",
  "faux",
  "book",
  "replica",
  "artificial",
  "leather",
  "honey",
  "curd",
  "dressing",
  "marinade",
  "glaze",
  "nectar",
  "lemonade",
  "candle",
  "lotion",
  "shampoo",
  "kefir",
  "bagel",
  "slush",
  "dessert",
  "milk",
  "roasted",
  "shortcake",
  "meringue",
  "waffle",
  "fillo",
  "phyllo",
  "tart",
  "bites",
  "artichoke",
  "cheese",
  "pepper",
  "spear",
  "spears",
  "cored",
  "oil",
  "loaf",
  "mochi",
  "turnover",
] as const;

/** Fresh produce shapes that must not win a frozen-bag staple. */
const FROZEN_FRESH_SHAPES = [
  "pint",
  "clamshell",
  "bunch",
  "bunched",
  "kefir",
] as const;

/** Fresh berry clamshells are pints / 1–2 lb, not 1.5–2 kg frozen bags. */
const FRESH_PACK_MAX_KG: Record<string, number> = {
  blueberries: 1.2,
  strawberries: 1.2,
};

/** PCX pints are often "1 ea" with no grams. */
const PINT_KG: Record<string, number> = {
  blueberries: 0.312,
  strawberries: 0.34,
  tomatoes_grape: 0.283,
};

const HOUSE_TOKENS = new Set([
  "no",
  "name",
  "farmer",
  "farmers",
  "market",
  "your",
  "fresh",
  "great",
  "value",
  "pc",
  "president",
  "presidents",
  "choice",
  "compliments",
  "organics",
  "selection",
  "irresistibles",
  "marketside",
  "driscoll",
  "driscolls",
]);

const SIZE_OR_FORM = new Set([
  "bag",
  "bags",
  "pack",
  "packed",
  "lb",
  "lbs",
  "kg",
  "g",
  "oz",
  "ea",
  "each",
  "single",
  "singles",
  "sold",
  "bunch",
  "whole",
  "fresh",
  "imperfect",
  "naturally",
  "english",
  "seedless",
  "greenhouse",
  "red",
  "green",
  "yellow",
  "grape",
  "cherry",
  "bell",
  "sweet",
  "bosc",
  "bartlett",
  "anjou",
  "roma",
  "vine",
  "long",
  "sliced",
  "chopped",
  "cultivated",
  "wild",
  "large",
  "jumbo",
  "golden",
  "medium",
  "small",
  "extra",
  "organic",
  "pint",
  "clamshell",
  "count",
  "ct",
  "pk",
  "product",
  "produce",
  "on",
  "the",
  "and",
  "of",
  "in",
  "by",
  "with",
  "for",
  "from",
]);

const TYPICAL_EACH_G: Record<string, number> = {
  lemons_2lb: 120,
  cucumber_english: 350,
  pineapple_whole: 1000,
};

export type CategoryBOffer = {
  productId: string;
  name: string;
  brand?: string;
  packageSize?: string;
  parsedMassKg?: number;
  sourceUrl?: string;
  price?: number;
  raw?: unknown;
  taxonomyText?: string;
};

export function isWarehouseCasePack(name: string): boolean {
  return /\bcase\b/i.test(name) || /\b\d+\s*x\s*\d+/i.test(name);
}

/** Prefer a single bag / each over a 5x1kg warehouse case when both exist. */
export function preferNonCasePacks<T extends { name: string }>(
  offers: T[],
): T[] {
  const singles = offers.filter((o) => !isWarehouseCasePack(o.name));
  return singles.length ? singles : offers;
}

export function usesCategoryBIdentity(item: StapleFilterItem): boolean {
  return isCategoryBStaple(item);
}

function stapleBlob(item: StapleFilterItem): string {
  return [
    item.id,
    item.category ?? "",
    ...(item.mustIncludeAny ?? []),
    ...(item.mustIncludeAll ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function stapleAllowsToken(item: StapleFilterItem, token: string): boolean {
  if (nameMatchesFilterToken(stapleBlob(item), token)) return true;
  if (token === "frozen" && item.category === "frozen") return true;
  if (token === "juice" && /juice|realemon/i.test(item.id)) return true;
  return false;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !/^\d+$/.test(t) && t.length > 1);
}

function stemToken(t: string): string {
  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith("oes") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && t.length > 3) return t.slice(0, -1);
  return t;
}

function tokenIn(t: string, allowed: Set<string> | string[]): boolean {
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  if (set.has(t) || set.has(stemToken(t))) return true;
  const stemmed = stemToken(t);
  for (const a of set) {
    if (stemToken(a) === stemmed) return true;
  }
  return false;
}

function isSizeToken(t: string): boolean {
  if (tokenIn(t, SIZE_OR_FORM)) return true;
  return /^\d+(\.\d+)?(lb|lbs|kg|g|oz|ml|l|ct|pk|ea)$/.test(t);
}

function coreProduceTokens(item: StapleFilterItem): string[] {
  const raw = [...(item.mustIncludeAny ?? []), ...(item.mustIncludeAll ?? [])];
  const out = new Set<string>();
  for (const phrase of raw) {
    for (const t of tokens(phrase)) {
      if (t !== "frozen") out.add(stemToken(t));
    }
  }
  return [...out];
}

export function isProcessedImpostor(
  item: StapleFilterItem,
  offer: { name: string; brand?: string; sourceUrl?: string },
): string | null {
  const hay = `${offer.brand ?? ""} ${offer.name} ${offer.sourceUrl ?? ""}`;
  const extra = item.rejectNameIncludes ?? [];
  for (const token of [...DEFAULT_PRODUCE_JUNK, ...extra]) {
    if (stapleAllowsToken(item, token)) continue;
    if (nameMatchesFilterToken(hay, token)) return token;
  }
  if (item.category === "frozen") {
    for (const token of FROZEN_FRESH_SHAPES) {
      if (nameMatchesFilterToken(hay, token)) return token;
    }
  }
  return null;
}

export function isEachSoldOffer(offer: {
  name?: string;
  packageSize?: string;
}): boolean {
  const blob = `${offer.packageSize ?? ""} ${offer.name ?? ""}`;
  if (/sold in singles/i.test(blob)) return true;
  if (/\b1\s*ea\b/i.test(blob)) return true;
  return false;
}

export function typicalEachGramsOf(item: StapleFilterItem): number | undefined {
  if (item.typicalEachGrams != null && item.typicalEachGrams > 0) {
    return item.typicalEachGrams;
  }
  return TYPICAL_EACH_G[item.id];
}

export function offerMassKg(
  item: StapleFilterItem,
  offer: CategoryBOffer,
): number | null {
  const each = typicalEachGramsOf(item);
  const blob = `${offer.packageSize ?? ""} ${offer.name ?? ""}`;
  // Produce "2 L" clamshells are volume, not 2 kg of fruit.
  const produceBlob =
    item.category === "produce"
      ? blob.replace(/\b\d+(?:\.\d+)?\s*l\b/gi, " ")
      : blob;
  const printedKg = packMassKg(produceBlob, null, null);
  if (printedKg != null && printedKg > 0) return printedKg;
  const pintKg = PINT_KG[item.id];
  if (pintKg && /\bpints?\b/i.test(blob)) return pintKg;
  if (each && isEachSoldOffer(offer)) return each / 1000;
  const cores = coreProduceTokens(item);
  const nameTok = tokens(offer.name);
  if (
    each &&
    nameTok.length > 0 &&
    nameTok.every((t) => tokenIn(t, cores) || isSizeToken(t) || tokenIn(t, HOUSE_TOKENS))
  ) {
    return each / 1000;
  }
  if (item.category === "produce") {
    return packMassKg(produceBlob, null, null);
  }
  return packMassKg(offer.name, offer.packageSize, offer.parsedMassKg);
}

function freshPackTooLarge(
  item: StapleFilterItem,
  offer: CategoryBOffer,
): boolean {
  const cap = FRESH_PACK_MAX_KG[item.id];
  if (cap == null) return false;
  const kg = offerMassKg(item, offer);
  return kg != null && kg > cap;
}

function leftoverHasJunk(
  item: StapleFilterItem,
  leftover: string[],
): boolean {
  return leftover.some((w) => {
    if (stapleAllowsToken(item, w)) return false;
    return DEFAULT_PRODUCE_JUNK.some((j) => nameMatchesFilterToken(w, j));
  });
}

function slugTokens(sourceUrl?: string): string[] {
  if (!sourceUrl) return [];
  try {
    const path = new URL(sourceUrl).pathname;
    const parts = path.split("/").filter(Boolean);
    const slug =
      parts.find(
        (p) =>
          p !== "en" &&
          p !== "p" &&
          p !== "ip" &&
          !/^\d/.test(p) &&
          p.length > 2,
      ) ?? "";
    return tokens(slug);
  } catch {
    return tokens(sourceUrl);
  }
}

function leftoverTokens(
  item: StapleFilterItem,
  words: string[],
): string[] {
  const cores = coreProduceTokens(item);
  return words.filter((t) => {
    if (tokenIn(t, cores)) return false;
    if (isSizeToken(t)) return false;
    if (tokenIn(t, HOUSE_TOKENS)) return false;
    return true;
  });
}

function looksLikeProduceTitle(
  item: StapleFilterItem,
  offer: CategoryBOffer,
): boolean {
  if (item.category === "frozen") return true;
  const leftover = leftoverTokens(
    item,
    tokens(`${offer.brand ?? ""} ${offer.name}`),
  );
  if (leftoverHasJunk(item, leftover)) return false;
  if (leftover.length === 0) return true;
  // Grower / origin / "premium" — processed junk is already rejected.
  return leftover.length <= 2;
}

function hasProducePackageShape(
  item: StapleFilterItem,
  offer: CategoryBOffer,
): boolean {
  if (item.category === "frozen") return true;
  if (packMassKg(offer.name, offer.packageSize, offer.parsedMassKg)) return true;
  if (isEachSoldOffer(offer)) return true;
  const cores = coreProduceTokens(item);
  const nameTok = tokens(offer.name);
  if (!nameTok.some((t) => tokenIn(t, cores))) return false;
  const leftover = leftoverTokens(item, nameTok);
  if (leftoverHasJunk(item, leftover)) return false;
  return leftover.length <= 2;
}

function looksLikeProduceSlug(
  item: StapleFilterItem,
  offer: CategoryBOffer,
): boolean {
  const slug = slugTokens(offer.sourceUrl);
  if (!slug.length) return true;
  if (isProcessedImpostor(item, { name: slug.join(" "), brand: "" })) {
    return false;
  }
  if (item.category === "frozen") return true;
  const leftover = leftoverTokens(item, slug);
  if (leftoverHasJunk(item, leftover)) return false;
  return leftover.length <= 1;
}

/**
 * MVR Cash & Carry titles look like "VEGETABLES - TOMATOES GRAPE 1 PINT".
 * Strip warehouse prefix / case / pint so category B identity still sees
 * the actual produce, without changing Walmart / No Frills / WC SKUs.
 */
function warehouseProduceView(offer: CategoryBOffer): CategoryBOffer {
  const brand = offer.brand ?? "";
  const rawName = offer.name ?? "";
  const warehouse =
    /^(fruits|vegetables)$/i.test(brand) ||
    /^(fruits|vegetables)\s*[-–]/i.test(rawName);
  return {
    ...offer,
    name: warehouseTitleView(rawName),
    brand: /^(fruits|vegetables)$/i.test(brand) ? undefined : offer.brand,
    sourceUrl: warehouse ? undefined : offer.sourceUrl,
  };
}

export function isActualCategoryBOffer(
  item: StapleFilterItem,
  offer: CategoryBOffer,
  extraHay?: string,
): boolean {
  if (isProcessedImpostor(item, offer)) return false;
  if (freshPackTooLarge(item, offer)) return false;
  const viewed = warehouseProduceView(offer);
  const filterFail = extraHay
    ? offerFailsStapleFilters(item, viewed.name, viewed.brand, extraHay)
    : offerFailsStapleOfferFilters(item, viewed);
  if (filterFail) return false;
  if (isProcessedImpostor(item, viewed)) return false;
  if (freshPackTooLarge(item, viewed)) return false;
  if (item.category === "frozen") return true;
  if (!hasProducePackageShape(item, viewed)) return false;
  if (!looksLikeProduceSlug(item, viewed)) return false;
  return looksLikeProduceTitle(item, viewed);
}

export function withTypicalEachMass<T extends CategoryBOffer>(
  item: StapleFilterItem,
  offer: T,
): T {
  const kg = offerMassKg(item, offer);
  if (kg == null) {
    if (offer.parsedMassKg !== 0) {
      return { ...offer, parsedMassKg: 0 };
    }
    return offer;
  }
  if (offer.parsedMassKg != null && Math.abs(offer.parsedMassKg - kg) < 1e-6) {
    return offer;
  }
  return { ...offer, parsedMassKg: kg };
}

export function isPackSizeSibling(
  item: StapleFilterItem,
  _anchor: CategoryBOffer,
  offer: CategoryBOffer,
): boolean {
  return isActualCategoryBOffer(item, offer);
}

export function samePackedItemCandidates<T extends CategoryBOffer>(
  item: StapleFilterItem,
  offers: T[],
  anchor?: T | null,
): T[] {
  const passing = offers
    .filter((offer) => isActualCategoryBOffer(item, offer))
    .map((offer) => withTypicalEachMass(item, offer));
  const seed =
    (anchor && passing.some((o) => o.productId === anchor.productId)
      ? passing.find((o) => o.productId === anchor.productId)
      : undefined) ?? passing[0];
  if (!seed) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const offer of passing) {
    if (!isPackSizeSibling(item, seed, offer)) continue;
    if (seen.has(offer.productId)) continue;
    seen.add(offer.productId);
    out.push(offer);
  }
  return out;
}

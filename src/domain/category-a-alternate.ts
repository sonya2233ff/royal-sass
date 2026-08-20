/**
 * Category A (exact / preferred) may name a second product.
 * If the primary SKU is missing, use the alternate. If both exist and
 * useIfCheaper is not false, pick the cheaper fair unit ($/L, $/kg).
 * This is not Category B cheapest-equivalent — only the named second product.
 */
import {
  offerFailsStapleOfferFilters,
  type StapleFilterItem,
  type StapleOfferFilterInput,
} from "@/domain/catalog-normalize";
import { pickCheapestByFairUnit } from "@/domain/matching";
import { identityKeywords, stripPackNoise } from "@/domain/pack-tokens";
import {
  canonicalizeMatchMode,
  inferMatchMode,
  normalizeAlternateProduct,
  type AlternateProduct,
  type MatchRules,
} from "@/domain/restaurant-product";

export type CategoryAAlternateHost = {
  id: string;
  label?: string;
  matchMode?: string;
  category?: string;
  alternateProduct?: AlternateProduct | null;
  queries?: string[];
  preferredProductId?: string;
  preferNameIncludes?: string[];
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
  rejectNameIncludes?: string[];
  matchRules?: MatchRules;
};

function mergeKeywordLists(
  ...lists: Array<readonly string[] | undefined>
): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const t = raw.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out.length ? out : undefined;
}

/** Exact / preferred — not produce/frozen/eggs cheapest. */
export function isCategoryAMatch(item: {
  id?: string;
  label?: string;
  matchMode?: string;
  category?: string;
}): boolean {
  const explicit = canonicalizeMatchMode(item.matchMode);
  if (explicit) return explicit === "exact";
  return inferMatchMode({
    id: item.id ?? "",
    label: item.label ?? item.id ?? "",
    matchMode: item.matchMode,
    category: item.category,
  }) === "exact";
}

export function hasCategoryAAlternate(
  item: CategoryAAlternateHost | StapleFilterItem,
): boolean {
  if (!isCategoryAMatch(item)) return false;
  return Boolean(normalizeAlternateProduct(item.alternateProduct));
}

export function categoryAAlternateQuery(
  item: { matchMode?: string; category?: string; id?: string; label?: string; alternateProduct?: AlternateProduct | null },
): string | null {
  if (!isCategoryAMatch(item)) return null;
  return normalizeAlternateProduct(item.alternateProduct)?.query ?? null;
}

function alternateIncludeTokens(alt: AlternateProduct): string[] {
  const explicit = identityKeywords(alt.mustIncludeAny);
  if (explicit.length) return explicit;
  const fromQuery = identityKeywords([stripPackNoise(alt.query)]);
  if (fromQuery.length) return fromQuery;
  return identityKeywords(alt.query.split(/\s+/));
}

/**
 * Virtual staple for the named alternate: own include tokens, unioned excludes,
 * no primary brand / preferred SKU / mustIncludeAll.
 */
export function asAlternateStapleView<T extends CategoryAAlternateHost>(
  item: T,
): T | null {
  const alt = normalizeAlternateProduct(item.alternateProduct);
  if (!alt || !isCategoryAMatch(item)) return null;
  const include = alternateIncludeTokens(alt);
  const mustIncludeAny = include.length ? include : [alt.query];
  const mustNotInclude = mergeKeywordLists(
    item.mustNotInclude,
    item.matchRules?.mustNotInclude,
    item.rejectNameIncludes,
    alt.mustNotInclude,
  );
  return {
    ...item,
    queries: [alt.query],
    preferredProductId: undefined,
    preferNameIncludes: undefined,
    mustIncludeAny,
    mustIncludeAll: undefined,
    mustNotInclude,
    rejectNameIncludes: undefined,
    matchRules: {
      form: item.matchRules?.form,
      variant: item.matchRules?.variant,
      mustIncludeAny,
      mustIncludeAll: undefined,
      mustNotInclude,
    },
    alternateProduct: undefined,
  };
}

export function offerPassesAlternateFilters(
  item: CategoryAAlternateHost,
  offer: StapleOfferFilterInput,
): boolean {
  const alt = asAlternateStapleView(item);
  if (!alt) return false;
  return offerFailsStapleOfferFilters(alt, offer) == null;
}

export function withCategoryAAlternateQueries(
  item: CategoryAAlternateHost,
  queries: string[],
): string[] {
  const altQ = categoryAAlternateQuery(item);
  if (!altQ) return queries;
  if (queries.some((q) => q.toLowerCase() === altQ.toLowerCase())) return queries;
  return [...queries, altQ];
}

/**
 * Earth's Own Original stays on the locked Zero Sugar SKU even when a cheaper
 * Original pack exists — unless that lock is missing.
 */
function keepLockedPrimaryIfPresent(item: { id: string }): boolean {
  return item.id === "oat_beverage_original";
}

export function pickCategoryAPrimaryOrAlternate<
  T extends {
    productId?: string;
    price: number;
    name: string;
    packageSize?: string;
    parsedMassKg?: number;
  },
>(
  item: { id: string; alternateProduct?: AlternateProduct | null },
  primary: T | null | undefined,
  alternate: T | null | undefined,
): T | null {
  const alt = alternate ?? null;
  const main = primary ?? null;
  if (!alt) return main;
  if (!main) return alt;
  if (item.alternateProduct?.useIfCheaper === false) return main;
  if (keepLockedPrimaryIfPresent(item)) return main;
  return pickCheapestByFairUnit([main, alt]) ?? main;
}

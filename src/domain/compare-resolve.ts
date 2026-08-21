/**
 * Pick the catalog offer that compare may use.
 *
 * Locked / verified identity → mapped SKU only (Rapid off-by-one allowed).
 * Cheapest produce → cheapest suitable catalog SKU (fair $/kg), else an alternate.
 * Never use a filtered-out winner (tomato seeds) as a grape-tomato price.
 *
 * Does not call Rapid or PCX.
 */
import {
  offerFailsStapleOfferFilters,
  type StapleFilterItem,
} from "@/domain/catalog-normalize";
import { eggCatalogSourceIds } from "@/domain/egg-pack";
import { pickCheapestByFairUnit } from "@/domain/matching";
import { pickNeededWeightPurchase } from "@/domain/needed-weight-pick";
import { pickCheapestCoveringOffer } from "@/domain/checkout";
import type { RestaurantProduct } from "@/domain/restaurant-product";
import {
  asAlternateStapleView,
  hasCategoryAAlternate,
  pickCategoryAPrimaryOrAlternate,
} from "@/domain/category-a-alternate";
import {
  isActualCategoryBOffer,
  preferNonCasePacks,
  samePackedItemCandidates,
  usesCategoryBIdentity,
  withTypicalEachMass,
} from "@/domain/same-packed-item";

/** Minimal mapping fields — avoid importing lib from domain. */
export interface MappingLinkRef {
  retailerProductId?: string;
  verified?: boolean;
  decision?: string;
  kind?: string;
  skippedRematch?: boolean;
}

export function mappingIsLockedIdentity(link?: MappingLinkRef): boolean {
  if (!link?.retailerProductId) return false;
  if (link.decision === "needs_review") return false;
  if (link.verified) return true;
  return (
    link.decision === "auto_linked" &&
    (link.kind === "identity" || Boolean(link.skippedRematch))
  );
}

export interface CatalogOfferRef {
  productId: string;
  name: string;
  price: number;
  packageSize?: string;
  parsedMassKg?: number;
  brand?: string;
  unitPrice?: number;
  wasPrice?: number;
  onSale?: boolean;
  confidence?: string;
  checkedAt?: string;
  sourceUrl?: string;
  availability?: string;
  image?: string;
  taxonomyText?: string;
}

export interface CatalogRowRef {
  id?: string;
  status?: string;
  offer: CatalogOfferRef | null;
  alternates?: CatalogOfferRef[] | null;
}

export type ResolveReason =
  | "catalog"
  | "mapped_sku"
  | "mapped_sku_rapid_alias"
  | "filtered_alternate"
  | "rejected_filter"
  | "mapped_sku_missing"
  | "no_offer";

/** Website listing can still be a price. `out_of_stock` is not a buyable offer. */
export function offerIsOnShelf(
  offer?: { availability?: string } | null,
): boolean {
  if (!offer) return false;
  return offer.availability !== "out_of_stock";
}

function numericIdsOffByOne(left: string, right: string): boolean {
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) return false;
  if (left.length !== right.length || left.length < 6) return false;
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return (a > b ? a - b : b - a) === 1n;
  } catch {
    return false;
  }
}

/**
 * Rapid sometimes returns Walmart.ca id ±1 vs the PDP URL.
 * URL matching belongs on offerMatchesRetailerSku (URL contains the *locked* id).
 */
export function retailerSkusEquivalent(
  left?: string | null,
  right?: string | null,
): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  return numericIdsOffByOne(left, right);
}

export function offerMatchesRetailerSku(
  offer: { productId: string; sourceUrl?: string | null },
  sku: string,
): boolean {
  if (!sku || !offer.productId) return false;
  if (offer.productId === sku) return true;
  if (offer.sourceUrl?.includes(sku)) return true;
  return numericIdsOffByOne(offer.productId, sku);
}

function passingCatalogOffers(
  item: StapleFilterItem,
  row?: CatalogRowRef | null,
): CatalogOfferRef[] {
  const out: CatalogOfferRef[] = [];
  for (const offer of catalogCandidates(row)) {
    if (!offerIsOnShelf(offer)) continue;
    if (usesCategoryBIdentity(item)) {
      if (!isActualCategoryBOffer(item, offer)) continue;
      out.push(withTypicalEachMass(item, offer));
      continue;
    } else if (offerFailsStapleOfferFilters(item, offer)) {
      continue;
    }
    out.push(offer);
  }
  return preferNonCasePacks(out);
}

function passingAlternateCatalogOffers(
  item: StapleFilterItem,
  row?: CatalogRowRef | null,
): CatalogOfferRef[] {
  const alt = asAlternateStapleView(item);
  if (!alt) return [];
  const out: CatalogOfferRef[] = [];
  for (const offer of catalogCandidates(row)) {
    if (!offerIsOnShelf(offer)) continue;
    if (offerFailsStapleOfferFilters(alt, offer)) continue;
    out.push(offer);
  }
  return preferNonCasePacks(out);
}

function resolveCategoryAWithAlternate(
  item: StapleFilterItem,
  row: CatalogRowRef | null | undefined,
  primary: CatalogOfferRef | null,
  detail?: string,
): {
  offer: CatalogOfferRef | null;
  reason: ResolveReason;
  detail?: string;
} | null {
  if (!hasCategoryAAlternate(item)) return null;
  const altPool = passingAlternateCatalogOffers(item, row).filter(
    (o) => o.productId !== primary?.productId,
  );
  const alternate = pickCheapestByFairUnit(altPool);
  const chosen = pickCategoryAPrimaryOrAlternate(item, primary, alternate);
  if (!chosen) return null;
  if (primary && chosen.productId === primary.productId) {
    return null;
  }
  return {
    ...resolveFromOffer(chosen, row, detail ?? "category A alternate"),
    detail: primary
      ? "category A alternate cheaper (fair unit)"
      : "category A alternate fallback",
  };
}

function resolveFromOffer(
  offer: CatalogOfferRef,
  row?: CatalogRowRef | null,
  detail?: string,
): {
  offer: CatalogOfferRef;
  reason: ResolveReason;
  detail?: string;
} {
  const fromWinner = offer.productId === row?.offer?.productId;
  return {
    offer,
    reason: fromWinner ? "catalog" : "filtered_alternate",
    detail,
  };
}

export function catalogCandidates(
  row?: CatalogRowRef | null,
): CatalogOfferRef[] {
  if (!row) return [];
  const out: CatalogOfferRef[] = [];
  if (row.offer?.productId) out.push(row.offer);
  for (const alt of row.alternates ?? []) {
    if (alt?.productId && !out.some((o) => o.productId === alt.productId)) {
      out.push(alt);
    }
  }
  return out;
}

/** Union offer + alternates from several catalog rows (Large Eggs ← Grayridge / 30ct). */
export function mergeCatalogRows<T extends CatalogRowRef>(
  rows: Array<T | null | undefined>,
): T | null {
  const present = rows.filter((row): row is T => row != null);
  if (!present.length) return null;
  const seen = new Set<string>();
  const offers: CatalogOfferRef[] = [];
  for (const row of present) {
    for (const offer of catalogCandidates(row)) {
      if (seen.has(offer.productId)) continue;
      seen.add(offer.productId);
      offers.push(offer);
    }
  }
  if (!offers.length) return present[0]!;
  return {
    ...present[0]!,
    offer: offers[0] as T["offer"],
    alternates: offers.slice(1) as NonNullable<T["alternates"]>,
  };
}

export function catalogRowForStaple<T extends CatalogRowRef>(
  item: { id: string },
  byId: { get(id: string): T | undefined },
): T | null {
  return mergeCatalogRows(
    eggCatalogSourceIds(item).map((id) => byId.get(id)),
  );
}

export function findOfferForSku(
  row: CatalogRowRef | null | undefined,
  sku: string,
): CatalogOfferRef | null {
  if (!sku) return null;
  for (const offer of catalogCandidates(row)) {
    if (offerMatchesRetailerSku(offer, sku)) {
      return offer;
    }
  }
  return null;
}

export function offerPassesStapleFilters(
  item: StapleFilterItem,
  offer: { name: string; brand?: string; packageSize?: string; raw?: unknown },
): boolean {
  return offerFailsStapleOfferFilters(item, offer) == null;
}

/** WM #5831 Earth's Own Zero Sugar 1.75L — the only oat lock that may fail mustNotInclude. */
export const OAT_WM_ZERO_SUGAR_ID = "2ADJVX8MAQ1Q";

/**
 * Earth's Own Original oat at WM #5831 is locked to Zero Sugar 1.75L
 * `2ADJVX8MAQ1Q` (same shelf as Original `54TFZVS2LHS3`). Operator exception —
 * do not rematch off this SKU even though mustNotInclude has "zero sugar".
 * Does **not** apply to MVR 946 ml / 12x946 case (or any other oat SKU).
 */
export function identityLockAllowsFilterMismatch(
  item: { id: string },
  skuOrOffer?: string | { productId?: string } | null,
): boolean {
  if (item.id !== "oat_beverage_original") return false;
  const sku =
    typeof skuOrOffer === "string" ? skuOrOffer : skuOrOffer?.productId;
  if (!sku) return false;
  return offerMatchesRetailerSku({ productId: sku }, OAT_WM_ZERO_SUGAR_ID);
}

/** Category B / eggs: a verified SKU must not hide a cheaper equivalent pack. */
export function cheapestMatchSkipsIdentityLock(item: StapleFilterItem): boolean {
  return (
    item.category === "eggs" ||
    item.category === "produce" ||
    item.category === "frozen" ||
    item.id === "large_eggs_dozen"
  );
}

export function resolveCatalogOffer(input: {
  item: StapleFilterItem;
  row?: CatalogRowRef | null;
  link?: MappingLinkRef;
  matchMode: "preferred" | "cheapest";
  /** Category B only: pick among catalog sizes for this needed weight. */
  neededGrams?: number;
  /** Category A: pick the cheapest checkout that covers this amount. */
  product?: RestaurantProduct;
  requested?: number;
}): {
  offer: CatalogOfferRef | null;
  reason: ResolveReason;
  detail?: string;
} {
  const mappedSku = input.link?.retailerProductId;
  const lockIdentity =
    mappingIsLockedIdentity(input.link) &&
    !(input.matchMode === "cheapest" && cheapestMatchSkipsIdentityLock(input.item));
  if (lockIdentity && mappedSku) {
    const hit = findOfferForSku(input.row, mappedSku);
    if (hit && offerIsOnShelf(hit)) {
      if (
        identityLockAllowsFilterMismatch(input.item, hit) ||
        offerPassesStapleFilters(input.item, hit)
      ) {
        const alias = hit.productId !== mappedSku;
        const mapped = {
          offer: hit,
          reason: (alias ? "mapped_sku_rapid_alias" : "mapped_sku") as ResolveReason,
          detail: alias
            ? `Rapid id ${hit.productId} ≈ lock ${mappedSku}`
            : mappedSku,
        };
        const swapped = resolveCategoryAWithAlternate(
          input.item,
          input.row,
          hit,
        );
        return swapped ?? mapped;
      }
      // Locked SKU fails mustNotInclude — nearest passing alternate below.
    }
    // Missing or not on the shelf → nearest filter-passing alternate below.
  }

  if (
    input.matchMode === "cheapest" &&
    input.neededGrams != null &&
    input.neededGrams > 0
  ) {
    const passing = samePackedItemCandidates(
      input.item,
      catalogCandidates(input.row).filter(offerIsOnShelf),
      offerIsOnShelf(input.row?.offer) ? input.row?.offer : undefined,
    );
    const picked = pickNeededWeightPurchase(input.neededGrams, passing);
    if (picked) {
      const offer =
        passing.find((o) => o.productId === picked.productId) ?? passing[0];
      if (offer) {
        const fromWinner = offer.productId === input.row?.offer?.productId;
        return {
          offer,
          reason: fromWinner ? "catalog" : "filtered_alternate",
          detail: `needed ${input.neededGrams}g → ${picked.packs}×${picked.packGrams}g`,
        };
      }
    }
  }

  const passing = passingCatalogOffers(input.item, input.row);
  if (passing.length) {
    if (input.matchMode === "cheapest") {
      const cheapest = pickCheapestByFairUnit(passing);
      if (cheapest) return resolveFromOffer(cheapest, input.row);
    } else if (
      input.product &&
      input.requested != null &&
      input.requested > 0
    ) {
      const covering = pickCheapestCoveringOffer(
        input.product,
        input.requested,
        passing,
      );
      if (covering) {
        const swapped = resolveCategoryAWithAlternate(
          input.item,
          input.row,
          covering,
        );
        if (swapped) return swapped;
        return resolveFromOffer(
          covering,
          input.row,
          `cover ${input.requested} with checkout`,
        );
      }
    }
    const primary = passing[0]!;
    const swapped = resolveCategoryAWithAlternate(
      input.item,
      input.row,
      primary,
    );
    if (swapped) return swapped;
    return resolveFromOffer(primary, input.row);
  }

  const altOnly = resolveCategoryAWithAlternate(input.item, input.row, null);
  if (altOnly?.offer) return altOnly;

  if (input.row?.offer) {
    if (!offerIsOnShelf(input.row.offer)) {
      return {
        offer: null,
        reason: "no_offer",
        detail: "listed SKU not on the shelf — need an alternate",
      };
    }
    return {
      offer: null,
      reason: "rejected_filter",
      detail:
        offerFailsStapleOfferFilters(input.item, input.row.offer) ?? "filter",
    };
  }

  return { offer: null, reason: "no_offer" };
}

/**
 * Price-only refresh: locked/confirmed SKU stays. Otherwise refresh the first
 * catalog SKU that still passes identity filters (winner, then alternates).
 * Never keep pumping a grape-tomato handle onto the round-tomato card.
 */
export function catalogSkuForPriceRefresh(input: {
  item: StapleFilterItem;
  row?: CatalogRowRef | null;
  link?: MappingLinkRef;
  confirmedProductId?: string;
  preferredProductId?: string;
}): string | null {
  if (mappingIsLockedIdentity(input.link) && input.link?.retailerProductId) {
    return input.link.retailerProductId;
  }
  if (input.confirmedProductId) return input.confirmedProductId;
  for (const offer of catalogCandidates(input.row)) {
    if (!(offer.price > 0)) continue;
    if (!offerIsOnShelf(offer)) continue;
    if (offerFailsStapleOfferFilters(input.item, offer)) continue;
    return offer.productId;
  }
  return input.preferredProductId ?? null;
}

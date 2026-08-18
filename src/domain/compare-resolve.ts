/**
 * Pick the catalog offer that compare may use.
 *
 * Locked / verified identity → mapped SKU only (Rapid off-by-one allowed).
 * Cheapest produce → catalog winner if staple filters pass, else an alternate.
 * Never use a filtered-out winner (tomato seeds) as a grape-tomato price.
 *
 * Does not call Rapid or PCX.
 */
import {
  offerFailsStapleOfferFilters,
  type StapleFilterItem,
} from "@/domain/catalog-normalize";
import { pickNeededWeightPurchase } from "@/domain/needed-weight-pick";
import {
  isActualCategoryBOffer,
  samePackedItemCandidates,
  usesCategoryBIdentity,
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

export function resolveCatalogOffer(input: {
  item: StapleFilterItem;
  row?: CatalogRowRef | null;
  link?: MappingLinkRef;
  matchMode: "preferred" | "cheapest";
  /** Category B only: pick among catalog sizes for this needed weight. */
  neededGrams?: number;
}): {
  offer: CatalogOfferRef | null;
  reason: ResolveReason;
  detail?: string;
} {
  const mappedSku = input.link?.retailerProductId;
  if (mappingIsLockedIdentity(input.link) && mappedSku) {
    const hit = findOfferForSku(input.row, mappedSku);
    if (hit && offerIsOnShelf(hit)) {
      const alias = hit.productId !== mappedSku;
      return {
        offer: hit,
        reason: alias ? "mapped_sku_rapid_alias" : "mapped_sku",
        detail: alias
          ? `Rapid id ${hit.productId} ≈ lock ${mappedSku}`
          : mappedSku,
      };
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

  for (const offer of catalogCandidates(input.row)) {
    if (!offerIsOnShelf(offer)) continue;
    if (usesCategoryBIdentity(input.item)) {
      if (!isActualCategoryBOffer(input.item, offer)) continue;
    } else if (offerFailsStapleOfferFilters(input.item, offer)) {
      continue;
    }
    const fromWinner = offer.productId === input.row?.offer?.productId;
    return {
      offer,
      reason: fromWinner ? "catalog" : "filtered_alternate",
    };
  }

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

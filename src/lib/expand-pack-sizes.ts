/**
 * Category B packed compare: if the catalog only has a huge bag
 * (cover fallback), search that store for other pack sizes and merge them.
 * Same path for Walmart and No Frills. Does not rematch category A.
 */
import { catalogCandidates, mappingIsLockedIdentity } from "@/domain/compare-resolve";
import {
  mergeDistinctPackSizes,
  needsMorePackSizes,
  splitOfferAndAlternates,
} from "@/domain/pack-size-candidates";
import type { MappingLinkRef } from "@/domain/compare-resolve";
import type { ProductOffer } from "@/connectors/types";
import {
  catalogOfferFromLive,
  isSoldByWeightItem,
  resolveMatchMode,
  upsertNoFrillsCatalogItem,
  upsertWalmartCatalogItem,
  usesNeededWeightPick,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";
import { offerFailsStapleFilters } from "@/domain/catalog-normalize";

export function shouldExpandPackSizes(input: {
  item: StapleItem;
  neededGrams?: number;
  link?: MappingLinkRef;
  row?: {
    offer: CatalogOffer | null;
    alternates?: CatalogOffer[] | null;
  } | null;
}): boolean {
  if (input.neededGrams == null || !(input.neededGrams > 0)) return false;
  if (!usesNeededWeightPick(input.item) || isSoldByWeightItem(input.item)) {
    return false;
  }
  if (resolveMatchMode(input.item) !== "cheapest") return false;
  if (mappingIsLockedIdentity(input.link)) return false;
  const passing = catalogCandidates(input.row).filter(
    (offer) =>
      offerFailsStapleFilters(input.item, offer.name, offer.brand) == null,
  );
  return needsMorePackSizes(input.neededGrams, passing);
}

export function mergeLivePackSizes(input: {
  row?: {
    offer: CatalogOffer | null;
    alternates?: CatalogOffer[] | null;
    status?: string;
  } | null;
  live: ProductOffer[];
  keepProductId?: string | null;
}): {
  offer: CatalogOffer | null;
  alternates: CatalogOffer[];
} {
  const incoming = input.live.map(catalogOfferFromLive);
  const merged = mergeDistinctPackSizes([
    ...catalogCandidates(input.row),
    ...incoming,
  ]);
  return splitOfferAndAlternates(merged, input.keepProductId);
}

export async function persistPackSizeRow(input: {
  retailer: "walmart_ca" | "no_frills";
  id: string;
  label: string;
  offer: CatalogOffer | null;
  alternates: CatalogOffer[];
  notes: string;
  image?: string;
}): Promise<void> {
  if (input.retailer === "no_frills") {
    await upsertNoFrillsCatalogItem({
      id: input.id,
      label: input.label,
      status: input.offer ? "ok" : "no_match",
      offer: input.offer,
      alternates: input.offer ? input.alternates : [],
      notes: input.notes,
    });
    return;
  }
  await upsertWalmartCatalogItem({
    id: input.id,
    label: input.label,
    status: input.offer ? "ok" : "no_match",
    offer: input.offer,
    alternates: input.offer ? input.alternates : [],
    notes: input.notes,
    image: input.image,
  });
}

export function packSizeNotes(
  retailer: "walmart_ca" | "no_frills",
  sizeCount: number,
): string {
  const store = retailer === "walmart_ca" ? "WM" : "NF";
  return `Live ${store} pack sizes (${sizeCount})`;
}

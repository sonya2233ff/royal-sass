/**
 * Turn cached retailer catalog rows into ProductRecord.
 * Master identity is the staple id (cafe-staples), never a No Frills SKU.
 */
import { extractBarcodes, packMassKg } from "@/domain/fair-compare";
import { normalizeName, type ProductRecord } from "@/domain/entity-match";

export const NOFRILLS_RETAILER = "nofrills";
export const WALMART_RETAILER = "walmart_ca";
export const SOBEYS_RETAILER = "sobeys";

export interface StapleFilterItem {
  id: string;
  category?: string;
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
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
  const hits = item.mustIncludeAny ?? [];
  const brandish = hits.find(
    (s) =>
      s.length >= 4 &&
      !/\d/.test(s) &&
      !/(tomato|milk|egg|oil|sugar|flour|butter)/i.test(s),
  );
  return brandish;
}

export function offerFailsStapleFilters(
  item: StapleFilterItem,
  name: string,
): string | null {
  const n = name.toLowerCase();
  for (const bad of item.mustNotInclude ?? []) {
    if (bad && n.includes(bad.toLowerCase())) return `mustNotInclude:${bad}`;
  }
  const all = item.mustIncludeAll ?? [];
  for (const need of all) {
    if (need && !n.includes(need.toLowerCase())) return `mustIncludeAll:${need}`;
  }
  const any = item.mustIncludeAny ?? [];
  if (any.length > 0 && !any.some((s) => s && n.includes(s.toLowerCase()))) {
    return "mustIncludeAny";
  }
  return null;
}

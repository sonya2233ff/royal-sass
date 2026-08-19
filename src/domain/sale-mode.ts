/**
 * How a store sells an offer.
 *
 * Purchase unit (pack / ea / case) is not content measure (800 g, 5 lb, 1 L).
 * g/kg/oz/lb in the title is content, not proof of loose scale sale.
 * A $/kg label is not enough to treat a bag, basket, or 15 lb case as loose.
 */
import { parseMassFromText, parseEmbeddedWeightRates } from "@/domain/units";
import { parseMassKg, parseVolumeMl } from "@/domain/purchase-units";

export type SaleMode = "loose_weight" | "fixed_pack" | "case";
export type PurchaseUnit = "pack" | "ea" | "case";

export interface OfferSaleInput {
  name: string;
  packageSize?: string;
  parsedMassKg?: number;
  /** Cafe typically buys this staple in kg — not “this SKU is sold at the scale”. */
  stapleSoldByWeight?: boolean;
}

export interface OfferSaleShape {
  saleMode: SaleMode;
  purchaseUnit: PurchaseUnit;
  contentKg: number | null;
  contentMl: number | null;
}

const CASE_WORD_RE = /\b(cases?|crates?)\b/i;
const CASE_WEIGHT_RE = /\b\d+(?:\.\d+)?\s*(lb|lbs|kg)\s*cases?\b/i;
/** 12 x 1 pint, 15x1 DOZ, 10x18EA, 5x1 kg — not 10x15 sheet size. */
const MULTI_PACK_UNIT_RE =
  /\b\d+\s*[x×]\s*\d+(?:\.\d+)?\s*(ea|pk|packs?|pints?|kg|g|lb|lbs|oz|ct|count|doz|dozen|ml|l|lt)\b/i;
const PACK_CONTAINER_RE =
  /\b(packs?|bags?|clamshells?|cartons?|tubs?|jars?|bottles?|pouches?|sleeves?|trays?|baskets?|boxes?|punnets?)\b/i;
const EACH_RE = /\b(1\s*ea|sold in singles|sold in single wrap)\b/i;
const LOOSE_RATE_RE =
  /\b(per\s*kg|per\s*lb|\/\s*kg|\/\s*lb|loose|bulk|sold\s*by\s*(the\s*)?(kg|lb|weight))\b/i;

function blob(input: OfferSaleInput): string {
  return `${input.name} ${input.packageSize ?? ""}`.trim();
}

export function hasExplicitWeightRate(input: OfferSaleInput): boolean {
  const text = blob(input);
  const embedded = parseEmbeddedWeightRates(text);
  if (embedded.perKg != null || embedded.perLb != null) return true;
  return LOOSE_RATE_RE.test(text);
}

/**
 * Content mass printed on the offer, excluding $/kg crumbs.
 * Does not use typical-each guesses — those stay at purchase time.
 */
export function offerContentKg(input: OfferSaleInput): number | null {
  const text = blob(input);
  const printed = parseMassFromText(text);
  if (
    printed &&
    printed.kg > 0 &&
    printed.unit !== "ml" &&
    printed.unit !== "l"
  ) {
    return printed.kg;
  }
  const mass = parseMassKg(text);
  if (mass != null && mass > 0) return mass;
  if (hasExplicitWeightRate(input)) return null;
  if (input.parsedMassKg != null && input.parsedMassKg > 0) {
    return input.parsedMassKg;
  }
  return null;
}

function isWarehouseCase(text: string): boolean {
  if (CASE_WEIGHT_RE.test(text)) return true;
  if (CASE_WORD_RE.test(text)) return true;
  if (MULTI_PACK_UNIT_RE.test(text)) return true;
  return false;
}

export function describeOfferSale(input: OfferSaleInput): OfferSaleShape {
  const text = blob(input);
  const kg = offerContentKg(input);
  const ml = parseVolumeMl(text);
  const each = EACH_RE.test(text);
  const container = PACK_CONTAINER_RE.test(text) || /sold in packs/i.test(text);
  const rate = hasExplicitWeightRate(input);

  if (isWarehouseCase(text)) {
    return {
      saleMode: "case",
      purchaseUnit: "case",
      contentKg: kg,
      contentMl: ml,
    };
  }

  const discretePack =
    container ||
    each ||
    (kg != null && kg > 0 && !rate);

  if (discretePack) {
    return {
      saleMode: "fixed_pack",
      purchaseUnit: each ? "ea" : "pack",
      contentKg: kg,
      contentMl: ml,
    };
  }

  if (rate) {
    return {
      saleMode: "loose_weight",
      purchaseUnit: "pack",
      contentKg: kg,
      contentMl: ml,
    };
  }

  if (input.stapleSoldByWeight && !container && !each && kg == null) {
    return {
      saleMode: "loose_weight",
      purchaseUnit: "pack",
      contentKg: null,
      contentMl: ml,
    };
  }

  return {
    saleMode: "fixed_pack",
    purchaseUnit: "pack",
    contentKg: kg,
    contentMl: ml,
  };
}

export function inferSaleMode(input: OfferSaleInput): SaleMode {
  return describeOfferSale(input).saleMode;
}

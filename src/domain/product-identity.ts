/**
 * Identity checks independent of how much we buy.
 */
import { packsSimilar } from "@/domain/fair-compare";
import { nameMatchesFilterToken } from "@/domain/catalog-normalize";
import { parseMassKg, parseVolumeMl } from "@/domain/purchase-units";
import type { RestaurantProduct } from "@/domain/restaurant-product";
import {
  isActualCategoryBOffer,
  usesCategoryBIdentity,
} from "@/domain/same-packed-item";

export interface IdentityOffer {
  productId?: string;
  name: string;
  brand?: string;
  packageSize?: string;
  upc?: string;
  parsedMassKg?: number;
}

export interface IdentityResult {
  ok: boolean;
  reason?: string;
}

function hay(offer: IdentityOffer): string {
  return `${offer.brand ?? ""} ${offer.name} ${offer.packageSize ?? ""}`.toLowerCase();
}

function hasToken(text: string, token: string): boolean {
  return nameMatchesFilterToken(text, token);
}

function bannedFormMismatch(product: RestaurantProduct, text: string): string | null {
  const form = (product.matchRules?.form ?? product.category ?? "").toLowerCase();
  if (form === "fresh" || product.category === "produce") {
    if (/\b(canned|can|tin|tinned)\b/.test(text)) return "fresh ≠ canned";
    if (/\b(sauce|paste|juice|ketchup|salsa|soup)\b/.test(text)) {
      return "fresh tomato ≠ sauce/paste/juice";
    }
    if (/\bfrozen\b/.test(text) && form !== "frozen") return "fresh ≠ frozen";
  }
  if (form === "frozen" || product.category === "frozen") {
    if (/\bfresh\b/.test(text) && !/\bfrozen\b/.test(text)) return "frozen ≠ fresh";
  }
  const type = (product.matchRules?.productType ?? "").toLowerCase();
  if (type === "quinoa" || /quinoa/.test(product.id) || /quinoa/.test(product.label.toLowerCase())) {
    const wantWhite = /\bwhite\b/.test(`${product.label} ${product.matchRules?.variant ?? ""}`.toLowerCase());
    if (wantWhite && /\b(red|black|tricolor|tri-color)\b/.test(text) && !/\bwhite\b/.test(text)) {
      return "white quinoa ≠ red/black quinoa";
    }
  }
  const variant = (product.matchRules?.variant ?? "").toLowerCase();
  if (variant === "rectangular" || /\brect/.test(product.label.toLowerCase())) {
    if (/\bround\b/.test(text)) return "rectangular ≠ round";
  }
  if (variant === "round" && /\brectang/.test(text)) return "round ≠ rectangular";
  return null;
}

function keywordsPass(product: RestaurantProduct, text: string): string | null {
  const rules = product.matchRules ?? {};
  for (const n of rules.mustNotInclude ?? []) {
    if (n && hasToken(text, n)) return `mustNotInclude: ${n}`;
  }
  if (rules.mustIncludeAll?.length) {
    for (const n of rules.mustIncludeAll) {
      if (n && !hasToken(text, n)) return `mustIncludeAll missing: ${n}`;
    }
  }
  if (rules.mustIncludeAny?.length) {
    const ok = rules.mustIncludeAny.some((n) => n && hasToken(text, n));
    if (!ok) return "mustIncludeAny";
  }
  if (rules.productType && !hasToken(text, rules.productType)) {
    const any = rules.mustIncludeAny?.some((n) => hasToken(text, n));
    if (!any) return `productType: ${rules.productType}`;
  }
  return null;
}

function sizeCompatible(
  product: RestaurantProduct,
  offer: IdentityOffer,
  exact: boolean,
): string | null {
  if (!exact) return null;
  const text = `${offer.name} ${offer.packageSize ?? ""}`;
  const want = `${product.label} ${product.preferredProductId ?? ""}`;
  const wantL = parseVolumeMl(want);
  const gotL = parseVolumeMl(text);
  if (wantL && gotL) {
    const a = wantL / 1000;
    const b = gotL / 1000;
    if (!packsSimilar(a, b, 0.08)) return `size ${gotL}ml ≠ ${wantL}ml`;
  }
  const wantKg = parseMassKg(want);
  const gotKg = parseMassKg(text) ?? offer.parsedMassKg ?? null;
  if (wantKg && gotKg && !packsSimilar(wantKg, gotKg, 0.08)) {
    return `size ${gotKg}kg ≠ ${wantKg}kg`;
  }
  if (/\bextra\s*large\b/.test(text) && /\blarge\b/.test(product.label.toLowerCase()) && !/\bextra\b/.test(product.label.toLowerCase())) {
    return "Large ≠ Extra Large";
  }
  return null;
}

export function offerMatchesIdentity(input: {
  product: RestaurantProduct;
  offer: IdentityOffer;
  confirmedProductId?: string;
  preferredUpc?: string;
}): IdentityResult {
  const { product, offer } = input;
  const text = hay(offer);

  if (
    input.confirmedProductId &&
    offer.productId &&
    (offer.productId === input.confirmedProductId ||
      offer.productId.includes(input.confirmedProductId) ||
      input.confirmedProductId.includes(offer.productId))
  ) {
    return { ok: true };
  }

  if (product.matchMode === "exact") {
    if (input.preferredUpc && offer.upc && offer.upc.replace(/\D/g, "").endsWith(input.preferredUpc.replace(/\D/g, "").slice(-12))) {
      return { ok: true };
    }
    if (product.preferredProductId && offer.productId === product.preferredProductId) {
      return { ok: true };
    }
    const kw = keywordsPass(product, text);
    if (kw) return { ok: false, reason: kw };
    const form = bannedFormMismatch(product, text);
    if (form) return { ok: false, reason: form };
    const size = sizeCompatible(product, offer, true);
    if (size) return { ok: false, reason: size };
    if (/\bfree\s*run\b/.test(text) && (product.matchRules?.mustNotInclude ?? []).some((x) => /free\s*run/i.test(x))) {
      return { ok: false, reason: "Free Run forbidden" };
    }
    const brand = product.label.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (
      product.preferredProductId &&
      offer.productId !== product.preferredProductId &&
      brand.length > 2 &&
      !/^\d/.test(brand) &&
      !hasToken(text, brand)
    ) {
      return { ok: false, reason: "no match" };
    }
    if (
      !product.preferredProductId &&
      !input.preferredUpc &&
      !input.confirmedProductId
    ) {
      const type =
        product.matchRules?.productType ||
        product.matchRules?.mustIncludeAny?.[0] ||
        brand;
      if (type && !hasToken(text, type)) {
        return { ok: false, reason: "no match" };
      }
    }
    return { ok: true };
  }

  const kw = keywordsPass(product, text);
  if (kw) return { ok: false, reason: kw };
  const form = bannedFormMismatch(product, text);
  if (form) return { ok: false, reason: form };
  if (usesCategoryBIdentity({ id: product.id, category: product.category })) {
    if (
      !isActualCategoryBOffer(
        {
          id: product.id,
          category: product.category,
          mustIncludeAny: product.matchRules?.mustIncludeAny,
          mustIncludeAll: product.matchRules?.mustIncludeAll,
          mustNotInclude: product.matchRules?.mustNotInclude,
        },
        {
          productId: offer.productId ?? "",
          name: offer.name,
          brand: offer.brand,
          packageSize: offer.packageSize,
          parsedMassKg: offer.parsedMassKg,
        },
      )
    ) {
      return { ok: false, reason: "category B identity" };
    }
  }
  return { ok: true };
}

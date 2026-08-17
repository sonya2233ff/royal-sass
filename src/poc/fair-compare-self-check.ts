/**
 * Fair-compare + UPC matching checks (daam-kemon / SmartCart rules).
 *   npx tsx src/poc/fair-compare-self-check.ts
 */
import {
  basketAmountForSide,
  extractBarcodes,
  fairCompareSides,
  normalizeUpc,
  packsSimilar,
  pricePerKgFromPack,
  upcsMatch,
} from "@/domain/fair-compare";
import { pickBestOffer } from "@/domain/matching";
import type { ProductOffer } from "@/connectors/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function offer(
  partial: Partial<ProductOffer> & Pick<ProductOffer, "productId" | "name" | "price">,
): ProductOffer {
  return {
    retailer: "walmart_ca",
    storeId: "5831",
    availability: "in_stock",
    confidence: "exact",
    checkedAt: "2026-08-16T00:00:00.000Z",
    ...partial,
  };
}

assert(normalizeUpc("066181001557") === "66181001557", "strip leading zero");
assert(upcsMatch("066181001557", "66181001557"), "upc leading zero");
assert(extractBarcodes("grape", "628915235420")[0] === "628915235420", "barcode from queries");
assert(!packsSimilar(0.283, 0.907), "grape packs not similar");
assert(packsSimilar(0.454, 0.454), "butter packs similar");

const wmGrape = pricePerKgFromPack(2.97, "YFM Grape 10 oz", "283 g");
const nfGrape = pricePerKgFromPack(7.99, "Grape Tomato", "907 g, $0.88/100g");
assert(wmGrape != null && nfGrape != null, "grape $/kg");
assert(wmGrape > nfGrape, "NF cheaper per kg of grapes");

const grape = fairCompareSides(
  {
    ok: true,
    shelfPrice: 2.97,
    lineTotal: 2.97,
    pricePerKg: wmGrape,
    packKg: 0.283,
  },
  {
    ok: true,
    shelfPrice: 7.99,
    lineTotal: 7.99,
    pricePerKg: nfGrape,
    packKg: 0.907,
  },
);
assert(grape.fairBasis === "per_kg", `grape basis ${grape.fairBasis}`);
assert(grape.cheaper === "nofrills", `grape cheaper ${grape.cheaper}`);
assert(
  (basketAmountForSide(grape, "walmart", 2.97) ?? 0) > 8,
  "basket uses $/kg not tiny pack",
);

const butter = fairCompareSides(
  { ok: true, shelfPrice: 7.96, lineTotal: 7.96, packKg: 0.454 },
  { ok: true, shelfPrice: 8.29, lineTotal: 8.29, packKg: 0.454 },
);
assert(butter.fairBasis === "per_pack", `butter ${butter.fairBasis}`);
assert(butter.cheaper === "walmart", "butter WM");

const eggs = fairCompareSides(
  { ok: true, isEgg: true, pricePerEach: 3.93 / 12, lineTotal: 9.825 },
  { ok: true, isEgg: true, pricePerEach: 3.93 / 12, lineTotal: 9.825 },
);
assert(eggs.fairBasis === "per_egg", "eggs per egg");
assert(eggs.cheaper === "tie", "eggs tie");

const upcHit = pickBestOffer(
  [
    offer({ productId: "aaa", name: "Wrong Milk 2L", price: 4.99, upc: "111111111111" }),
    offer({
      productId: "6000198384699",
      name: "Mehadrin 2% 2LT milk",
      price: 6.47,
      upc: "066181001557",
    }),
  ],
  "mehadrin 2% milk",
  undefined,
  { preferredUpc: "066181001557", mode: "preferred" },
);
assert(upcHit?.productId === "6000198384699", "UPC-first pick");

console.log("fair-compare-self-check ok", {
  grape: { cheaper: grape.cheaper, basis: grape.fairBasis, wm: grape.wmFair, nf: grape.nfFair },
  butter: { cheaper: butter.cheaper, basis: butter.fairBasis },
});

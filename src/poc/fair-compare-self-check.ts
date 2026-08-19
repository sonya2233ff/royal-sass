/**
 * Fair-compare + UPC matching checks (daam-kemon / SmartCart rules).
 *   npx tsx src/poc/fair-compare-self-check.ts
 */
import {
  basketAmountForSide,
  extractBarcodes,
  fairCompareSides,
  fairCompareThree,
  normalizeUpc,
  packsSimilar,
  pricePerKgFromPack,
  scaleBasketAmount,
  upcsMatch,
} from "@/domain/fair-compare";
import { pickBestOffer, pickCheapestOffer, scoreOfferMatch } from "@/domain/matching";
import { stapleBrandHint } from "@/domain/catalog-normalize";
import { sanityCheckOffer } from "@/domain/sanity";
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
assert(grape.fairBasis === "per_100g", `grape basis ${grape.fairBasis}`);
assert(grape.cheaper === "nofrills", `grape cheaper ${grape.cheaper}`);
assert(
  grape.wmFair != null &&
    grape.wmFair < 2 &&
    grape.nfFair != null &&
    grape.nfFair < 2,
  `grape deal is $/100g, got wm=${grape.wmFair} nf=${grape.nfFair}`,
);
assert(
  (basketAmountForSide(grape, "walmart", 2.97) ?? 0) > 8,
  "basket uses 1 kg, not the tiny pack",
);
assert(
  Math.abs(
    (scaleBasketAmount(basketAmountForSide(grape, "walmart", 2.97), grape, {
      qtyKg: 2,
    }) ?? 0) -
      2 * (basketAmountForSide(grape, "walmart", 2.97) ?? 0),
  ) < 0.02,
  "qtyKg scales mass basket",
);

const butter = fairCompareSides(
  { ok: true, shelfPrice: 7.96, lineTotal: 7.96, packKg: 0.454 },
  { ok: true, shelfPrice: 8.29, lineTotal: 8.29, packKg: 0.454 },
);
assert(butter.fairBasis === "per_pack", `butter ${butter.fairBasis}`);
assert(butter.cheaper === "walmart", "butter WM");
assert(
  Math.abs(
    (scaleBasketAmount(basketAmountForSide(butter, "walmart", 7.96), butter, {
      packQty: 2,
    }) ?? 0) - 15.92,
  ) < 0.02,
  "pack qty doubles per-pack basket",
);

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

const incomparableBasket = basketAmountForSide(
  {
    cheaper: "incomplete",
    delta: null,
    fairBasis: "incomparable",
    fairLabel: "x",
    wmFair: 9.97,
    nfFair: 12.99,
  },
  "walmart",
  9.97,
);
assert(incomparableBasket == null, "incomparable must not enter the basket");

assert(
  stapleBrandHint({
    id: "orange_juice_pulp",
    mustIncludeAll: ["tropicana"],
    mustIncludeAny: ["no pulp", "pulp free"],
  }) === "tropicana",
  "OJ brand hint is tropicana, not 'no pulp'",
);

const tropicanaFit = scoreOfferMatch(
  offer({
    productId: "20119756001_EA",
    name: "Pure Premium Orange Juice (Pulp Free)",
    brand: "Tropicana",
    price: 8.99,
    packageSize: "1.36 l",
  }),
  "tropicana orange juice no pulp",
);
assert(
  tropicanaFit > 0 && tropicanaFit !== -Infinity,
  `Tropicana brand+title must score, got ${tropicanaFit}`,
);

const tropicanaVsCardLabel = scoreOfferMatch(
  offer({
    productId: "20119756001_EA",
    name: "Pure Premium Orange Juice (Pulp Free)",
    brand: "Tropicana",
    price: 8.99,
    packageSize: "1.36 l",
  }),
  "Tropicana OJ No Pulp 2.63L",
);
assert(
  tropicanaVsCardLabel > 0 && tropicanaVsCardLabel !== -Infinity,
  `card label 2.63L must not hard-reject Tropicana Pulp Free, got ${tropicanaVsCardLabel}`,
);

const cupsVsLabel = scoreOfferMatch(
  offer({
    productId: "maher-12oz-black-ripple",
    name: "12 OZ BLACK RIPPLE WALL CUP",
    brand: "Maher",
    price: 4.5,
  }),
  "12oz Black Ripple Cups",
);
assert(
  cupsVsLabel > 0 && cupsVsLabel !== -Infinity,
  `12oz card label must not hard-reject ripple cups, got ${cupsVsLabel}`,
);

const milkVsLabel = scoreOfferMatch(
  offer({
    productId: "milk-homo",
    name: "Homogenized Milk 3.25%",
    brand: "Mehadrin",
    price: 6.5,
    packageSize: "2 l",
  }),
  "Mehadrin Homo 3.25% Milk 2L",
);
assert(
  milkVsLabel > 0 && milkVsLabel !== -Infinity,
  `3.25% card label must not hard-reject homogenized milk, got ${milkVsLabel}`,
);

const tropicana263 = pickBestOffer(
  [
    offer({
      productId: "20119756001_EA",
      name: "Pure Premium Orange Juice (Pulp Free)",
      brand: "Tropicana",
      price: 8.99,
      packageSize: "1.36 l",
    }),
    offer({
      productId: "205804",
      name: "Tropicana 100% Pure Orange Juice No Pulp",
      brand: "Tropicana",
      price: 10.24,
    }),
  ],
  "tropicana orange juice no pulp",
  "205804",
  { mode: "preferred", targetMassKg: 2.63, preferNameIncludes: ["2.63"] },
);
assert(
  tropicana263?.productId === "205804",
  `exact OJ pins WM 2.63 SKU, got ${tropicana263?.productId}`,
);

const pulpFreeOk = sanityCheckOffer({
  itemId: "orange_juice_pulp",
  name: "Tropicana Pure Premium Orange Juice (Pulp Free)",
  price: 8.99,
  packageSize: "1.36 l",
  expectedPackKg: 2.63,
  minPlausiblePrice: 5,
  maxPlausiblePrice: 16,
});
assert(
  pulpFreeOk.ok && pulpFreeOk.status === "ok",
  `1.36L vs 2.63L must stay comparable (${pulpFreeOk.status} ${pulpFreeOk.reason})`,
);

const miniOj = sanityCheckOffer({
  itemId: "orange_juice_pulp",
  name: "Tropicana mini",
  price: 8.99,
  packageSize: "200 ml",
  expectedPackKg: 2.63,
  minPlausiblePrice: 5,
  maxPlausiblePrice: 16,
});
assert(miniOj.status === "wrong_size", `200ml vs 2.63L is mini, got ${miniOj.status}`);

const juiceFair = fairCompareSides(
  { ok: true, shelfPrice: 10.24, lineTotal: 10.24, packKg: 2.63 },
  { ok: true, shelfPrice: 8.99, lineTotal: 8.99, packKg: 1.36 },
);
assert(juiceFair.fairBasis === "per_100g", `OJ packs use $/100g, got ${juiceFair.fairBasis}`);
assert(juiceFair.cheaper === "walmart", `WM cheaper per litre, got ${juiceFair.cheaper}`);

const grapeThreeMissing = fairCompareThree(
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
  { ok: false },
);
assert(grapeThreeMissing.cheaper === grape.cheaper, "WC missing keeps WM vs NF");
assert(grapeThreeMissing.fairBasis === grape.fairBasis, "WC missing keeps basis");
assert(grapeThreeMissing.wcFair == null, "WC fair is null when unused");

const grapeFourMissing = fairCompareThree(
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
  { ok: false },
  { ok: false },
);
assert(grapeFourMissing.cheaper === grape.cheaper, "MVR missing keeps WM vs NF");
assert(grapeFourMissing.mvrFair == null, "MVR fair is null when unused");

const grapeMvrWins = fairCompareThree(
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
  { ok: false },
  {
    ok: true,
    shelfPrice: 1.99,
    lineTotal: 1.99,
    pricePerKg: 1.99 / 0.473,
    packKg: 0.473,
  },
);
assert(
  grapeMvrWins.cheaper === "mvr",
  `MVR cheapest per 100g, got ${grapeMvrWins.cheaper}`,
);

const grapeThreeWcWins = fairCompareThree(
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
  {
    ok: true,
    shelfPrice: 4.99,
    lineTotal: 4.99,
    pricePerKg: 4.99 / 0.907,
    packKg: 0.907,
  },
);
assert(
  grapeThreeWcWins.cheaper === "wholesaleclub",
  `WC cheapest per 100g, got ${grapeThreeWcWins.cheaper}`,
);

const organicBlue = offer({
  productId: "6000197209331",
  name: "Fresh Organic Blueberries, 6 oz",
  packageSize: "170 g",
  price: 5.44,
});
const cheapBlue = offer({
  productId: "6000204089919",
  name: "Blueberries, 312 g",
  packageSize: "312 g",
  price: 3.44,
});
assert(
  scoreOfferMatch(cheapBlue, "blueberries fresh") !== -Infinity,
  "conventional blueberries still match a 'fresh' produce query",
);
const bluePick = pickCheapestOffer(
  [organicBlue, cheapBlue],
  "blueberries fresh",
);
assert(
  bluePick?.productId === cheapBlue.productId,
  `cheapest WM blueberries is 312g not organic 6oz, got ${bluePick?.productId}`,
);

console.log("fair-compare-self-check ok", {
  grape: { cheaper: grape.cheaper, basis: grape.fairBasis, wm: grape.wmFair, nf: grape.nfFair },
  butter: { cheaper: butter.cheaper, basis: butter.fairBasis },
});

/**
 * Category B needed-weight pick scenarios.
 *   npx tsx src/poc/needed-weight-pick-self-check.ts
 */
import {
  isInNeededWeightRange,
  looseWeightPurchase,
  neededWeightBounds,
  pickNeededWeightPurchase,
  purchasePlanForPack,
} from "@/domain/needed-weight-pick";
import {
  mergeDistinctPackSizes,
  needsMorePackSizes,
} from "@/domain/pack-size-candidates";
import { resolveCatalogOffer } from "@/domain/compare-resolve";
import { shouldExpandPackSizes } from "@/lib/expand-pack-sizes";
import { buildStapleCompareRow } from "@/lib/staple-compare-row";
import {
  isActualCategoryBOffer,
  offerMassKg,
  samePackedItemCandidates,
} from "@/domain/same-packed-item";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const bounds500 = neededWeightBounds(500);
assert(Math.abs(bounds500.minGrams - 450) < 1e-6, "500g min 450");
assert(Math.abs(bounds500.maxGrams - 575) < 1e-6, "500g max 575");

const pack470 = {
  productId: "p470",
  name: "Frozen blueberries 470g",
  price: 4.2,
  packageSize: "470 g",
};
const pack550 = {
  productId: "p550",
  name: "Frozen blueberries 550g",
  price: 4.8,
  packageSize: "550 g",
};
const pack600 = {
  productId: "p600",
  name: "Frozen blueberries 600g",
  price: 5,
  packageSize: "600 g",
};
const pack2kg = {
  productId: "p2000",
  name: "Frozen blueberries 2kg",
  price: 12,
  packageSize: "2 kg",
};

const s470 = purchasePlanForPack(500, pack470);
assert(s470?.inRange === true, "470g of 500g in range");
assert(s470?.packs === 1, "470g one pack");
assert(Math.abs((s470?.deltaPct ?? 0) + 6) < 0.1, `470g delta ${s470?.deltaPct}`);
assert(s470?.totalPrice === 4.2, "470g total");

const s550 = purchasePlanForPack(500, pack550);
assert(s550?.inRange === true, "550g of 500g in range");
assert(Math.abs((s550?.deltaPct ?? 0) - 10) < 0.1, `550g delta ${s550?.deltaPct}`);

const s600 = purchasePlanForPack(500, pack600);
assert(s600?.inRange === false, "600g of 500g out of range");
assert(s600?.coverFallback === true, "600g is cover fallback");
assert(s600?.packs === 1 && s600.totalPrice === 5, "600g buy 1×$5");
assert(s600?.deltaGrams === 100, "600g excess 100g");
assert(s600?.deltaPct === 20, "600g +20%");

const s2kg = purchasePlanForPack(500, pack2kg);
assert(s2kg?.inRange === false, "2kg of 500g out of range");
assert(s2kg?.coverFallback === true, "2kg cover");
assert(s2kg?.totalPrice === 12, "2kg total $12");

const winner500 = pickNeededWeightPurchase(500, [
  pack470,
  pack550,
  pack600,
  pack2kg,
]);
assert(winner500?.productId === "p470", `500g winner ${winner500?.productId}`);
assert(winner500?.totalPrice === 4.2, "500g winner $4.20");
assert(winner500?.inRange === true, "500g winner in range");

const pack470x4 = { ...pack470, productId: "p470x4", price: 4 };
const twoSmall = purchasePlanForPack(900, pack470x4);
assert(twoSmall?.packs === 2, `900g from 470g packs ${twoSmall?.packs}`);
assert(twoSmall?.gotGrams === 940, `900g got ${twoSmall?.gotGrams}`);
assert(twoSmall?.totalPrice === 8, `900g total ${twoSmall?.totalPrice}`);
assert(twoSmall?.inRange === true, "940g of 900g in range");
assert(
  Math.abs((twoSmall?.deltaPct ?? 0) - 4.4) < 0.15,
  `900g delta ${twoSmall?.deltaPct}`,
);

const loose = looseWeightPurchase({
  neededGrams: 500,
  pricePerKg: 4,
  productId: "eggplant",
  name: "Eggplant",
  shelfPrice: 4,
});
assert(loose?.soldByWeight === true, "loose is sold by weight");
assert(loose?.packs === 0, "loose has no packs");
assert(loose?.totalPrice === 2, `loose 500g of $4/kg = $2, got ${loose?.totalPrice}`);
assert(loose?.gotGrams === 500, "loose got needed grams");

assert(isInNeededWeightRange(470, 500), "470 in");
assert(isInNeededWeightRange(550, 500), "550 in");
assert(!isInNeededWeightRange(600, 500), "600 out");
assert(!isInNeededWeightRange(2000, 500), "2000 out");

const nf283 = {
  productId: "21367888001_EA",
  name: "Farmer's Market Grape Tomatoes",
  price: 2.99,
  packageSize: "283 g",
  parsedMassKg: 0.283,
};
const nf907 = {
  productId: "20840038001_EA",
  name: "Farmer's Market Grape Tomato",
  price: 7.99,
  packageSize: "907 g",
  parsedMassKg: 0.907,
};
const grapePick = pickNeededWeightPurchase(500, [nf907, nf283]);
assert(grapePick?.productId === nf283.productId, `grape winner ${grapePick?.productId}`);
assert(grapePick?.packs === 2, `grape packs ${grapePick?.packs}`);
assert(grapePick?.inRange === true, "2×283g in 500g window");
assert(grapePick?.totalPrice === 5.98, `grape total ${grapePick?.totalPrice}`);
assert(needsMorePackSizes(500, [nf907]) === true, "907g alone needs more sizes");
assert(needsMorePackSizes(500, [nf907, nf283]) === false, "283g present — no expand");

const merged = mergeDistinctPackSizes([
  nf907,
  nf283,
  { ...nf283, productId: "dup283", price: 3.49 },
]);
assert(merged.length === 2, `merged sizes ${merged.length}`);
assert(
  merged.find((o) => packSizeNear(o, 283))?.price === 2.99,
  "keep cheaper 283g",
);

function packSizeNear(
  offer: { packageSize?: string; parsedMassKg?: number },
  grams: number,
): boolean {
  const kg = offer.parsedMassKg ?? 0;
  return Math.abs(kg * 1000 - grams) < 6;
}

const grapeItem = {
  id: "tomatoes_grape",
  category: "produce",
  matchMode: "cheapest" as const,
  mustIncludeAny: ["grape tomato", "grape tomatoes"],
  mustNotInclude: ["seed", "seeds"],
};
const grapeRow = { offer: nf907, alternates: [nf283] };
const grapeResolved = resolveCatalogOffer({
  item: grapeItem,
  row: grapeRow,
  matchMode: "cheapest",
  neededGrams: 500,
});
assert(
  grapeResolved.offer?.productId === nf283.productId,
  `resolve grape ${grapeResolved.offer?.productId}`,
);
assert(
  shouldExpandPackSizes({
    item: { ...grapeItem, queries: ["grape tomatoes"], label: "Grape Tomatoes" },
    neededGrams: 500,
    row: { offer: nf907, alternates: [] },
  }) === true,
  "NF 907g-only should expand",
);
assert(
  shouldExpandPackSizes({
    item: { ...grapeItem, queries: ["grape tomatoes"], label: "Grape Tomatoes" },
    neededGrams: 500,
    row: grapeRow,
  }) === false,
  "NF with 283g alternate should not expand",
);

const lemonItem = {
  id: "lemons_2lb",
  category: "produce",
  matchMode: "cheapest" as const,
  mustIncludeAny: ["lemon"],
  // Product-specific only. Shared DEFAULT_PRODUCE_JUNK must drop pops/tea/extract.
  mustNotInclude: ["juice", "concentrate", "cleaner", "dish"],
  typicalEachGrams: 120,
  queries: ["fresh lemons"],
  label: "Lemons (bag ~2lb)",
};
const lemonBag = {
  productId: "20795315001_EA",
  name: "Farmer's Market Lemons, 2 lb Bag",
  brand: "Farmer's Market",
  packageSize: "907 g",
  parsedMassKg: 0.907,
  price: 4.99,
  sourceUrl: "https://www.nofrills.ca/en/lemons-2-lb-bag/p/20795315001_EA",
};
const lemonEach = {
  productId: "20028593001_EA",
  name: "Lemon",
  packageSize: "1 ea, $0.99/1ea",
  price: 0.99,
  sourceUrl: "https://www.nofrills.ca/en/lemon/p/20028593001_EA",
};
const lemonPops = {
  productId: "21469809_EA",
  name: "PC Organics Blood Orange and Lemon Fruit Pops, Organic",
  brand: "PC Organics",
  packageSize: "70 g",
  parsedMassKg: 0.07,
  price: 6,
  sourceUrl:
    "https://www.nofrills.ca/en/blood-orange-and-lemon-fruit-pops-organic/p/21469809_EA",
};
assert(isActualCategoryBOffer(lemonItem, lemonBag) === true, "lemon bag is fruit");
assert(isActualCategoryBOffer(lemonItem, lemonEach) === true, "single lemon is fruit");
assert(isActualCategoryBOffer(lemonItem, lemonPops) === false, "pops are not lemons");
assert(Math.abs((offerMassKg(lemonItem, lemonEach) ?? 0) - 0.12) < 1e-6, "each lemon 120g");

const lemonSiblings = samePackedItemCandidates(
  lemonItem,
  [lemonBag, lemonEach, lemonPops],
  lemonBag,
);
assert(
  lemonSiblings.every((o) => o.productId !== lemonPops.productId),
  "pops dropped from lemon candidates",
);
const lemonPick = pickNeededWeightPurchase(500, lemonSiblings);
assert(lemonPick?.productId === lemonEach.productId, `lemon pick ${lemonPick?.productId}`);
assert(lemonPick?.packs === 4, `4 singles ${lemonPick?.packs}`);
assert(lemonPick?.inRange === true, "4×120g in 500g window");
assert(lemonPick?.totalPrice === 3.96, `lemon each total ${lemonPick?.totalPrice}`);
assert(lemonPick?.packGrams === 120, `each pack grams ${lemonPick?.packGrams}`);

const lemonResolved = resolveCatalogOffer({
  item: lemonItem,
  row: { offer: lemonBag, alternates: [lemonEach, lemonPops] },
  matchMode: "cheapest",
  neededGrams: 500,
});
assert(
  lemonResolved.offer?.productId === lemonEach.productId,
  `resolve lemon ${lemonResolved.offer?.productId}`,
);

const lemonRow = buildStapleCompareRow({
  item: lemonItem,
  wmOffer: {
    productId: "wm-bag",
    name: "Lemons, Your Fresh Market, 2 lb",
    packageSize: "907 g",
    parsedMassKg: 0.907,
    price: 4.97,
  },
  nfOffer: {
    productId: lemonEach.productId,
    name: lemonEach.name,
    packageSize: lemonEach.packageSize,
    price: lemonEach.price,
  },
  wmEval: { status: "ok", ageLabel: null },
  nfEval: { status: "ok", ageLabel: null },
  wmUsable: true,
  nfUsable: true,
  grams: 500,
  confirmed: false,
});
assert(lemonRow.cheaper === "nofrills", `lemon cheaper ${lemonRow.cheaper}`);
assert(lemonRow.basketNoFrills === 3.96, `NF 4×120g ${lemonRow.basketNoFrills}`);
assert(lemonRow.basketWalmart === 4.97, `WM bag ${lemonRow.basketWalmart}`);
const nfPurchase = lemonRow.noFrills.purchase as { packs?: number; packGrams?: number } | undefined;
assert(nfPurchase?.packs === 4 && nfPurchase.packGrams === 120, "compare uses 120 g each");

const lemonImperfect = {
  productId: "21124487001_EA",
  name: "No Name Naturally Imperfect Lemons 3lb Bag",
  brand: "No Name",
  packageSize: "1.36 kg",
  parsedMassKg: 1.36,
  price: 6,
  sourceUrl:
    "https://www.nofrills.ca/en/naturally-imperfect-lemons-3lb-bag/p/21124487001_EA",
};
const lemonWmEach = {
  productId: "6000191268545",
  name: "Lemon, Sold in singles",
  price: 0.87,
  sourceUrl: "https://www.walmart.ca/en/ip/lemon/6000191268551",
};
const lemonFaux = {
  productId: "4QE20M13U072",
  name: "CUITING Garden Fresh™ Faux Large Lemons by ®",
  brand: "CUITING",
  price: 27.34,
  sourceUrl:
    "https://www.walmart.ca/en/ip/CUITING-Garden-Fresh-Faux-Large-Lemons-by/6E92AXVZFFFK",
};
const lemonBook = {
  productId: "4FX06LLA3HZR",
  name: "Facsimile Publisher Prices and spreads for apples, grapefruit, grapes, lemons, and oranges sold fresh in selected markets, 1962/63-1966/67 Volume no.888 1970 [Leather Bound]",
  brand: "Facsimile Publisher",
  price: 80.99,
  sourceUrl:
    "https://www.walmart.ca/en/ip/Prices-spreads-apples-grapefruit-grapes-lemons-oranges-sold-fresh-selected-markets/4FX06LLA3HZR",
};
const lemonTea = {
  productId: "21522182_EA",
  name: "Snapple Lemon Tea",
  brand: "Snapple",
  packageSize: "945 ml",
  parsedMassKg: 0.945,
  price: 1.75,
  sourceUrl: "https://www.nofrills.ca/en/lemon-tea/p/21522182_EA",
};
const lemonExtract = {
  productId: "20669647001_EA",
  name: "Gefen Pure Lemon Extract, 2Oz",
  brand: "Gefen",
  packageSize: "59 ml",
  parsedMassKg: 0.059,
  price: 8.99,
  sourceUrl: "https://www.nofrills.ca/en/pure-lemon-extract-2oz/p/20669647001_EA",
};
const lemonSticks = {
  productId: "21709999_EA",
  name: "Klein's Delights Lemon Sticks (12-pk)",
  brand: "Klein's Delights",
  packageSize: "586 ml",
  parsedMassKg: 0.586,
  price: 11,
  sourceUrl: "https://www.nofrills.ca/en/lemon-sticks-12-pk/p/21709999_EA",
};
assert(isActualCategoryBOffer(lemonItem, lemonImperfect) === true, "imperfect 3lb is fruit");
assert(isActualCategoryBOffer(lemonItem, lemonWmEach) === true, "WM singles are fruit");
assert(isActualCategoryBOffer(lemonItem, lemonFaux) === false, "faux lemons rejected");
assert(isActualCategoryBOffer(lemonItem, lemonBook) === false, "lemon book rejected");
assert(isActualCategoryBOffer(lemonItem, lemonTea) === false, "lemon tea rejected by shared junk");
assert(isActualCategoryBOffer(lemonItem, lemonExtract) === false, "extract rejected by shared junk");
assert(isActualCategoryBOffer(lemonItem, lemonSticks) === false, "sticks rejected by shared junk");
assert(
  Math.abs((offerMassKg(lemonItem, lemonWmEach) ?? 0) - 0.12) < 1e-6,
  "WM singles 120g",
);

const eachNoMass = purchasePlanForPack(500, {
  productId: lemonEach.productId,
  name: lemonEach.name,
  price: lemonEach.price,
  packageSize: lemonEach.packageSize,
  typicalEachGrams: 120,
});
assert(eachNoMass?.packs === 4, `1 ea plan without parsed mass ${eachNoMass?.packs}`);
assert(eachNoMass?.packGrams === 120, "1 ea uses 120 g");
assert(eachNoMass?.totalPrice === 3.96, `1 ea 500g spend ${eachNoMass?.totalPrice}`);
assert(
  purchasePlanForPack(500, {
    productId: lemonEach.productId,
    name: lemonEach.name,
    price: lemonEach.price,
    packageSize: lemonEach.packageSize,
  }) == null,
  "1 ea without typical weight cannot compare",
);
const staleEach = purchasePlanForPack(500, {
  productId: lemonWmEach.productId,
  name: lemonWmEach.name,
  price: 0.87,
  packageSize: undefined,
  parsedMassKg: 0.11,
  typicalEachGrams: 120,
});
assert(staleEach?.packGrams === 120, `stale 110g catalog still 120g ${staleEach?.packGrams}`);
assert(staleEach?.packs === 4, `stale each packs ${staleEach?.packs}`);

const dirtyLemon = samePackedItemCandidates(
  lemonItem,
  [
    lemonBag,
    lemonEach,
    lemonImperfect,
    lemonPops,
    lemonTea,
    lemonExtract,
    lemonSticks,
    lemonFaux,
    lemonBook,
  ],
  lemonBag,
);
assert(
  dirtyLemon.map((o) => o.productId).sort().join(",") ===
    [lemonBag.productId, lemonEach.productId, lemonImperfect.productId].sort().join(","),
  `dirty lemon pool ${dirtyLemon.map((o) => o.productId).join(",")}`,
);

const berryItem = {
  id: "strawberries",
  category: "produce",
  matchMode: "cheapest" as const,
  mustIncludeAny: ["strawberry", "strawberries"],
  mustNotInclude: ["jam", "syrup"],
};
assert(
  isActualCategoryBOffer(berryItem, {
    productId: "straw-pack",
    name: "Driscoll Strawberries",
    brand: "Driscoll's",
    packageSize: "454 g",
    parsedMassKg: 0.454,
    price: 4,
  }) === true,
  "branded strawberry clamshell is fruit",
);
assert(
  isActualCategoryBOffer(berryItem, {
    productId: "straw-ice",
    name: "Strawberry Ice Cream",
    packageSize: "1.5 L",
    parsedMassKg: 1.5,
    price: 5,
  }) === false,
  "strawberry ice cream rejected by shared junk",
);

const frozenBerry = {
  id: "frozen_blueberry",
  category: "frozen",
  matchMode: "cheapest" as const,
  mustIncludeAny: ["blueberry", "blueberries"],
  mustNotInclude: ["muffin", "jam", "juice"],
};
assert(
  isActualCategoryBOffer(frozenBerry, {
    productId: "gv-frozen",
    name: "Great Value Frozen Blueberries",
    brand: "Great Value",
    packageSize: "600 g",
    parsedMassKg: 0.6,
    price: 5,
  }) === true,
  "frozen bag may say frozen",
);
assert(
  isActualCategoryBOffer(frozenBerry, {
    productId: "bb-pops",
    name: "Blueberry Fruit Pops",
    packageSize: "70 g",
    parsedMassKg: 0.07,
    price: 6,
  }) === false,
  "frozen staple still rejects pops",
);

const cucumberItem = {
  id: "cucumber_english",
  category: "produce",
  matchMode: "cheapest" as const,
  mustIncludeAny: ["cucumber"],
  mustNotInclude: ["pickle", "relish"],
  rejectNameIncludes: ["melon"],
  typicalEachGrams: 350,
};
const cucumberEach = {
  productId: "cuke-1",
  name: "English Cucumber",
  packageSize: "1 ea",
  price: 1.49,
};
assert(isActualCategoryBOffer(cucumberItem, cucumberEach) === true, "single cucumber is veg");
assert(Math.abs((offerMassKg(cucumberItem, cucumberEach) ?? 0) - 0.35) < 1e-6, "cucumber 350g");
assert(
  isActualCategoryBOffer(cucumberItem, {
    productId: "cuke-melon",
    name: "Cucumber Melon",
    packageSize: "250 g",
    parsedMassKg: 0.25,
    price: 4,
  }) === false,
  "per-staple rejectNameIncludes drops extra words",
);
assert(
  isActualCategoryBOffer(grapeItem, nf283) === true,
  "grape 283g still the actual pack",
);

const grapeLock = {
  retailerProductId: "6000194960084",
  verified: true,
  skippedRematch: true,
};
const grapeOos10 = {
  productId: "6000194960083",
  name: "Your Fresh Market Tomato, Grape, 10 oz",
  packageSize: "283 g",
  parsedMassKg: 0.283,
  price: 2.97,
  availability: "out_of_stock",
  sourceUrl:
    "https://www.walmart.ca/en/ip/your-fresh-market-tomato-grape/6000194960084",
};
const grapeAlt15 = {
  productId: "6000196006539",
  name: "Your Fresh Market Grape Tomatoes, 1.5lb",
  packageSize: "1.5lb",
  parsedMassKg: 0.68,
  price: 5.94,
};
const grapeLockedInStock = resolveCatalogOffer({
  item: grapeItem,
  row: { offer: { ...grapeOos10, availability: undefined }, alternates: [grapeAlt15] },
  link: grapeLock,
  matchMode: "cheapest",
  neededGrams: 500,
});
assert(
  grapeLockedInStock.offer?.productId === grapeOos10.productId,
  `in-stock lock still wins ${grapeLockedInStock.offer?.productId}`,
);
const grapeLockedOos = resolveCatalogOffer({
  item: grapeItem,
  row: { offer: grapeOos10, alternates: [grapeAlt15] },
  link: grapeLock,
  matchMode: "cheapest",
  neededGrams: 500,
});
assert(
  grapeLockedOos.offer?.productId === grapeAlt15.productId,
  `OOS lock falls back to nearest pack ${grapeLockedOos.offer?.productId}`,
);
assert(
  shouldExpandPackSizes({
    item: {
      ...grapeItem,
      queries: ["grape tomatoes"],
      label: "Grape Tomatoes",
    },
    neededGrams: 500,
    link: grapeLock,
    row: { offer: grapeOos10, alternates: [] },
  }) === true,
  "OOS locked 10oz should search for an alternate pack",
);
assert(
  shouldExpandPackSizes({
    item: {
      ...grapeItem,
      queries: ["grape tomatoes"],
      label: "Grape Tomatoes",
    },
    neededGrams: 500,
    link: grapeLock,
    row: {
      offer: { ...grapeOos10, availability: undefined },
      alternates: [],
    },
  }) === false,
  "in-stock locked grape SKU should not rematch",
);

const organicBlue = {
  productId: "6000197209331",
  name: "Fresh Organic Blueberries, 6 oz",
  packageSize: "170 g",
  parsedMassKg: 0.17,
  price: 5.44,
};
const pack312 = {
  productId: "6000204089919",
  name: "Blueberries, 312 g",
  packageSize: "312 g",
  parsedMassKg: 0.312,
  price: 3.44,
};
const gvFrozenBag = {
  productId: "6000197072458",
  name: "Great Value Cultivated Blueberries, 600 g",
  brand: "Great Value",
  packageSize: "600 g",
  parsedMassKg: 0.6,
  price: 4.66,
};
const blueWeight = pickNeededWeightPurchase(500, [organicBlue, pack312]);
assert(
  blueWeight?.productId === pack312.productId,
  `500g blueberries buy 312g packs not 3×organic, got ${blueWeight?.productId}`,
);
assert(blueWeight?.packs === 2, `312g packs ${blueWeight?.packs}`);
assert(blueWeight?.totalPrice === 6.88, `312g total ${blueWeight?.totalPrice}`);

const blueberryItem = {
  id: "blueberries",
  category: "produce" as const,
  matchMode: "cheapest" as const,
  mustIncludeAny: ["blueberry", "blueberries"],
  mustNotInclude: ["muffin", "jam", "juice", "dried", "frozen", "cultivated"],
};
assert(
  isActualCategoryBOffer(blueberryItem, pack312) === true,
  "312g clamshell is fresh blueberries",
);
assert(
  isActualCategoryBOffer(blueberryItem, organicBlue) === true,
  "organic 6oz is still fruit",
);
assert(
  isActualCategoryBOffer(blueberryItem, gvFrozenBag) === false,
  "cultivated 600g bag is the frozen SKU, not fresh produce",
);
const blueResolved = resolveCatalogOffer({
  item: blueberryItem,
  row: {
    offer: organicBlue,
    alternates: [pack312, gvFrozenBag],
  },
  matchMode: "cheapest",
  neededGrams: 500,
});
assert(
  blueResolved.offer?.productId === pack312.productId,
  `resolve blueberries ${blueResolved.offer?.productId}`,
);
const blueResolvedNoGrams = resolveCatalogOffer({
  item: blueberryItem,
  row: {
    offer: organicBlue,
    alternates: [pack312, gvFrozenBag],
  },
  matchMode: "cheapest",
});
assert(
  blueResolvedNoGrams.offer?.productId === pack312.productId,
  `cheapest catalog blueberries ${blueResolvedNoGrams.offer?.productId}`,
);

console.log("needed-weight-pick-self-check ok", {
  winner500: winner500?.productId,
  twoSmall: { packs: twoSmall?.packs, total: twoSmall?.totalPrice },
  loose: loose?.totalPrice,
  grape: { id: grapePick?.productId, packs: grapePick?.packs },
});

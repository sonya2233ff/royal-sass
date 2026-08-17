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

console.log("needed-weight-pick-self-check ok", {
  winner500: winner500?.productId,
  twoSmall: { packs: twoSmall?.packs, total: twoSmall?.totalPrice },
  loose: loose?.totalPrice,
  grape: { id: grapePick?.productId, packs: grapePick?.packs },
});

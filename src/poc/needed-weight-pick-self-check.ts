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

console.log("needed-weight-pick-self-check ok", {
  winner500: winner500?.productId,
  twoSmall: { packs: twoSmall?.packs, total: twoSmall?.totalPrice },
  loose: loose?.totalPrice,
});

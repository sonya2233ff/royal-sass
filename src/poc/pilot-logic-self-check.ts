/**
 * Pilot logic: checkout, identity, cart, coverage.
 *   npm run poc:pilot-logic
 */
import {
  checkoutFixedPacks,
  checkoutLoose,
  evaluatePurchase,
  fairCompareCheckouts,
  inExactNeedRange,
} from "@/domain/checkout";
import { inferSaleMode } from "@/domain/sale-mode";
import { convertAmount, roundMoney } from "@/domain/purchase-units";
import {
  offerMatchesIdentity,
  type IdentityOffer,
} from "@/domain/product-identity";
import {
  addCartItem,
  applyProductOverride,
  canonicalizeMatchMode,
  cartSize,
  clearCart,
  filterVisibleIds,
  inferPurchaseStrategy,
  removeCartItem,
  setCartCustomAmount,
  toRestaurantProduct,
  type Cart,
  type RestaurantProduct,
} from "@/domain/restaurant-product";
import { storeCoverage } from "@/domain/basket-coverage";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function product(
  partial: Partial<RestaurantProduct> & Pick<RestaurantProduct, "id" | "label">,
): RestaurantProduct {
  return {
    matchMode: "cheapest_equivalent",
    purchaseStrategy: "exact_need",
    defaultAmount: 1,
    unit: "g",
    tolerancePercent: 15,
    ...partial,
  };
}

function offer(
  name: string,
  extra: Partial<{
    price: number;
    packageSize: string;
    parsedMassKg: number;
    pricePerKg: number;
    productId: string;
    brand: string;
    upc: string;
  }> = {},
): IdentityOffer & {
  price: number;
  name: string;
  packageSize?: string;
  parsedMassKg?: number;
  pricePerKg?: number;
} {
  return {
    name,
    price: extra.price ?? 3,
    packageSize: extra.packageSize,
    parsedMassKg: extra.parsedMassKg,
    pricePerKg: extra.pricePerKg,
    productId: extra.productId,
    brand: extra.brand,
    upc: extra.upc,
  };
}

// --- migration ---
assert(canonicalizeMatchMode("preferred") === "exact", "preferred → exact");
assert(
  canonicalizeMatchMode("cheapest") === "cheapest_equivalent",
  "cheapest → cheapest_equivalent",
);
assert(
  inferPurchaseStrategy({ id: "x", label: "X" }) === "exact_need",
  "missing strategy → exact_need",
);
const migrated = toRestaurantProduct({
  id: "x",
  label: "X",
  matchMode: "preferred",
});
assert(migrated.matchMode === "exact", "toRestaurantProduct preferred");
assert(migrated.purchaseStrategy === "exact_need", "default exact_need");
assert(migrated.tolerancePercent === 15, "default 15%");
assert(migrated.maximumAmount == null, "do not invent maximumAmount");

// --- calculation ---
const loose = checkoutLoose(0.5, "kg", 4);
assert(loose.checkoutCost === 2, `loose 500g $4/kg → $2, got ${loose.checkoutCost}`);

const tomato = product({
  id: "tomato",
  label: "Tomato",
  unit: "g",
  defaultAmount: 500,
  purchaseStrategy: "exact_need",
  matchRules: { productType: "tomato", form: "fresh" },
});

const looseEval = evaluatePurchase({
  product: tomato,
  requested: 500,
  offer: {
    price: 4,
    name: "Tomato per kg",
    pricePerKg: 4,
    stapleSoldByWeight: true,
  },
});
assert(looseEval.valid, "loose tomato valid");
assert(looseEval.checkoutCost === 2, `loose eval $2 got ${looseEval.checkoutCost}`);
assert(looseEval.purchasedAmount === 500, "loose purchased = requested");

const p470 = checkoutFixedPacks({
  requested: 500,
  unit: "g",
  packAmount: 470,
  packPrice: 3,
  saleMode: "fixed_pack",
});
assert(p470.packs === 2, "raw ceil of 500/470 is 2; exact_need may pick 1");
assert(inExactNeedRange(470, 500, 15), "470g valid at 15%");

const eval470 = evaluatePurchase({
  product: tomato,
  requested: 500,
  offer: { price: 3, name: "Tomato 470 g pack" },
});
assert(eval470.valid, "470g pack valid");
assert(eval470.checkoutCost === 3, "470g checkout $3");
assert(eval470.packs === 1, "470g 1 pack");

const eval550 = evaluatePurchase({
  product: tomato,
  requested: 500,
  offer: { price: 3.5, name: "Tomato 550 g pack" },
});
assert(eval550.valid, "550g pack valid at 15%");
assert(eval550.checkoutCost === 3.5, "550g $3.50");

const eval2kg = evaluatePurchase({
  product: tomato,
  requested: 500,
  offer: { price: 8, name: "Tomato 2 kg pack" },
});
assert(!eval2kg.valid, "2kg pack invalid for 500g exact_need");
assert(eval2kg.checkoutCost == null, "invalid has no fake price");

const ceil12 = checkoutFixedPacks({
  requested: 1.2,
  unit: "kg",
  packAmount: 0.5,
  packPrice: 2,
  saleMode: "fixed_pack",
});
assert(ceil12.packs === 3, "1.2kg / 500g → 3 packs");
assert(ceil12.purchasedAmount === 1.5, "purchased 1.5kg");
assert(ceil12.checkoutCost === 6, "checkout $6");

assert(
  inferSaleMode({ name: "Tomato 15 lb case", packageSize: "15 lb case" }) ===
    "case",
  "15 lb case is case, not loose",
);
const case15 = evaluatePurchase({
  product: tomato,
  requested: 500,
  offer: { price: 17.99, name: "MVR Tomato 15 lb case" },
});
const casePackG = convertAmount(15, "kg", "g"); // not this — 15 lb
assert(case15.saleMode === "case", `15lb saleMode ${case15.saleMode}`);
assert(
  case15.checkoutCost == null || case15.checkoutCost === 17.99,
  "case not proportional split",
);
assert(!case15.valid, "15 lb case not in 500g ±15%");
const packG = convertAmount(15 * 0.45359237, "kg", "g")!;
const caseMath = checkoutFixedPacks({
  requested: 500,
  unit: "g",
  packAmount: packG,
  packPrice: 17.99,
  saleMode: "case",
});
assert(caseMath.packs === 1, "one case");
assert(caseMath.checkoutCost === 17.99, "full case $17.99");
assert(caseMath.checkoutCost !== roundMoney(17.99 * (500 / packG)), "not a slice");

const oj = product({
  id: "orange_juice",
  label: "Orange Juice",
  unit: "l",
  defaultAmount: 1,
  maximumAmount: 2,
  purchaseStrategy: "stock_up",
  matchMode: "cheapest_equivalent",
});
const storeA = evaluatePurchase({
  product: oj,
  requested: 1,
  offer: { price: 5, name: "Orange Juice 1 L bottle" },
});
const wholesale = evaluatePurchase({
  product: oj,
  requested: 1,
  offer: { price: 9, name: "Orange Juice 2 L bottle" },
});
assert(storeA.valid && wholesale.valid, "stock_up both valid");
assert(wholesale.purchasedAmount === 2, `WC bought ${wholesale.purchasedAmount}L`);
const fair = fairCompareCheckouts(
  [
    {
      storeId: "walmart",
      valid: storeA.valid,
      checkoutCost: storeA.checkoutCost,
      purchasedAmount: storeA.purchasedAmount,
      option: storeA,
    },
    {
      storeId: "wholesaleclub",
      valid: wholesale.valid,
      checkoutCost: wholesale.checkoutCost,
      purchasedAmount: wholesale.purchasedAmount,
      option: wholesale,
    },
  ],
  oj,
  1,
);
assert(fair.cheaper === "wholesaleclub", `OJ winner ${fair.cheaper}`);
assert(
  fair.delta != null && Math.abs(Math.abs(fair.delta) - 1) < 0.02,
  `fair saving $1 for 2L, got ${fair.delta}`,
);

const missing = storeCoverage([2, null]);
assert(missing.checkoutTotal == null, "missing product → N/A not $0");
assert(!missing.complete, "incomplete basket");
assert(missing.availableComparableItems === 1, "1 of 2");
const full = storeCoverage([2, 3]);
assert(full.checkoutTotal === 5, "complete sums line totals");

const quinoa = product({
  id: "white_quinoa_grains_750gr",
  label: "White Quinoa Grains 750gr",
  unit: "g",
  defaultAmount: 750,
  matchRules: {
    productType: "quinoa",
    variant: "white",
    mustIncludeAny: ["quinoa"],
    mustNotInclude: ["red", "black"],
  },
});
const q5kg = evaluatePurchase({
  product: quinoa,
  requested: 750,
  offer: { price: 20, name: "White Quinoa 5 kg pack" },
});
assert(!q5kg.valid, "5 kg quinoa cannot win 750g exact_need");

assert(convertAmount(1, "kg", "ml") == null, "never convert mass to volume");
assert(convertAmount(1, "l", "g") == null, "never convert volume to mass");
assert(convertAmount(2, "kg", "g") === 2000, "kg to g");
assert(convertAmount(500, "ml", "l") === 0.5, "ml to L");

// --- matcher ---
const freshTomato = product({
  id: "tomato",
  label: "Tomato",
  matchMode: "cheapest_equivalent",
  category: "produce",
  matchRules: {
    productType: "tomato",
    form: "fresh",
    mustIncludeAny: ["tomato", "tomatoes"],
    mustNotInclude: ["canned", "can", "sauce", "paste", "juice"],
  },
});
assert(
  !offerMatchesIdentity({
    product: freshTomato,
    offer: offer("Canned tomatoes 796 ml"),
  }).ok,
  "fresh tomato != canned",
);
assert(
  !offerMatchesIdentity({
    product: freshTomato,
    offer: offer("Tomato sauce 680 ml"),
  }).ok,
  "fresh tomato != sauce",
);
assert(
  !offerMatchesIdentity({
    product: quinoa,
    offer: offer("Red quinoa 750 g"),
  }).ok,
  "white quinoa != red quinoa",
);

const vodka = product({
  id: "vodka",
  label: "Smirnoff Vodka 1.75L",
  matchMode: "exact",
  unit: "l",
  matchRules: { productType: "vodka" },
});
assert(
  !offerMatchesIdentity({
    product: vodka,
    offer: offer("Smirnoff Vodka 946 ml", { packageSize: "946 ml" }),
  }).ok,
  "exact 1.75L != 946ml",
);

const cover = product({
  id: "table_cover",
  label: "Rectangular Table Cover",
  matchMode: "cheapest_equivalent",
  matchRules: {
    productType: "table cover",
    variant: "rectangular",
    mustIncludeAny: ["table cover", "tablecloth"],
  },
});
assert(
  !offerMatchesIdentity({
    product: cover,
    offer: offer("Round table cover 84 inch"),
  }).ok,
  "rectangular != round table cover",
);

const eggWhites = product({
  id: "simply_egg_whites",
  label: "Naturegg Simply Egg Whites 1kg",
  matchMode: "exact",
  preferredProductId: "6000196635381",
  matchRules: { mustNotInclude: ["free run"] },
});
assert(
  offerMatchesIdentity({
    product: eggWhites,
    offer: offer("Great Value egg whites", { productId: "6000196635381" }),
    confirmedProductId: "6000196635381",
  }).ok,
  "confirmed product ID has priority",
);
assert(
  !offerMatchesIdentity({
    product: eggWhites,
    offer: offer("Great Value Egg Whites 1 kg", { productId: "other" }),
  }).ok,
  "exact does not accept other brand analog",
);

// --- cart ---
let cart: Cart = {};
const tomatoP = toRestaurantProduct({
  id: "tomato",
  label: "Tomato",
  matchMode: "cheapest_equivalent",
  defaultAmount: 2,
  unit: "kg",
});
cart = addCartItem(cart, "tomato", tomatoP);
assert(cart.tomato?.requestedAmount === 2, "default amount added automatically");
assert(!cart.tomato?.isCustom, "default is not custom");
const defaultSnap = tomatoP.defaultAmount;
cart = setCartCustomAmount(cart, "tomato", 5, "kg");
assert(cart.tomato?.requestedAmount === 5, "custom 5 kg");
assert(cart.tomato?.isCustom, "custom flag");
assert(tomatoP.defaultAmount === defaultSnap, "custom does not change product default");
assert(
  applyProductOverride(tomatoP, {}).defaultAmount === 2,
  "override absent keeps default 2",
);

cart = addCartItem(cart, "quinoa", quinoa);
assert(cartSize(cart) === 2, "two items");
cart = removeCartItem(cart, "quinoa");
assert(cart.quinoa == null, "remove deletes item");
assert(cartSize(cart) === 1, "one left");

cart = addCartItem(cart, "hidden", eggWhites);
const items = [
  { id: "tomato", label: "Tomato" },
  { id: "hidden", label: "Naturegg Simply Egg Whites 1kg" },
];
const visible = filterVisibleIds(items, "tom");
assert(visible.length === 1 && visible[0] === "tomato", "filter hides egg whites");
assert(cartSize(cart) === 2, "search filter does not change cart");
assert(cart.hidden, "hidden-by-search item still in cart");
cart = clearCart();
assert(cartSize(cart) === 0, "clear cart removes hidden items too");
assert(cart.tomato == null && cart.hidden == null, "clear empties all");

cart = addCartItem({}, "a", tomatoP);
cart = addCartItem(cart, "b", quinoa);
assert(cartSize(cart) === 2, "compare count matches cart size");

console.log("poc:pilot-logic ok");

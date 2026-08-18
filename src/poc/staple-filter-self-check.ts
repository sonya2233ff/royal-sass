/**
 * Category B (cheapest produce/frozen) filters use title + pack + retailer
 * taxonomy. Category A stays contiguous title match.
 *   npx tsx src/poc/staple-filter-self-check.ts
 */
import {
  categoryBSearchQueries,
  offerFailsStapleFilters,
  offerFailsStapleOfferFilters,
} from "@/domain/catalog-normalize";
import { isActualCategoryBOffer } from "@/domain/same-packed-item";
import {
  eggCartonCountOk,
  loadStaplesConfig,
  resolveMatchMode,
} from "@/lib/staples";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const alaskoRaw = {
  type: "FROZEN FRUITS",
  tags: [
    "CATEGORY_FROZEN FRUITS",
    "DEPARTMENT_FROZEN",
    "INSTOREPRICE:19.99",
    "MARKUP:1.1",
    "SUBDEPARTMENT_FROZEN FRUITS & VEGETABLES",
  ],
};

const grapeRaw = {
  type: "VEGETABLES",
  tags: ["CATEGORY_VEGETABLES", "DEPARTMENT_PRODUCE"],
};

async function main() {
  const cfg = await loadStaplesConfig();
  const frozen = cfg.items.find((i) => i.id === "frozen_strawberry");
  const fresh = cfg.items.find((i) => i.id === "strawberries");
  const grape = cfg.items.find((i) => i.id === "tomatoes_grape");
  const banana = cfg.items.find((i) => i.id === "bananas_kg");
  const apple = cfg.items.find((i) => i.id === "frozen_apple");
  const egg = cfg.items.find((i) => i.id === "simply_egg_whites");
  const blueberries = cfg.items.find((i) => i.id === "blueberries");
  const frozenBlue = cfg.items.find((i) => i.id === "frozen_blueberry");
  const cuke = cfg.items.find((i) => i.id === "cucumber_english");
  const frozenBan = cfg.items.find((i) => i.id === "frozen_banana");
  const pineapple = cfg.items.find((i) => i.id === "pineapple_whole");
  const peppers = cfg.items.find((i) => i.id === "red_peppers_kg");
  const spinach = cfg.items.find((i) => i.id === "frozen_spinach");
  const ice = cfg.items.find((i) => i.id === "ice_cubes");
  const grayridge = cfg.items.find((i) => i.id === "grayridge_eggs");
  const dozen = cfg.items.find((i) => i.id === "large_eggs_dozen");
  if (
    !frozen ||
    !fresh ||
    !grape ||
    !banana ||
    !apple ||
    !egg ||
    !blueberries ||
    !frozenBlue ||
    !cuke ||
    !frozenBan ||
    !pineapple ||
    !peppers ||
    !spinach ||
    !ice ||
    !grayridge ||
    !dozen
  ) {
    throw new Error("missing staples");
  }

  assert(
    offerFailsStapleFilters(frozen, "ALASKO - STRAWBERRIES 5x1KG", "ALASKO") ===
      "mustIncludeAny",
    "frozen title-only still needs frozen in the name",
  );
  assert(
    offerFailsStapleOfferFilters(frozen, {
      name: "ALASKO - STRAWBERRIES 5x1KG",
      brand: "ALASKO",
      packageSize: "5x1KG",
      raw: alaskoRaw,
    }) == null,
    "frozen: DEPARTMENT_FROZEN + strawberries",
  );
  assert(
    offerFailsStapleOfferFilters(fresh, {
      name: "ALASKO - STRAWBERRIES 5x1KG",
      brand: "ALASKO",
      raw: alaskoRaw,
    }) === "mustNotInclude:frozen",
    "fresh produce rejects frozen department",
  );
  assert(
    offerFailsStapleOfferFilters(grape, {
      name: "VEGETABLES - TOMATOES GRAPE 1 PINT",
      brand: "VEGETABLES",
      packageSize: "1 PINT",
      raw: grapeRaw,
    }) == null,
    "produce: warehouse TOMATOES GRAPE matches grape tomatoes",
  );
  assert(
    isActualCategoryBOffer(grape, {
      productId: "vegetables-tomatoes-grape-1-pint-21",
      name: "VEGETABLES - TOMATOES GRAPE 1 PINT",
      brand: "VEGETABLES",
      packageSize: "1 PINT",
      raw: grapeRaw,
    }),
    "grape tomatoes identity accepts warehouse title",
  );
  assert(
    offerFailsStapleOfferFilters(banana, {
      name: "FRUITS - BANANAS #1 CASE 40 LBS",
      brand: "FRUITS",
    }) == null,
    "produce: warehouse bananas case",
  );
  assert(
    offerFailsStapleOfferFilters(apple, {
      name: "ALASKO - APPLE SLICES 5x1KG",
      brand: "ALASKO",
      taxonomyText: "FROZEN FRUITS DEPARTMENT_FROZEN",
    }) == null,
    "catalog taxonomyText covers frozen apple without live raw",
  );
  assert(
    offerFailsStapleFilters(egg, "Naturegg Egg Whites 1kg", "Naturegg") ===
      "mustIncludeAny",
    "category A does not split simply egg whites across tokens",
  );
  const qs = categoryBSearchQueries(grape);
  assert(
    qs.some((q) => /tomatoes grape/i.test(q)),
    "category B search includes warehouse word order",
  );
  const blueQs = categoryBSearchQueries(blueberries);
  assert(
    blueQs.every((q) => !/\bfresh\b/i.test(q) && !/\bpint\b/i.test(q)),
    `blueberry search must not send fresh/pint, got ${blueQs.join(" | ")}`,
  );
  assert(
    blueQs.some((q) => /blueberr/i.test(q)),
    "blueberry search still includes the fruit token",
  );
  assert(
    offerFailsStapleOfferFilters(blueberries, {
      name: "Great Value Cultivated Blueberries, 600 g",
      brand: "Great Value",
      packageSize: "600 g",
    }) === "mustNotInclude:cultivated",
    "fresh blueberries reject the frozen cultivated bag",
  );
  assert(
    offerFailsStapleOfferFilters(blueberries, {
      name: "Blueberries, 312 g",
      packageSize: "312 g",
    }) == null,
    "conventional 312g blueberries pass",
  );
  assert(
    isActualCategoryBOffer(frozenBlue, {
      productId: "kefir",
      name: "Mc Dairy Blueberry Kefir 2.4 % M.F.",
      brand: "Mc Dairy",
      packageSize: "1 l",
      price: 6,
    }) === false,
    "kefir is not frozen blueberries",
  );
  assert(
    isActualCategoryBOffer(frozenBlue, {
      productId: "pint",
      name: "Blueberries 1 pint",
      packageSize: "1 ea",
      price: 4.99,
    }) === false,
    "fresh pint is not frozen blueberries",
  );
  assert(
    isActualCategoryBOffer(cuke, {
      productId: "baby",
      name: "VEGETABLES - CUCUMBERS BABY CASE 20LB 20 LBS",
      brand: "VEGETABLES",
      packageSize: "20 LBS",
      price: 21.99,
    }) === false,
    "baby cucumbers are not english cucumbers",
  );
  assert(
    isActualCategoryBOffer(cuke, {
      productId: "eng",
      name: "VEGETABLES - CUCUMBERS ENGLISH CASE 12 EA",
      brand: "VEGETABLES",
      packageSize: "12 EA",
      price: 7.99,
    }) === true,
    "warehouse english cucumber case is the staple",
  );
  assert(
    isActualCategoryBOffer(blueberries, {
      productId: "bagel",
      name: "No Name Blueberry Bagel",
      brand: "No Name",
      packageSize: "450 g",
      parsedMassKg: 0.45,
      price: 2.25,
    }) === false,
    "bagel is not fresh blueberries",
  );
  assert(
    isActualCategoryBOffer(blueberries, {
      productId: "loaf",
      name: "Farmer's Market Blueberry Loaf",
      price: 5,
    }) === false,
    "blueberry loaf is not fresh blueberries",
  );
  assert(
    isActualCategoryBOffer(blueberries, {
      productId: "2kg",
      name: "No Name Blueberries",
      brand: "No Name",
      packageSize: "2 kg",
      parsedMassKg: 2,
      price: 13.99,
    }) === false,
    "2 kg frozen bag is not a fresh blueberry clamshell",
  );
  assert(
    isActualCategoryBOffer(blueberries, {
      productId: "pint",
      name: "Blueberries 1 pint",
      packageSize: "1 ea",
      price: 4.99,
    }) === true,
    "fresh pint is blueberries",
  );
  assert(
    isActualCategoryBOffer(fresh, {
      productId: "shortcake",
      name: "Your Fresh Market Strawberry Shortcake",
      price: 5.98,
    }) === false,
    "shortcake is not strawberries",
  );
  assert(
    isActualCategoryBOffer(frozen, {
      productId: "breyers",
      name: "Breyers Strawberry Frozen Dessert",
      brand: "Breyers",
      packageSize: "1410 ml",
      taxonomyText: "DEPARTMENT_FROZEN",
      price: 4,
    }) === false,
    "frozen dessert is not frozen strawberries",
  );
  assert(
    isActualCategoryBOffer(frozenBan, {
      productId: "peppers",
      name: "Putter's Banana Peppers Sliced Old Fashioned",
      brand: "Putter's",
      packageSize: "750 ml",
      price: 5.29,
    }) === false,
    "banana peppers are not frozen banana",
  );
  assert(
    isActualCategoryBOffer(pineapple, {
      productId: "sliced",
      name: "Liebers Pineapple, Sliced",
      brand: "Liebers",
      packageSize: "567 g",
      parsedMassKg: 0.567,
      price: 3.49,
    }) === false,
    "canned sliced pineapple is not whole pineapple",
  );
  assert(
    isActualCategoryBOffer(pineapple, {
      productId: "whole",
      name: "Pineapple",
      packageSize: "1 ea",
      parsedMassKg: 1,
      price: 4.99,
    }) === true,
    "whole pineapple each is the staple",
  );
  assert(
    isActualCategoryBOffer(peppers, {
      productId: "jar",
      name: "S&F Red Peppers, Roasted",
      packageSize: "1.5 l",
      price: 9.99,
    }) === false,
    "roasted jarred peppers are not fresh red peppers",
  );
  const pear = cfg.items.find((i) => i.id === "pear_bosc_kg");
  assert(pear, "missing pear staple");
  assert(
    isActualCategoryBOffer(pear, {
      productId: "bosc",
      name: "Pear, Bosc, Sold in singles, 0.18 - 0.30 KG",
      packageSize: "300 g",
      parsedMassKg: 0.3,
      price: 1.57,
    }) === true,
    "bosc pear singles are the staple",
  );
  assert(
    isActualCategoryBOffer(pear, {
      productId: "bartlett",
      name: "Pear, Red Bartlett, Sold in singles, 0.18 - 0.20 KG",
      packageSize: "200 g",
      parsedMassKg: 0.2,
      price: 0.41,
    }) === true,
    "bartlett is still a pear when variety is flexible",
  );
  assert(
    isActualCategoryBOffer(spinach, {
      productId: "fillo",
      name: "Krinos Mini Rolls Spinach and Cheese, Cook from Frozen",
      packageSize: "454 g",
      taxonomyText: "DEPARTMENT_FROZEN",
      price: 4.78,
    }) === false,
    "spinach fillo rolls are not chopped spinach",
  );

  assert(resolveMatchMode(grayridge) === "preferred", "grayridge is Category A");
  assert(resolveMatchMode(dozen) === "cheapest", "dozen eggs are cheapest carton");
  assert(resolveMatchMode(ice) === "cheapest", "bag of ice is cheapest");
  assert(
    offerFailsStapleFilters(
      ice,
      "Hershey's ICE BREAKERS ICE CUBES BUBBLE BREEZE",
      "Hershey's",
    ) === "mustNotInclude:breaker",
    "ice rejects Ice Breakers gum",
  );
  assert(
    offerFailsStapleFilters(
      ice,
      "STERILITE - ICE CUBE BIN WHITE EA",
      "STERILITE",
    ) === "mustNotInclude:sterilite",
    "ice rejects ice-cube storage bins",
  );
  assert(
    offerFailsStapleFilters(ice, "Bag of Ice 7 lb", undefined) == null,
    "ice accepts a bag of ice",
  );
  assert(
    offerFailsStapleFilters(
      ice,
      "CRYOPAK - SMALL ICE PACK 480GR",
      "CRYOPAK",
    ) === "mustNotInclude:ice pack",
    "ice rejects gel ice packs",
  );
  assert(
    eggCartonCountOk(dozen, "GRAY RIDGE - WHITE EGGS EXTRA LARGE 18EA") === false,
    "dozen rejects 18EA",
  );
  assert(
    eggCartonCountOk(dozen, "No Name Large Size Eggs 12 Pack") === true,
    "dozen keeps 12 pack",
  );
  assert(
    eggCartonCountOk(dozen, "No Name Large Size Eggs") === false,
    "dozen rejects unknown pack count",
  );
  assert(
    eggCartonCountOk(grayridge, "Gray Ridge Large Brown 18 Eggs") === true,
    "grayridge keeps 18-count",
  );
  assert(
    eggCartonCountOk(grayridge, "Gray Ridge Large White 12 Eggs") === false,
    "grayridge drops 12-count",
  );
  assert(
    eggCartonCountOk(
      grayridge,
      "Gray Ridge Extra Large Eggs",
      "18 ea, $0.41/1ea",
    ) === true,
    "grayridge keeps extra large 18 ea pack",
  );
  assert(
    eggCartonCountOk(
      grayridge,
      "Gray Ridge White Eggs, Large",
      "180 ea, $0.29/1ea",
    ) === false,
    "grayridge drops 180-count warehouse case",
  );
  assert(
    eggCartonCountOk(dozen, "GRAY RIDGE - EGGS WHITE LARGE 1DOZ") === true,
    "dozen treats 1DOZ as 12",
  );
  assert(
    offerFailsStapleFilters(
      dozen,
      "No Name Medium Size Eggs 12 Pack",
      "No Name",
    ) === "mustIncludeAny",
    "dozen rejects medium eggs",
  );

  console.log("staple-filter-self-check ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

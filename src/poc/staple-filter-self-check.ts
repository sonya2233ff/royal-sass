/**
 * Category B (cheapest produce/frozen) filters use title + pack + retailer
 * taxonomy. Category A stays contiguous title match.
 *   npx tsx src/poc/staple-filter-self-check.ts
 */
import {
  categoryBSearchQueries,
  looksLikeWalmartProductId,
  offerFailsStapleFilters,
  offerFailsStapleOfferFilters,
  stapleBrandHint,
  walmartCheapestHintIds,
} from "@/domain/catalog-normalize";
import { isActualCategoryBOffer } from "@/domain/same-packed-item";
import {
  collectPriceRefreshIds,
  eggCartonCountOk,
  isShownStaple,
  loadStaplesConfig,
  resolveMatchMode,
} from "@/lib/staples";
import { eggCatalogSourceIds, queryLooksLikeShellEggs } from "@/domain/egg-pack";
import { rapidOfferMatchesSku } from "@/connectors/walmart-rapid";
import {
  catalogRowForStaple,
  catalogSkuForPriceRefresh,
  identityLockAllowsFilterMismatch,
  mergeCatalogRows,
  resolveCatalogOffer,
} from "@/domain/compare-resolve";
import { evaluatePurchase, pickCheapestCoveringOffer } from "@/domain/checkout";
import { offerMatchesIdentity } from "@/domain/product-identity";
import { toRestaurantProduct, stapleWithClientOverride, applyProductOverride } from "@/domain/restaurant-product";
import { sanityCheckOffer } from "@/domain/sanity";
import { scoreOfferMatch, staplePickQuery } from "@/domain/matching";
import { identityKeywords, isPackSizeKeyword } from "@/domain/pack-tokens";
import {
  catalogSearchHay,
  searchShownCatalog,
  stapleMatchesCatalogQuery,
} from "@/domain/staple-search";

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
  const tomato = cfg.items.find((i) => i.id === "tomato");
  const wraps = cfg.items.find((i) => i.id === "wraps_plain_6in");
  const eggplant = cfg.items.find((i) => i.id === "eggplant_kg");
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
    !dozen ||
    !tomato ||
    !wraps ||
    !eggplant
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
    offerFailsStapleOfferFilters(grape, {
      name: "Nature Fresh Farms - Devours, Premium Red Grape Tomato - 283g",
    }) == null,
    "Devours grape 283g is the grape tomato pack",
  );
  assert(
    isActualCategoryBOffer(grape, {
      productId: "72CDS4R4V81X",
      name: "Nature Fresh Farms - Devours, Premium Red Grape Tomato - 283g, Devours Premium Red Grape Toms",
      packageSize: "283 g",
      parsedMassKg: 0.283,
      sourceUrl:
        "https://www.walmart.ca/en/ip/nature-fresh-farms-devours-premium-red-grape-tomato/72CDS4R4V81X",
    }),
    "grower-branded grape clamshell is still category B produce",
  );
  assert(
    offerFailsStapleOfferFilters(grape, {
      name: "SUNSET Campari Tomatoes, 1lb",
    }) === "mustIncludeAny",
    "Campari is not grape/cherry",
  );
  assert(
    offerFailsStapleOfferFilters(grape, {
      name: "HJADGG Cherry Pink Grape Tomato Seeds, 200pcs",
    }) === "mustNotInclude:seed" ||
      offerFailsStapleOfferFilters(grape, {
        name: "HJADGG Cherry Pink Grape Tomato Seeds, 200pcs",
      }) === "mustNotInclude:seeds",
    "garden seeds are not grape tomatoes",
  );
  assert(
    offerFailsStapleOfferFilters(grape, {
      name: "Your Fresh Market Cherry Tomatoes 10 oz",
    }) == null,
    "cherry tomato clamshell is the same cafe pack as grape",
  );
  const mvrGrapeHandle = {
    productId: "vegetables-grape-tomatoes-case-15-x-1-lb",
    name: "VEGETABLES - TOMATOES LOOSE CASE 13 LB",
    brand: "VEGETABLES",
    packageSize: "13 LB",
    price: 13.99,
    sourceUrl:
      "https://plus.mvrwholesale.com/products/vegetables-grape-tomatoes-case-15-x-1-lb",
  };
  const mvrRoundCase = {
    productId: "vegetables-tomatoes-5x6-case-25-lbs",
    name: "VEGETABLES - TOMATOES 5X6 CASE 25 LBS",
    brand: "VEGETABLES",
    packageSize: "25 LBS",
    price: 29.99,
    sourceUrl:
      "https://plus.mvrwholesale.com/products/vegetables-tomatoes-5x6-case-25-lbs",
  };
  assert(
    offerFailsStapleOfferFilters(tomato, mvrGrapeHandle) === "mustNotInclude:grape",
    "fresh tomato rejects grape Shopify handle even if title says loose",
  );
  assert(
    !isActualCategoryBOffer(tomato, mvrGrapeHandle),
    "category B identity rejects grape handle as round tomato",
  );
  assert(
    isActualCategoryBOffer(tomato, mvrRoundCase),
    "round tomato still accepts 5x6 tomato case",
  );
  assert(
    isActualCategoryBOffer(grape, mvrGrapeHandle),
    "grape tomatoes card still accepts a grape Shopify handle",
  );
  const tomatoResolved = resolveCatalogOffer({
    item: tomato,
    row: { offer: mvrGrapeHandle, alternates: [mvrRoundCase] },
    matchMode: "cheapest",
  });
  assert(
    tomatoResolved.offer?.productId === mvrRoundCase.productId,
    `round tomato must not keep grape handle winner, got ${tomatoResolved.offer?.productId}`,
  );
  assert(
    catalogSkuForPriceRefresh({
      item: tomato,
      row: { offer: mvrGrapeHandle, alternates: [mvrRoundCase] },
    }) === mvrRoundCase.productId,
    "price refresh retargets the filter-passing tomato case",
  );
  assert(
    catalogSkuForPriceRefresh({
      item: wraps,
      row: {
        offer: {
          productId: "21718133_EA",
          name: "Foam Pumpkin Decoration 4.75\" x 6\" - Orange",
          packageSize: "1 ea",
          price: 6,
        },
      },
    }) == null,
    "price refresh must not keep a foam pumpkin as 6in wraps",
  );
  assert(
    rapidOfferMatchesSku(
      { productId: "PRD6000196635381", sourceUrl: "https://www.walmart.ca/en/ip/x/6000196635381" },
      "6000196635381",
    ),
    "Rapid search SKU match strips PRD and accepts the CA product id",
  );
  const refreshIds = collectPriceRefreshIds([
    { id: "large_eggs_dozen" },
    { id: "simply_egg_whites" },
    { id: "grayridge_eggs" },
  ]);
  assert(
    refreshIds.includes("grayridge_eggs") && refreshIds.includes("eggs_30ct"),
    "price refresh also covers hidden egg catalog source rows",
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
  const nfFreeRunWhites = {
    productId: "20820130001_EA",
    name: "Burnbrae Farms Naturegg Free Run Egg Whites",
    brand: "Burnbrae Farms",
    packageSize: "500 g",
    parsedMassKg: 0.5,
    price: 5.5,
  };
  const nfSimply500ml = {
    productId: "20820355001_EA",
    name: "Burnbrae Farms Naturegg Simply Egg Whites",
    brand: "Burnbrae Farms",
    packageSize: "500 ml, $1.10/100ml",
    parsedMassKg: 0.5,
    price: 5.49,
    sourceUrl:
      "https://www.nofrills.ca/en/naturegg-simply-egg-whites/p/20820355001_EA",
  };
  assert(
    offerFailsStapleOfferFilters(egg, nfFreeRunWhites) ===
      "mustNotInclude:free run",
    "NF Free Run egg whites fail Category A filters",
  );
  assert(
    offerFailsStapleOfferFilters(egg, nfSimply500ml) == null,
    "NF Simply Egg Whites 500 ml pass Category A filters",
  );
  assert(
    offerFailsStapleFilters(egg, "Egg Whites 1 kg", "") === "mustIncludeAny",
    "generic egg whites is not Simply",
  );
  const whitesProduct = toRestaurantProduct(egg);
  assert(
    !offerMatchesIdentity({
      product: whitesProduct,
      offer: nfFreeRunWhites,
    }).ok,
    "identity rejects Free Run for the Simply card",
  );
  assert(
    offerMatchesIdentity({
      product: whitesProduct,
      offer: nfSimply500ml,
    }).ok,
    "identity accepts Simply 500 ml as the same branded product",
  );
  const freeRunResolved = resolveCatalogOffer({
    item: egg,
    row: { offer: nfFreeRunWhites },
    matchMode: "preferred",
  });
  assert(
    freeRunResolved.offer == null,
    `Free Run catalog winner must be dropped, got ${freeRunResolved.offer?.productId}`,
  );
  const simplyResolved = resolveCatalogOffer({
    item: egg,
    row: { offer: nfSimply500ml },
    matchMode: "preferred",
    product: whitesProduct,
    requested: 1,
    link: {
      retailerProductId: "20820355001_EA",
      verified: true,
      decision: "auto_linked",
      kind: "identity",
      skippedRematch: true,
    },
  });
  assert(
    simplyResolved.offer?.productId === "20820355001_EA",
    `identity lock keeps NF Simply 500 ml, got ${simplyResolved.offer?.productId}`,
  );
  const oatZero = {
    productId: "2ADJVX8MAQ1Q",
    name: "Earth's Own Gluten-Free, Zero Sugar Original Oat Milk Alternative, 1.75L",
    price: 4.47,
    packageSize: "1.75 L",
  };
  const oatOrig = {
    productId: "54TFZVS2LHS3",
    name: "Earth's Own Gluten-Free, Original Oat Milk Alternative, 1.75L",
    price: 4.47,
    packageSize: "1.75 L",
  };
  const oatItem = {
    id: "oat_beverage_original",
    mustIncludeAny: ["earth's own", "earths own"],
    mustNotInclude: ["zero sugar"],
  };
  assert(
    offerFailsStapleOfferFilters(oatItem, oatZero) === "mustNotInclude:zero sugar",
    "search still rejects Zero Sugar as Original oat",
  );
  assert(
    identityLockAllowsFilterMismatch(oatItem),
    "oat Original is the operator Zero Sugar exception",
  );
  const oatKeep = resolveCatalogOffer({
    item: oatItem,
    row: { offer: oatZero, alternates: [oatOrig] },
    link: {
      retailerProductId: "2ADJVX8MAQ1Q",
      verified: true,
      kind: "identity",
    },
    matchMode: "preferred",
  });
  assert(
    oatKeep.offer?.productId === "2ADJVX8MAQ1Q",
    `oat exception keeps locked Zero Sugar, got ${oatKeep.offer?.productId}`,
  );
  const otherLockedZero = resolveCatalogOffer({
    item: {
      id: "almond_original",
      mustIncludeAny: ["earth's own", "earths own"],
      mustNotInclude: ["zero sugar"],
    },
    row: { offer: oatZero, alternates: [oatOrig] },
    link: {
      retailerProductId: "2ADJVX8MAQ1Q",
      verified: true,
      kind: "identity",
    },
    matchMode: "preferred",
  });
  assert(
    otherLockedZero.offer?.productId === "54TFZVS2LHS3",
    `non-oat lock cannot keep a mustNotInclude miss, got ${otherLockedZero.offer?.productId}`,
  );
  const buySimply500 = evaluatePurchase({
    product: whitesProduct,
    requested: 1,
    offer: nfSimply500ml,
  });
  assert(buySimply500.valid, `2×500 ml Simply must cover 1 kg (${buySimply500.reason})`);
  assert(buySimply500.packs === 2, `2×500 ml packs, got ${buySimply500.packs}`);
  assert(
    buySimply500.checkoutCost === 10.98,
    `2 × $5.49 = $10.98, got ${buySimply500.checkoutCost}`,
  );
  const qs = categoryBSearchQueries(grape);
  assert(
    qs.some((q) => /tomatoes grape/i.test(q)),
    "category B search includes warehouse word order",
  );
  assert(
    qs.some((q) => /^grape tomato$/i.test(q)),
    "category B search includes singular grape tomato (Devours title)",
  );
  assert(
    qs.every((q) => !looksLikeWalmartProductId(q)),
    "WM Rapid ids stay out of shared NF/MVR search queries",
  );
  const grapeHints = walmartCheapestHintIds(
    { queries: grape.queries, preferredProductId: grape.preferredProductId },
    ["6000196099049", "72CDS4R4V81X"],
  );
  assert(
    grapeHints.includes("72CDS4R4V81X") && grapeHints.includes("6000196099049"),
    `grape cheapest hints ${grapeHints.join(",")}`,
  );
  const blueHints = walmartCheapestHintIds(
    { queries: ["blueberries"], preferredProductId: undefined },
    ["6000197209331"],
  );
  assert(
    blueHints.includes("6000197209331"),
    "Category B cheapest still getProduct the mapped WM SKU when search omits it",
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
    eggCartonCountOk(dozen, "GRAY RIDGE - WHITE EGGS EXTRA LARGE 18EA") === true,
    "Large Eggs count allows 18; Extra Large is a name filter",
  );
  assert(
    offerFailsStapleFilters(
      dozen,
      "GRAY RIDGE - WHITE EGGS EXTRA LARGE 18EA",
      "GRAY RIDGE",
    ) === "mustNotInclude:extra large",
    "Large Eggs rejects Extra Large",
  );
  assert(
    eggCartonCountOk(dozen, "No Name Large Size Eggs 18 Pack") === true,
    "Large Eggs keeps 18 pack",
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
    eggCartonCountOk(dozen, "GRAY RIDGE - EGGS WHITE LARGE 15x1 DOZ") === true,
    "dozen keeps 15×1 dozen wholesale case",
  );
  assert(
    eggCartonCountOk(
      grayridge,
      "GRAY RIDGE - WHITE EGGS EXTRA LARGE 10x18EA",
      "10x18EA",
    ) === true,
    "grayridge keeps 10×18 case of 18-count cartons",
  );
  assert(
    offerFailsStapleFilters(
      dozen,
      "GRAY RIDGE - EGGS LARGE BROWN 18EA",
      "GRAY RIDGE",
    ) == null,
    "Large Eggs keeps Gray Ridge Large 18",
  );
  assert(
    eggCatalogSourceIds(dozen).includes("grayridge_eggs"),
    "Large Eggs reads the hidden Grayridge catalog row",
  );

  const mergedEggs = mergeCatalogRows([
    {
      offer: {
        productId: "doz",
        name: "GRAY RIDGE - EGGS WHITE LARGE 1DOZ",
        price: 4.19,
      },
      alternates: [
        {
          productId: "case",
          name: "GRAY RIDGE - EGGS WHITE LARGE 15x1 DOZ",
          price: 57.99,
        },
      ],
    },
    {
      offer: {
        productId: "xl",
        name: "GRAY RIDGE - WHITE EGGS EXTRA LARGE 18EA",
        price: 6.69,
      },
      alternates: [
        {
          productId: "l18",
          name: "GRAY RIDGE - EGGS LARGE BROWN 18EA",
          price: 6.69,
        },
      ],
    },
  ]);
  assert(mergedEggs?.alternates?.some((o) => o.productId === "l18"), "merge keeps Large 18");
  const byId = new Map([
    ["large_eggs_dozen", { offer: mergedEggs!.offer, alternates: mergedEggs!.alternates }],
  ]);
  const fromSources = catalogRowForStaple(dozen, byId);
  assert(fromSources?.offer?.productId === "doz", "staple row still starts from dozen");

  const resolvedEggs = resolveCatalogOffer({
    item: dozen,
    row: mergedEggs,
    matchMode: "cheapest",
    link: {
      retailerProductId: "doz",
      verified: false,
      decision: "auto_linked",
      kind: "identity",
    },
  });
  assert(
    resolvedEggs.offer?.productId !== "xl",
    "cheapest Large Eggs does not lock Extra Large",
  );
  assert(
    offerFailsStapleOfferFilters(dozen, {
      name: "GRAY RIDGE - WHITE EGGS EXTRA LARGE 18EA",
    }) === "mustNotInclude:extra large",
    "merged Extra Large is name-filtered",
  );

  const eggProduct = toRestaurantProduct({
    id: "large_eggs_dozen",
    label: "Large Eggs",
    category: "eggs",
    matchMode: "cheapest_equivalent",
    defaultAmount: 12,
    unit: "ea",
  });
  const covering18 = pickCheapestCoveringOffer(eggProduct, 18, [
    { price: 4.19, name: "GRAY RIDGE - EGGS WHITE LARGE 1DOZ" },
    { price: 6.69, name: "GRAY RIDGE - EGGS LARGE BROWN 18EA" },
  ]);
  assert(
    covering18?.name === "GRAY RIDGE - EGGS LARGE BROWN 18EA",
    "18 eggs prefers one Large 18 over two dozens",
  );
  const covering180 = pickCheapestCoveringOffer(eggProduct, 180, [
    { price: 4.19, name: "GRAY RIDGE - EGGS WHITE LARGE 1DOZ" },
    { price: 57.99, name: "GRAY RIDGE - EGGS WHITE LARGE 15x1 DOZ" },
    { price: 60.89, name: "GRAY RIDGE - WHITE EGGS EXTRA LARGE 10x18EA", packageSize: "10x18EA" },
  ]);
  assert(
    covering180?.name === "GRAY RIDGE - EGGS WHITE LARGE 15x1 DOZ",
    "180 eggs prefers the Large 15×1 case",
  );

  const caseSanity = sanityCheckOffer({
    itemId: "large_eggs_dozen",
    name: "GRAY RIDGE - EGGS WHITE LARGE 15x1 DOZ",
    price: 57.99,
    minPlausiblePrice: 2,
    maxPlausiblePrice: 16,
  });
  assert(caseSanity.ok, `MVR Large case is plausible per carton (${caseSanity.reason})`);

  assert(queryLooksLikeShellEggs("яйця") === true, "UA яйця is shell eggs");
  assert(queryLooksLikeShellEggs("яєць") === true, "UA яєць is shell eggs");
  assert(queryLooksLikeShellEggs("eggs") === true, "eggs is shell eggs");
  assert(queryLooksLikeShellEggs("eggplant") === false, "eggplant is not eggs");
  assert(queryLooksLikeShellEggs("egg whites") === false, "whites are not shell eggs");
  assert(isShownStaple(dozen) === true, "one eggs staple is shown");
  assert(isShownStaple(grayridge) === false, "Grayridge lock is not a second catalog egg");
  const shownEggs = cfg.items.filter((i) => isShownStaple(i) && queryLooksLikeShellEggs("яйця") && (i.id === "grayridge_eggs" || i.id === "large_eggs_dozen" || i.category === "eggs"));
  assert(shownEggs.length === 1 && shownEggs[0]!.id === "large_eggs_dozen", "catalog has one shell-egg staple");

  assert(
    !catalogSearchHay(wraps).includes("pumpkin"),
    "wraps catalog hay must not include banned pumpkin",
  );
  assert(
    !stapleMatchesCatalogQuery(wraps, "pumpkin"),
    "pumpkin must not match wraps via catalog search",
  );
  const pumpkinHits = searchShownCatalog(cfg.items.filter(isShownStaple), "pumpkin", 50);
  assert(
    pumpkinHits.every((i) => i.id !== "wraps_plain_6in"),
    "pumpkin search must not surface wraps",
  );
  const eggUaHits = searchShownCatalog(cfg.items.filter(isShownStaple), "яйця", 50);
  assert(
    eggUaHits.length === 1 && eggUaHits[0]!.id === "large_eggs_dozen",
    `яйця must only hit Large Eggs, got ${eggUaHits.map((i) => i.id).join(",")}`,
  );
  const eggEnHits = searchShownCatalog(cfg.items.filter(isShownStaple), "eggs", 50);
  assert(
    eggEnHits.length === 1 && eggEnHits[0]!.id === "large_eggs_dozen",
    `eggs must only hit Large Eggs, got ${eggEnHits.map((i) => i.id).join(",")}`,
  );
  assert(
    !stapleMatchesCatalogQuery(egg, "eggs"),
    "eggs must not match egg whites",
  );
  assert(
    !stapleMatchesCatalogQuery(eggplant, "eggs"),
    "eggs must not fall through to eggplant",
  );
  assert(
    stapleMatchesCatalogQuery(eggplant, "eggplant"),
    "eggplant query still finds eggplant",
  );
  assert(
    stapleMatchesCatalogQuery(tomato, "tomato"),
    "tomato query finds the tomato card",
  );
  assert(
    !stapleMatchesCatalogQuery(tomato, "unico"),
    "Unico canned title must not be the tomato search hay",
  );
  assert(
    !catalogSearchHay(tomato).includes("unico"),
    "tomato catalog hay excludes mustNotInclude unico",
  );

  const shown = cfg.items.filter(isShownStaple);
  assert(shown.length >= 124, `shown staples ${shown.length}`);
  assert(
    shown.some((i) => i.id === "cups_12oz_black_ripple"),
    "receipt cups are shown",
  );
  assert(
    shown.some((i) => i.id === "haolam_ricotta_cheese"),
    "receipt Haolam is shown",
  );
  const cups = cfg.items.find((i) => i.id === "cups_12oz_black_ripple");
  assert(cups && resolveMatchMode(cups) === "cheapest", "ripple cups cheapest");
  const haolam = cfg.items.find((i) => i.id === "haolam_ricotta_cheese");
  assert(haolam && resolveMatchMode(haolam) === "preferred", "Haolam is Category A");
  const frozenPine = cfg.items.find((i) => i.id === "frozen_pineapple");
  assert(frozenPine?.category === "frozen", "Alasko pineapple is frozen not produce");
  assert(
    offerFailsStapleFilters(
      dozen,
      "No Name Medium Size Eggs 12 Pack",
      "No Name",
    ) === "mustNotInclude:medium",
    "dozen rejects medium eggs",
  );

  const oj = cfg.items.find((i) => i.id === "orange_juice_pulp");
  assert(oj, "orange juice staple");
  const rematchOj = stapleWithClientOverride(oj!, {
    matchMode: "cheapest_equivalent",
    matchRules: {
      productType: "orange juice",
      mustNotInclude: ["tropicana", "lots of pulp"],
    },
  });
  assert(
    rematchOj.queries[0]?.toLowerCase() === "orange juice",
    "cheapest override prepends productType to queries",
  );
  assert(
    rematchOj.mustNotInclude?.includes("tropicana"),
    "override exclude keywords apply",
  );
  assert(
    rematchOj.matchMode === "cheapest_equivalent",
    "override keeps cheapest_equivalent",
  );
  const exactOj = stapleWithClientOverride(oj!, {
    matchMode: "exact",
    matchRules: { productType: "orange juice" },
  });
  assert(
    exactOj.queries[0]?.toLowerCase().includes("tropicana"),
    "exact rematch keeps tropicana query first",
  );
  assert(
    stapleWithClientOverride(oj!) === oj,
    "no override returns the same staple",
  );

  const mergedOj = stapleWithClientOverride(oj!, {
    matchMode: "exact",
    matchRules: { mustIncludeAny: ["orange juice"] },
  });
  assert(
    mergedOj.mustIncludeAny?.some((t) => /tropicana|no pulp|pulp/i.test(t)),
    "settings include must keep catalog tropicana/no-pulp filters",
  );
  assert(
    mergedOj.mustIncludeAny?.some((t) => /orange juice/i.test(t)),
    "settings include is added to catalog filters",
  );

  const uiOj = applyProductOverride(toRestaurantProduct(oj!), {
    matchRules: { mustIncludeAny: ["orange juice"] },
  });
  assert(
    uiOj.matchRules?.mustIncludeAny?.some((t) => /tropicana/i.test(t)) &&
      uiOj.matchRules?.mustIncludeAny?.some((t) => /orange juice/i.test(t)),
    "product settings merge include with catalog, they do not replace it",
  );

  assert(
    offerFailsStapleFilters(
      {
        id: "orange_juice_pulp",
        mustIncludeAny: ["tropicana", "2.63L", "2.63"],
      },
      "Tropicana Pulp Free",
      "Tropicana",
    ) == null,
    "pack-size include tokens must not reject titles that omit litres",
  );
  assert(
    offerFailsStapleFilters(
      {
        id: "cups",
        mustIncludeAll: ["ripple", "12oz"],
      },
      "BLACK RIPPLE WALL CUP",
      "Maher",
    ) == null,
    "12oz as mustIncludeAll must not reject titles that omit ounces",
  );
  assert(
    identityKeywords(["tropicana", "12oz", "2.63L", "ripple"]).join(",") ===
      "tropicana,ripple",
    "identityKeywords drops pack sizes",
  );
  assert(isPackSizeKeyword("2.63L") && isPackSizeKeyword("5x1"), "pack keywords");

  const ojQs = categoryBSearchQueries(oj!);
  assert(
    ojQs[0]?.toLowerCase().includes("tropicana"),
    `OJ search starts with tropicana query, got ${ojQs[0]}`,
  );

  const bagasse = cfg.items.find((i) => i.id === "lids_bagasse_bowl");
  assert(bagasse, "bagasse bowl lids staple");
  assert(
    offerFailsStapleFilters(
      bagasse!,
      "Packaging Naturally 4oz Bagasse Portion Cup Lid | 2000/case",
      "Packaging Naturally",
    ) === "mustNotInclude:portion cup" ||
      offerFailsStapleFilters(
        bagasse!,
        "Packaging Naturally 4oz Bagasse Portion Cup Lid | 2000/case",
        "Packaging Naturally",
      ) === "mustNotInclude:case" ||
      offerFailsStapleFilters(
        bagasse!,
        "Packaging Naturally 4oz Bagasse Portion Cup Lid | 2000/case",
        "Packaging Naturally",
      ) === "mustNotInclude:4oz",
    "bagasse lids reject 4oz portion-cup warehouse cases",
  );
  assert(
    offerFailsStapleFilters(
      bagasse!,
      "MAHER PRODUCTS - CLEAR LID FOR BAGASSE BOWL 24/32OZ 50 CT",
      "MAHER PRODUCTS",
    ) == null,
    "bagasse lids keep cafe 50-count bowl lids",
  );

  const domeCups = cfg.items.find((i) => i.id === "lids_dome_12_24oz");
  assert(domeCups, "dome lids 12-24oz staple");
  assert(
    offerFailsStapleFilters(
      domeCups!,
      "Pack N' Eat Plastic Dome Lid for 12 oz Bowl -- 400 per case",
      "Pack n' Eat",
    ) != null,
    "12-24oz dome lids reject bowl lids and per-case warehouse packs",
  );
  assert(
    offerFailsStapleFilters(
      domeCups!,
      "MAHER PRODUCTS - DOME LID FOR 12-24oz CLEAR CUP 50 PK",
      "MAHER PRODUCTS",
    ) == null,
    "12-24oz dome lids keep cafe cup 50-packs",
  );

  const noHole = cfg.items.find((i) => i.id === "lids_dome_no_hole");
  assert(noHole, "no-hole dome lids staple");
  assert(
    offerFailsStapleFilters(
      noHole!,
      "PET Dome Lid 98mm (Clear) without Hole for 12oz - 24oz PET Cold Cups 1000 unit/Pack",
      "Green Century",
    ) === "mustNotInclude:1000",
    "no-hole dome lids reject 1000-unit warehouse packs",
  );

  const tray = cfg.items.find((i) => i.id === "party_tray_12x12");
  assert(tray, "12x12 party tray staple");
  assert(
    offerFailsStapleFilters(
      tray!,
      "MIANHT Plastic Fruit Serving Tray 7.7 Inch Round Food Grade PVC",
      "MIANHT",
    ) != null,
    "12x12 tray rejects 7.7 inch round platters",
  );
  assert(
    offerFailsStapleFilters(
      tray!,
      "TALTHI - CLEAR PARTY TRAY 12x12 IN 5 PK",
      "TALTHI",
    ) == null,
    "12x12 tray keeps the square 12x12 cafe pack",
  );

  const oreo = cfg.items.find((i) => i.id === "oreo_sandwich_cookies");
  assert(oreo, "oreo staple");
  assert(
    offerFailsStapleFilters(
      oreo!,
      "Oreo Mint Crème Sandwich Cookies",
      "OREO",
    ) === "mustNotInclude:mint",
    "oreo rejects mint crème",
  );
  assert(
    offerFailsStapleFilters(
      oreo!,
      "Christie OREO Double Stuf Sandwich Cookies",
      "Christie",
    ) == null,
    "oreo keeps chocolate sandwich cookies",
  );

  const pam = cfg.items.find((i) => i.id === "pam_cookware_coating");
  assert(pam, "pam staple");
  assert(
    offerFailsStapleFilters(
      pam!,
      "PAM Baking No-Stick Cooking Spray",
      "Pam",
    ) === "mustNotInclude:baking",
    "pam rejects baking spray",
  );
  assert(
    offerFailsStapleFilters(
      pam!,
      "PAM Original No-Stick Cooking Spray",
      "Pam",
    ) == null,
    "pam keeps original cookware coating",
  );

  const parsley = cfg.items.find((i) => i.id === "parsley");
  assert(parsley, "parsley staple");
  assert(
    offerFailsStapleFilters(parsley!, "Parsley Root") === "mustNotInclude:root",
    "parsley rejects parsley root",
  );
  assert(
    offerFailsStapleFilters(
      parsley!,
      "Gefen Chopped Parsley",
      "Gefen",
    ) === "mustNotInclude:chopped",
    "parsley rejects chopped/jarred herb",
  );
  assert(
    offerFailsStapleFilters(
      parsley!,
      "Parsley, Flat, Fresh, Sold in bunches",
    ) == null,
    "parsley keeps a fresh bunch",
  );

  const pickQCups = staplePickQuery({
    label: "12oz Black Ripple Cups",
    queries: ["12oz Black Ripple Cups"],
  });
  assert(
    !/12oz|12\s*oz/i.test(pickQCups),
    `pick query must strip pack size from labels, got "${pickQCups}"`,
  );

  const labelMisses: string[] = [];
  for (const item of cfg.items.filter(isShownStaple)) {
    const cheapest = resolveMatchMode(item) === "cheapest";
    const pickQ = staplePickQuery(item, cheapest);
    const textQuery = item.queries.find((q) => q && !/^\d+$/.test(q.trim()));
    if (!cheapest && textQuery && pickQ === item.label && pickQ !== textQuery) {
      labelMisses.push(`${item.id} exact pick query fell back to card label`);
    }
    const hit = {
      retailer: "walmart_ca" as const,
      storeId: "5831",
      productId: `${item.id}-probe`,
      name: pickQ,
      brand: stapleBrandHint(item) ?? item.label.split(/\s+/)[0],
      price: 8,
      availability: "in_stock" as const,
      confidence: "exact" as const,
      checkedAt: "2026-01-01T00:00:00.000Z",
    };
    if (scoreOfferMatch(hit, pickQ) === -Infinity) {
      labelMisses.push(`${item.id} rejects its own pick query "${pickQ}"`);
    }
  }
  assert(
    labelMisses.length === 0,
    `staple pick queries must accept their own search titles:\n${labelMisses.join("\n")}`,
  );

  console.log("staple-filter-self-check ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

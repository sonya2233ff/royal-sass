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
import { loadStaplesConfig } from "@/lib/staples";

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
  const egg = cfg.items.find((i) => i.id === "simply_egg_whites");
  if (!frozen || !fresh || !grape || !banana || !egg) {
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
    offerFailsStapleFilters(egg, "Naturegg Egg Whites 1kg", "Naturegg") ===
      "mustIncludeAny",
    "category A does not split simply egg whites across tokens",
  );
  const qs = categoryBSearchQueries(grape);
  assert(
    qs.some((q) => /tomatoes grape/i.test(q)),
    "category B search includes warehouse word order",
  );

  console.log("staple-filter-self-check ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

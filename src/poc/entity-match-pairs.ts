/**
 * Gold labels for product identity: 100 pairs.
 *   exact 20 | alias 25 | size_mismatch 20 | substitute 15 | different 20
 */
import type { ProductRecord, SavedProductMapping } from "@/domain/entity-match";

export type PairKind =
  | "exact"
  | "alias"
  | "size_mismatch"
  | "substitute"
  | "different";

export interface LabeledPair {
  id: string;
  kind: PairKind;
  shouldMatch: boolean;
  left: ProductRecord;
  right: ProductRecord;
  /** When set, benchmark injects a saved mapping for this pair. */
  mapping?: SavedProductMapping;
}

function rec(
  retailer: string,
  id: string,
  name: string,
  extra: Partial<ProductRecord> = {},
): ProductRecord {
  return {
    retailer,
    retailerProductId: id,
    name,
    ...extra,
  };
}

const W = "walmart_ca";
const N = "nofrills";
const S = "sobeys";
const R = "receipt";

function numbered(
  prefix: string,
  kind: PairKind,
  shouldMatch: boolean,
  rows: Array<Omit<LabeledPair, "id" | "kind" | "shouldMatch">>,
): LabeledPair[] {
  return rows.map((row, i) => ({
    id: `${prefix}_${String(i + 1).padStart(2, "0")}`,
    kind,
    shouldMatch,
    ...row,
  }));
}

const EXACT = numbered("exact", "exact", true, [
  {
    left: rec(W, "6000196635381", "Burnbrae Farms Naturegg Simply Egg Whites 1KG", {
      brand: "Burnbrae Farms",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "eggs",
      upc: "065651002470",
    }),
    right: rec(R, "r_egg_whites", "Simply Egg Whites 1kg", {
      brand: "Burnbrae Farms",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "eggs",
      upc: "065651002470",
    }),
  },
  {
    left: rec(W, "wm_gaylea", "Gay Lea Unsalted Butter 454g", {
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
      upc: "066181001557",
    }),
    right: rec(N, "nf_gaylea", "Gay Lea Unsalted Butter 454g", {
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
      upc: "066181001557",
    }),
  },
  {
    left: rec(W, "wm_oat", "Earth's Own Original Oat Milk Alternative 1.75L", {
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
      upc: "062356547119",
    }),
    right: rec(N, "nf_oat", "Earth's Own Original Oat Milk Alternative 1.75L", {
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
      upc: "062356547119",
    }),
  },
  {
    left: rec(W, "wm_folgers", "Folgers Classic Medium Roast Ground Coffee 816 g", {
      brand: "Folgers",
      sizeValue: 816,
      sizeUnit: "g",
      category: "coffee",
      upc: "025500000134",
    }),
    right: rec(S, "sob_folgers", "Folgers Classic Medium Roast Ground Coffee 816 g", {
      brand: "Folgers",
      sizeValue: 816,
      sizeUnit: "g",
      category: "coffee",
      upc: "025500000134",
    }),
  },
  {
    left: rec(W, "wm_ziploc", "Ziploc Sandwich Bags 150 ct", {
      brand: "Ziploc",
      sizeValue: 150,
      sizeUnit: "ct",
      category: "household",
      upc: "025700000153",
    }),
    right: rec(N, "nf_ziploc", "Ziploc Sandwich Bags 150 ct", {
      brand: "Ziploc",
      sizeValue: 150,
      sizeUnit: "ct",
      category: "household",
      upc: "025700000153",
    }),
  },
  {
    left: rec(W, "wm_oil", "No Name 100% Pure Canola Oil 3L", {
      brand: "No Name",
      sizeValue: 3,
      sizeUnit: "l",
      category: "oil",
      upc: "060383007018",
    }),
    right: rec(N, "nf_oil", "No Name 100% Pure Canola Oil 3L", {
      brand: "No Name",
      sizeValue: 3,
      sizeUnit: "l",
      category: "oil",
      upc: "060383007018",
    }),
  },
  {
    left: rec(W, "wm_sugar", "No Name Granulated Sugar 2kg", {
      brand: "No Name",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "baking",
      upc: "060383039019",
    }),
    right: rec(N, "nf_sugar", "No Name Granulated Sugar 2kg", {
      brand: "No Name",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "baking",
      upc: "060383039019",
    }),
  },
  {
    left: rec(W, "wm_flour", "No Name All-Purpose Flour 2.5kg", {
      brand: "No Name",
      sizeValue: 2.5,
      sizeUnit: "kg",
      category: "baking",
      upc: "060383011015",
    }),
    right: rec(N, "nf_flour", "No Name All-Purpose Flour 2.5kg", {
      brand: "No Name",
      sizeValue: 2.5,
      sizeUnit: "kg",
      category: "baking",
      upc: "060383011015",
    }),
  },
  {
    left: rec(W, "wm_milk", "Neilson Homogenized Milk 2L", {
      brand: "Neilson",
      sizeValue: 2,
      sizeUnit: "l",
      category: "dairy",
      upc: "066800001234",
    }),
    right: rec(S, "sob_milk", "Neilson Homogenized Milk 2L", {
      brand: "Neilson",
      sizeValue: 2,
      sizeUnit: "l",
      category: "dairy",
      upc: "066800001234",
    }),
  },
  {
    left: rec(W, "wm_lemons", "Your Fresh Market Lemons 2 lb", {
      brand: "Your Fresh Market",
      sizeValue: 2,
      sizeUnit: "lb",
      category: "produce",
      upc: "628915235420",
    }),
    right: rec(N, "nf_lemons", "Your Fresh Market Lemons 2 lb", {
      brand: "Your Fresh Market",
      sizeValue: 2,
      sizeUnit: "lb",
      category: "produce",
      upc: "628915235420",
    }),
  },
  {
    left: rec(W, "wm_heinz", "Heinz Tomato Ketchup 1L", {
      brand: "Heinz",
      sizeValue: 1,
      sizeUnit: "l",
      category: "condiment",
      upc: "057000001234",
    }),
    right: rec(N, "nf_heinz", "Heinz Tomato Ketchup 1L", {
      brand: "Heinz",
      sizeValue: 1,
      sizeUnit: "l",
      category: "condiment",
      upc: "057000001234",
    }),
  },
  {
    left: rec(W, "wm_mayo", "Hellmann's Real Mayonnaise 890ml", {
      brand: "Hellmann's",
      sizeValue: 890,
      sizeUnit: "ml",
      category: "condiment",
      upc: "069000001111",
    }),
    right: rec(S, "sob_mayo", "Hellmann's Real Mayonnaise 890ml", {
      brand: "Hellmann's",
      sizeValue: 890,
      sizeUnit: "ml",
      category: "condiment",
      upc: "069000001111",
    }),
  },
  {
    left: rec(W, "wm_pb", "Kraft Smooth Peanut Butter 1kg", {
      brand: "Kraft",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
      upc: "068100001222",
    }),
    right: rec(N, "nf_pb", "Kraft Smooth Peanut Butter 1kg", {
      brand: "Kraft",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
      upc: "068100001222",
    }),
  },
  {
    left: rec(W, "wm_philly", "Philadelphia Original Cream Cheese 250g", {
      brand: "Philadelphia",
      sizeValue: 250,
      sizeUnit: "g",
      category: "dairy",
      upc: "068100003333",
    }),
    right: rec(N, "nf_philly", "Philadelphia Original Cream Cheese 250g", {
      brand: "Philadelphia",
      sizeValue: 250,
      sizeUnit: "g",
      category: "dairy",
      upc: "068100003333",
    }),
  },
  {
    left: rec(W, "wm_jello", "Jell-O Vanilla Instant Pudding Mix 147g", {
      brand: "Jell-O",
      sizeValue: 147,
      sizeUnit: "g",
      category: "baking",
      upc: "043000004444",
    }),
    right: rec(S, "sob_jello", "Jell-O Vanilla Instant Pudding Mix 147g", {
      brand: "Jell-O",
      sizeValue: 147,
      sizeUnit: "g",
      category: "baking",
      upc: "043000004444",
    }),
  },
  {
    left: rec(W, "wm_bran", "Rogers Wheat Bran 625g", {
      brand: "Rogers",
      sizeValue: 625,
      sizeUnit: "g",
      category: "baking",
      upc: "055872001555",
    }),
    right: rec(N, "nf_bran", "Rogers Wheat Bran 625g", {
      brand: "Rogers",
      sizeValue: 625,
      sizeUnit: "g",
      category: "baking",
      upc: "055872001555",
    }),
  },
  {
    left: rec(W, "wm_realemon", "ReaLemon Lemon Juice 440ml", {
      brand: "ReaLemon",
      sizeValue: 440,
      sizeUnit: "ml",
      category: "beverage",
      upc: "058000006666",
    }),
    right: rec(N, "nf_realemon", "ReaLemon Lemon Juice 440ml", {
      brand: "ReaLemon",
      sizeValue: 440,
      sizeUnit: "ml",
      category: "beverage",
      upc: "058000006666",
    }),
  },
  {
    left: rec(W, "wm_salt", "Windsor Table Salt 1kg", {
      brand: "Windsor",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
      upc: "060383007777",
    }),
    right: rec(S, "sob_salt", "Windsor Table Salt 1kg", {
      brand: "Windsor",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
      upc: "060383007777",
    }),
  },
  {
    left: rec(W, "wm_elbows", "Catelli Elbows Pasta 900g", {
      brand: "Catelli",
      sizeValue: 900,
      sizeUnit: "g",
      category: "pasta",
      upc: "060410008888",
    }),
    right: rec(N, "nf_elbows", "Catelli Elbows Pasta 900g", {
      brand: "Catelli",
      sizeValue: 900,
      sizeUnit: "g",
      category: "pasta",
      upc: "060410008888",
    }),
  },
  {
    left: rec(W, "wm_ice", "Great Value Ice Cubes 2kg", {
      brand: "Great Value",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "frozen",
      upc: "763679000230",
    }),
    right: rec(R, "r_ice", "Ice Cubes", {
      brand: "Great Value",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "frozen",
      upc: "763679000230",
    }),
  },
]);

const ALIAS = numbered("alias", "alias", true, [
  {
    left: rec(W, "wm_egg_alias", "Burnbrae Farms Naturegg Simply Egg Whites 1KG", {
      brand: "Burnbrae Farms",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "eggs",
    }),
    right: rec(N, "nf_egg_alias", "Naturegg Simply Egg Whites 1 kg carton", {
      brand: "Burnbrae",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "eggs",
    }),
  },
  {
    left: rec(W, "wm_grape_alias", "Your Fresh Market Tomato, Grape, 10 oz", {
      brand: "Your Fresh Market",
      sizeValue: 10,
      sizeUnit: "oz",
      category: "produce",
    }),
    right: rec(S, "sob_grape_alias", "YFM Grape Tomatoes 283g", {
      brand: "Your Fresh Market",
      sizeValue: 283,
      sizeUnit: "g",
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_butter_alias", "Gay Lea Unsalted Butter 454g", {
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
    }),
    right: rec(N, "nf_butter_alias", "Gay Lea Butter Unsalted 454 Grams", {
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
    }),
  },
  {
    left: rec(W, "wm_oat_alias", "Earth's Own Gluten-Free, Zero Sugar Original Oat Milk Alternative, 1.75L", {
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    }),
    right: rec(N, "nf_oat_alias", "Gluten-Free Original Oat Milk Alternative 1.75 L", {
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    }),
  },
  {
    left: rec(W, "wm_coffee_alias", "Folgers Classic Medium Roast Ground Coffee 816 g", {
      brand: "Folgers",
      sizeValue: 816,
      sizeUnit: "g",
      category: "coffee",
    }),
    right: rec(N, "nf_coffee_alias", "Folgers Classic Roast Ground Coffee 816g", {
      brand: "Folgers",
      sizeValue: 816,
      sizeUnit: "g",
      category: "coffee",
    }),
  },
  {
    left: rec(W, "wm_lemon_alias", "Lemons, Your Fresh Market, 2 lb", {
      brand: "Your Fresh Market",
      sizeValue: 2,
      sizeUnit: "lb",
      category: "produce",
    }),
    right: rec(N, "nf_lemon_alias", "Lemons, 2 lb Bag", {
      brand: "Your Fresh Market",
      sizeValue: 2,
      sizeUnit: "lb",
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_flour_alias", "Great Value All Purpose Flour 2.5 kg", {
      brand: "Great Value",
      sizeValue: 2.5,
      sizeUnit: "kg",
      category: "baking",
    }),
    right: rec(S, "sob_flour_alias", "Great Value All-Purpose Flour 2.5kg", {
      brand: "Great Value",
      sizeValue: 2.5,
      sizeUnit: "kg",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_sugar_alias", "No Name Granulated White Sugar 2kg", {
      brand: "No Name",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "baking",
    }),
    right: rec(N, "nf_sugar_alias", "Granulated Sugar 2 kg", {
      brand: "No Name",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_ketchup_alias", "Heinz Tomato Ketchup 1 L", {
      brand: "Heinz",
      sizeValue: 1,
      sizeUnit: "l",
      category: "condiment",
    }),
    right: rec(N, "nf_ketchup_alias", "Heinz Ketchup Tomato 1 Litre", {
      brand: "Heinz",
      sizeValue: 1,
      sizeUnit: "l",
      category: "condiment",
    }),
  },
  {
    left: rec(W, "wm_ziploc_alias", "Ziploc Sandwich Bags, with Grip n Seal Technology", {
      brand: "Ziploc",
      sizeValue: 150,
      sizeUnit: "ct",
      category: "household",
    }),
    right: rec(N, "nf_ziploc_alias", "Ziploc Sandwich Bags 150", {
      brand: "Ziploc",
      sizeValue: 150,
      sizeUnit: "ct",
      category: "household",
    }),
  },
  {
    left: rec(W, "wm_pb_alias", "Kraft Smooth Peanut Butter 1 kg", {
      brand: "Kraft",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
    }),
    right: rec(S, "sob_pb_alias", "Kraft Peanut Butter Smooth 1kg", {
      brand: "Kraft",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
    }),
  },
  {
    left: rec(W, "wm_mayo_alias", "Hellmann's Real Mayonnaise 890 mL", {
      brand: "Hellmann's",
      sizeValue: 890,
      sizeUnit: "ml",
      category: "condiment",
    }),
    right: rec(N, "nf_mayo_alias", "Hellmanns Mayo Real 890ml", {
      brand: "Hellmanns",
      sizeValue: 890,
      sizeUnit: "ml",
      category: "condiment",
    }),
  },
  {
    left: rec(W, "wm_cream_alias", "Philadelphia Original Cream Cheese 250 g", {
      brand: "Philadelphia",
      sizeValue: 250,
      sizeUnit: "g",
      category: "dairy",
    }),
    right: rec(N, "nf_cream_alias", "Philly Original Cream Cheese 250g", {
      brand: "Philadelphia",
      sizeValue: 250,
      sizeUnit: "g",
      category: "dairy",
    }),
  },
  {
    left: rec(W, "wm_jello_alias", "Jell-O Vanilla Instant Pudding Mix", {
      brand: "Jell-O",
      sizeValue: 147,
      sizeUnit: "g",
      category: "baking",
    }),
    right: rec(N, "nf_jello_alias", "Jello Vanilla Instant Pudding 147g", {
      brand: "Jell-O",
      sizeValue: 147,
      sizeUnit: "g",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_oil_alias", "100% Pure Canola Oil 3L", {
      brand: "No Name",
      sizeValue: 3,
      sizeUnit: "l",
      category: "oil",
    }),
    right: rec(N, "nf_oil_alias", "No Name Canola Oil 3 litre", {
      brand: "No Name",
      sizeValue: 3,
      sizeUnit: "l",
      category: "oil",
    }),
  },
  {
    left: rec(W, "wm_pasta_alias", "Catelli Elbows Pasta 900g", {
      brand: "Catelli",
      sizeValue: 900,
      sizeUnit: "g",
      category: "pasta",
    }),
    right: rec(S, "sob_pasta_alias", "Catelli Pasta Elbows 900 g", {
      brand: "Catelli",
      sizeValue: 900,
      sizeUnit: "g",
      category: "pasta",
    }),
  },
  {
    left: rec(W, "wm_salt_alias", "Windsor Table Salt 1kg", {
      brand: "Windsor",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
    }),
    right: rec(N, "nf_salt_alias", "Windsor Salt Table 1 kg", {
      brand: "Windsor",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
    }),
  },
  {
    left: rec(W, "wm_realemon_alias", "ReaLemon 100% Lemon Juice 440ml", {
      brand: "ReaLemon",
      sizeValue: 440,
      sizeUnit: "ml",
      category: "beverage",
    }),
    right: rec(N, "nf_realemon_alias", "ReaLemon Juice 440 mL", {
      brand: "ReaLemon",
      sizeValue: 440,
      sizeUnit: "ml",
      category: "beverage",
    }),
  },
  {
    left: rec(W, "wm_bran_alias", "Rogers Wheat Bran 625g", {
      brand: "Rogers",
      sizeValue: 625,
      sizeUnit: "g",
      category: "baking",
    }),
    right: rec(N, "nf_bran_alias", "Wheat Bran Rogers 625 g", {
      brand: "Rogers",
      sizeValue: 625,
      sizeUnit: "g",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_banana_alias", "Bananas, Bunch", {
      category: "produce",
    }),
    right: rec(N, "nf_banana_alias", "Bananas", {
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_cucumber_alias", "English Cucumber", {
      category: "produce",
    }),
    right: rec(N, "nf_cucumber_alias", "Cucumber English", {
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_pepper_alias", "SUNSET Red Bell Pepper, Single", {
      brand: "SUNSET",
      category: "produce",
    }),
    right: rec(N, "nf_pepper_alias", "SUNSET Red Bell Peppers", {
      brand: "SUNSET",
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_pineapple_alias", "Pineapple, Whole", {
      category: "produce",
    }),
    right: rec(N, "nf_pineapple_alias", "Pineapple", {
      category: "produce",
    }),
  },
  {
    left: rec(R, "r_foil", "Foil Green 4.27", {
      category: "household",
      upc: "082785400724",
    }),
    right: rec(W, "wm_foil", "Reynolds Wrap Heavy Duty Aluminum Foil 75 sq ft", {
      brand: "Reynolds",
      category: "household",
    }),
    mapping: {
      leftRetailer: R,
      leftProductId: "r_foil",
      rightRetailer: W,
      rightProductId: "wm_foil",
      verified: true,
    },
  },
  {
    left: rec(R, "r_burner", "Double Burner", {
      category: "household",
      upc: "655772019780",
    }),
    right: rec(W, "wm_burner", "Mainstays Portable Double Electric Burner", {
      brand: "Mainstays",
      category: "household",
    }),
    mapping: {
      leftRetailer: R,
      leftProductId: "r_burner",
      rightRetailer: W,
      rightProductId: "wm_burner",
      verified: true,
    },
  },
]);

const SIZE = numbered("size", "size_mismatch", false, [
  {
    left: rec(W, "wm_oat_175", "Earth's Own Original Oat Milk 1.75L", {
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    }),
    right: rec(N, "nf_oat_946", "Earth's Own Original Oat Milk 946ml", {
      brand: "Earth's Own",
      sizeValue: 946,
      sizeUnit: "ml",
      category: "beverage",
    }),
  },
  {
    left: rec(W, "wm_butter_454", "Gay Lea Unsalted Butter 454g", {
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
    }),
    right: rec(N, "nf_butter_1kg", "Gay Lea Unsalted Butter 1kg", {
      brand: "Gay Lea",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "dairy",
    }),
  },
  {
    left: rec(W, "wm_eggs_12", "Great Value Large Eggs 12 Pack", {
      brand: "Great Value",
      sizeValue: 12,
      sizeUnit: "ct",
      category: "eggs",
    }),
    right: rec(N, "nf_eggs_18", "Great Value Large Eggs 18 Pack", {
      brand: "Great Value",
      sizeValue: 18,
      sizeUnit: "ct",
      category: "eggs",
    }),
  },
  {
    left: rec(W, "wm_sugar_2", "No Name Granulated Sugar 2kg", {
      brand: "No Name",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "baking",
    }),
    right: rec(N, "nf_sugar_4", "No Name Granulated Sugar 4kg", {
      brand: "No Name",
      sizeValue: 4,
      sizeUnit: "kg",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_flour_25", "No Name All-Purpose Flour 2.5kg", {
      brand: "No Name",
      sizeValue: 2.5,
      sizeUnit: "kg",
      category: "baking",
    }),
    right: rec(S, "sob_flour_10", "No Name All-Purpose Flour 10kg", {
      brand: "No Name",
      sizeValue: 10,
      sizeUnit: "kg",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_oil_3", "Canola Oil 3L", {
      brand: "No Name",
      sizeValue: 3,
      sizeUnit: "l",
      category: "oil",
    }),
    right: rec(N, "nf_oil_1", "Canola Oil 1L", {
      brand: "No Name",
      sizeValue: 1,
      sizeUnit: "l",
      category: "oil",
    }),
  },
  {
    left: rec(W, "wm_coffee_816", "Folgers Classic Medium Roast Ground Coffee 816g", {
      brand: "Folgers",
      sizeValue: 816,
      sizeUnit: "g",
      category: "coffee",
    }),
    right: rec(N, "nf_coffee_1210", "Folgers Classic Roast Ground Coffee 1.21 kg 2 PACK", {
      brand: "Folgers",
      sizeValue: 1.21,
      sizeUnit: "kg",
      category: "coffee",
    }),
  },
  {
    left: rec(W, "wm_milk_2", "Neilson Homogenized Milk 2L", {
      brand: "Neilson",
      sizeValue: 2,
      sizeUnit: "l",
      category: "dairy",
    }),
    right: rec(N, "nf_milk_4", "Neilson Homogenized Milk 4L", {
      brand: "Neilson",
      sizeValue: 4,
      sizeUnit: "l",
      category: "dairy",
    }),
  },
  {
    left: rec(W, "wm_pb_1", "Kraft Smooth Peanut Butter 1kg", {
      brand: "Kraft",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
    }),
    right: rec(S, "sob_pb_500", "Kraft Smooth Peanut Butter 500g", {
      brand: "Kraft",
      sizeValue: 500,
      sizeUnit: "g",
      category: "pantry",
    }),
  },
  {
    left: rec(W, "wm_ketchup_1", "Heinz Tomato Ketchup 1L", {
      brand: "Heinz",
      sizeValue: 1,
      sizeUnit: "l",
      category: "condiment",
    }),
    right: rec(N, "nf_ketchup_375", "Heinz Tomato Ketchup 375ml", {
      brand: "Heinz",
      sizeValue: 375,
      sizeUnit: "ml",
      category: "condiment",
    }),
  },
  {
    left: rec(W, "wm_ziploc_150", "Ziploc Sandwich Bags 150 ct", {
      brand: "Ziploc",
      sizeValue: 150,
      sizeUnit: "ct",
      category: "household",
    }),
    right: rec(N, "nf_ziploc_50", "Ziploc Sandwich Bags 50 ct", {
      brand: "Ziploc",
      sizeValue: 50,
      sizeUnit: "ct",
      category: "household",
    }),
  },
  {
    left: rec(W, "wm_mayo_890", "Hellmann's Real Mayonnaise 890ml", {
      brand: "Hellmann's",
      sizeValue: 890,
      sizeUnit: "ml",
      category: "condiment",
    }),
    right: rec(N, "nf_mayo_395", "Hellmann's Real Mayonnaise 395ml", {
      brand: "Hellmann's",
      sizeValue: 395,
      sizeUnit: "ml",
      category: "condiment",
    }),
  },
  {
    left: rec(W, "wm_philly_250", "Philadelphia Cream Cheese 250g", {
      brand: "Philadelphia",
      sizeValue: 250,
      sizeUnit: "g",
      category: "dairy",
    }),
    right: rec(S, "sob_philly_750", "Philadelphia Cream Cheese 750g", {
      brand: "Philadelphia",
      sizeValue: 750,
      sizeUnit: "g",
      category: "dairy",
    }),
  },
  {
    left: rec(W, "wm_salt_1", "Windsor Table Salt 1kg", {
      brand: "Windsor",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "pantry",
    }),
    right: rec(N, "nf_salt_2", "Windsor Table Salt 2kg", {
      brand: "Windsor",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "pantry",
    }),
  },
  {
    left: rec(W, "wm_pasta_900", "Catelli Elbows 900g", {
      brand: "Catelli",
      sizeValue: 900,
      sizeUnit: "g",
      category: "pasta",
    }),
    right: rec(N, "nf_pasta_2kg", "Catelli Elbows 2kg", {
      brand: "Catelli",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "pasta",
    }),
  },
  {
    left: rec(W, "wm_grape_10oz", "Your Fresh Market Grape Tomatoes 10 oz", {
      brand: "Your Fresh Market",
      sizeValue: 10,
      sizeUnit: "oz",
      category: "produce",
    }),
    right: rec(N, "nf_grape_907", "No Name Grape Tomatoes 907g", {
      brand: "No Name",
      sizeValue: 907,
      sizeUnit: "g",
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_blue_1", "Great Value Blueberries 1 lb", {
      brand: "Great Value",
      sizeValue: 1,
      sizeUnit: "lb",
      category: "produce",
    }),
    right: rec(N, "nf_blue_2", "Great Value Blueberries 2 lb", {
      brand: "Great Value",
      sizeValue: 2,
      sizeUnit: "lb",
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_straw_1", "Strawberries 1 lb", {
      sizeValue: 1,
      sizeUnit: "lb",
      category: "produce",
    }),
    right: rec(N, "nf_straw_2", "Strawberries 2LB", {
      sizeValue: 2,
      sizeUnit: "lb",
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_eggwhite_500", "Simply Egg Whites 500g", {
      brand: "Burnbrae Farms",
      sizeValue: 500,
      sizeUnit: "g",
      category: "eggs",
    }),
    right: rec(N, "nf_eggwhite_1kg", "Simply Egg Whites 1kg", {
      brand: "Burnbrae Farms",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "eggs",
    }),
  },
  {
    left: rec(W, "wm_oj_175", "Tropicana Orange Juice 1.75L", {
      brand: "Tropicana",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    }),
    right: rec(S, "sob_oj_355", "Tropicana Orange Juice 355ml", {
      brand: "Tropicana",
      sizeValue: 355,
      sizeUnit: "ml",
      category: "beverage",
    }),
  },
]);

const SUBST = numbered("subst", "substitute", false, [
  {
    left: rec(W, "wm_oat_sub", "Earth's Own Original Oat Milk 1.75L", {
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    }),
    right: rec(N, "nf_almond_sub", "Earth's Own Original Almond Milk 1.75L", {
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    }),
  },
  {
    left: rec(W, "wm_grape_sub", "Grape Tomatoes 283g", {
      sizeValue: 283,
      sizeUnit: "g",
      category: "produce",
    }),
    right: rec(N, "nf_cherry_sub", "Cherry Tomatoes 283g", {
      sizeValue: 283,
      sizeUnit: "g",
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_unsalted", "Gay Lea Unsalted Butter 454g", {
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
    }),
    right: rec(N, "nf_salted", "Gay Lea Salted Butter 454g", {
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
    }),
  },
  {
    left: rec(W, "wm_classic_c", "Folgers Classic Medium Roast Ground Coffee 816g", {
      brand: "Folgers",
      sizeValue: 816,
      sizeUnit: "g",
      category: "coffee",
    }),
    right: rec(N, "nf_decaf_c", "Folgers Classic Decaf Medium Roast Ground Coffee 544g", {
      brand: "Folgers",
      sizeValue: 544,
      sizeUnit: "g",
      category: "coffee",
    }),
  },
  {
    left: rec(W, "wm_white_sug", "No Name White Granulated Sugar 2kg", {
      brand: "No Name",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "baking",
    }),
    right: rec(N, "nf_brown_sug", "No Name Brown Sugar 2kg", {
      brand: "No Name",
      sizeValue: 2,
      sizeUnit: "kg",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_canola_sub", "No Name Canola Oil 3L", {
      brand: "No Name",
      sizeValue: 3,
      sizeUnit: "l",
      category: "oil",
    }),
    right: rec(S, "sob_olive_sub", "No Name Olive Oil 3L", {
      brand: "No Name",
      sizeValue: 3,
      sizeUnit: "l",
      category: "oil",
    }),
  },
  {
    left: rec(W, "wm_homo_sub", "Neilson Homogenized Milk 2L", {
      brand: "Neilson",
      sizeValue: 2,
      sizeUnit: "l",
      category: "dairy",
    }),
    right: rec(N, "nf_2pct_sub", "Neilson 2% Milk 2L", {
      brand: "Neilson",
      sizeValue: 2,
      sizeUnit: "l",
      category: "dairy",
    }),
  },
  {
    left: rec(W, "wm_large_egg", "Large Size Eggs 12 Pack", {
      sizeValue: 12,
      sizeUnit: "ct",
      category: "eggs",
    }),
    right: rec(N, "nf_med_egg", "Eggs, Medium 12 Pack", {
      sizeValue: 12,
      sizeUnit: "ct",
      category: "eggs",
    }),
  },
  {
    left: rec(W, "wm_wheat_bran", "Rogers Wheat Bran 625g", {
      brand: "Rogers",
      sizeValue: 625,
      sizeUnit: "g",
      category: "baking",
    }),
    right: rec(N, "nf_oat_bran", "Rogers Oat Bran 625g", {
      brand: "Rogers",
      sizeValue: 625,
      sizeUnit: "g",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_breast", "Boneless Skinless Chicken Breast", {
      category: "meat",
    }),
    right: rec(N, "nf_thigh", "Boneless Skinless Chicken Thigh", {
      category: "meat",
    }),
  },
  {
    left: rec(W, "wm_fresh_straw", "Fresh Strawberries 1 lb", {
      sizeValue: 1,
      sizeUnit: "lb",
      category: "produce",
    }),
    right: rec(N, "nf_froz_straw", "Frozen Sliced Strawberries 1 lb", {
      sizeValue: 1,
      sizeUnit: "lb",
      category: "frozen",
    }),
  },
  {
    left: rec(W, "wm_eng_cuke", "English Cucumber", {
      category: "produce",
    }),
    right: rec(N, "nf_field_cuke", "Field Cucumber", {
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_red_pep", "Red Bell Pepper", {
      category: "produce",
    }),
    right: rec(N, "nf_green_pep", "Green Bell Pepper", {
      category: "produce",
    }),
  },
  {
    left: rec(W, "wm_van_pud", "Jell-O Vanilla Instant Pudding Mix 147g", {
      brand: "Jell-O",
      sizeValue: 147,
      sizeUnit: "g",
      category: "baking",
    }),
    right: rec(N, "nf_choc_pud", "Jell-O Chocolate Instant Pudding Mix 147g", {
      brand: "Jell-O",
      sizeValue: 147,
      sizeUnit: "g",
      category: "baking",
    }),
  },
  {
    left: rec(W, "wm_grape_vs_beef", "Grape Tomato 283g", {
      sizeValue: 283,
      sizeUnit: "g",
      category: "produce",
    }),
    right: rec(N, "nf_beefsteak", "Tomato, Beefsteak, Sold in singles", {
      category: "produce",
    }),
  },
]);

const DIFF = numbered("diff", "different", false, [
  {
    left: rec(W, "wm_eggs_d", "Great Value Large 12 Eggs", { category: "eggs" }),
    right: rec(N, "nf_lemons_d", "Lemons, 2 lb Bag", { category: "produce" }),
  },
  {
    left: rec(W, "wm_butter_d", "Gay Lea Unsalted Butter 454g", {
      brand: "Gay Lea",
      category: "dairy",
    }),
    right: rec(N, "nf_oil_d", "100% Pure Canola Oil 3L", { category: "oil" }),
  },
  {
    left: rec(W, "wm_flour_d", "All-Purpose Flour 2.5kg", { category: "baking" }),
    right: rec(S, "sob_sugar_d", "Granulated Sugar 2kg", { category: "baking" }),
  },
  {
    left: rec(W, "wm_coffee_d", "Folgers Classic Ground Coffee 816g", {
      brand: "Folgers",
      category: "coffee",
    }),
    right: rec(N, "nf_oat_d", "Earth's Own Oat Milk 1.75L", {
      brand: "Earth's Own",
      category: "beverage",
    }),
  },
  {
    left: rec(W, "wm_ziploc_d", "Ziploc Sandwich Bags", { brand: "Ziploc" }),
    right: rec(N, "nf_foil_d", "Reynolds Aluminum Foil", { brand: "Reynolds" }),
  },
  {
    left: rec(W, "wm_pine_d", "Pineapple", { category: "produce" }),
    right: rec(N, "nf_banana_d", "Bananas, Bunch", { category: "produce" }),
  },
  {
    left: rec(W, "wm_eggplant_d", "Eggplant, Sold in singles", { category: "produce" }),
    right: rec(N, "nf_tomato_d", "Tomato, Beefsteak", { category: "produce" }),
  },
  {
    left: rec(W, "wm_chicken_d", "Chicken Breast", { category: "meat" }),
    right: rec(N, "nf_butter_d2", "Gay Lea Butter", { category: "dairy" }),
  },
  {
    left: rec(W, "wm_seeds_d", "HJADGG Cherry Pink Grape Tomato Seeds 200pcs", {
      category: "garden",
    }),
    right: rec(N, "nf_grape_d", "Grape Tomato", { category: "produce" }),
  },
  {
    left: rec(W, "wm_pepper_d", "SUNSET Red Bell Pepper", { category: "produce" }),
    right: rec(N, "nf_sweet_d", "Caribbean Sweet Potatoes", { category: "produce" }),
  },
  {
    left: rec(W, "wm_garlic_d", "Colossal Fresh Garlic", { category: "produce" }),
    right: rec(N, "nf_onion_d", "Yellow Onions 3lb", { category: "produce" }),
  },
  {
    left: rec(W, "wm_kiwi_d", "Fresh Kiwi Fruit", { category: "produce" }),
    right: rec(S, "sob_lime_d", "Limes 1lb", { category: "produce" }),
  },
  {
    left: rec(W, "wm_acai_d", "Acai Puree Packets", { category: "frozen" }),
    right: rec(N, "nf_ice_d", "Ice Cubes 2kg", { category: "frozen" }),
  },
  {
    left: rec(W, "wm_spinach_d", "Chopped Spinach Frozen", { category: "frozen" }),
    right: rec(N, "nf_pasta_d", "Catelli Elbows Pasta", { category: "pasta" }),
  },
  {
    left: rec(W, "wm_oj_d", "Orange Juice Pulp Free", { category: "beverage" }),
    right: rec(N, "nf_realemon_d", "ReaLemon Lemon Juice", { category: "beverage" }),
  },
  {
    left: rec(W, "wm_pear_d", "Pear, Bosc", { category: "produce" }),
    right: rec(N, "nf_apple_d", "Gala Apples", { category: "produce" }),
  },
  {
    left: rec(W, "wm_salt_d", "Windsor Table Salt", { brand: "Windsor" }),
    right: rec(N, "nf_pepper_spice_d", "Black Pepper Ground", { category: "spice" }),
  },
  {
    left: rec(W, "wm_heinz_d", "Heinz Tomato Ketchup", { brand: "Heinz" }),
    right: rec(S, "sob_mustard_d", "French's Yellow Mustard", { brand: "French's" }),
  },
  {
    left: rec(W, "wm_philly_d", "Philadelphia Cream Cheese", { brand: "Philadelphia" }),
    right: rec(N, "nf_yogurt_d", "Astro Original Yogurt", { brand: "Astro" }),
  },
  {
    left: rec(W, "wm_burner_d", "Double Electric Burner", { category: "household" }),
    right: rec(N, "nf_eggs_d2", "Large Size Eggs 12 Pack", { category: "eggs" }),
  },
]);

export function buildBenchmarkPairs(): LabeledPair[] {
  const all = [...EXACT, ...ALIAS, ...SIZE, ...SUBST, ...DIFF];
  if (all.length !== 100) {
    throw new Error(`benchmark gold set must be 100 pairs, got ${all.length}`);
  }
  return all;
}

export function pairCounts(pairs: LabeledPair[]): Record<PairKind, number> {
  const out: Record<PairKind, number> = {
    exact: 0,
    alias: 0,
    size_mismatch: 0,
    substitute: 0,
    different: 0,
  };
  for (const p of pairs) out[p.kind] += 1;
  return out;
}

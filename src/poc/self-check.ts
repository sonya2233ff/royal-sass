import { buildFixtureOffers } from "@/connectors/fixtures";
import { resolveWalmartSource } from "@/connectors/walmart-source";
import { applyRemovedStapleIds, resolveMatchMode } from "@/lib/staples";
import { compareBaskets, type BasketLineInput } from "@/domain/basket";
import { calculateProcurementCost } from "@/domain/procurement-cost";
import {
  extractRetailerImage,
  preferredStapleImage,
} from "@/lib/product-image";
import { readFileSync } from "node:fs";
import path from "node:path";

const stores = [
  { key: "walmart_5831", retailer: "walmart_ca", id: "5831" },
  { key: "nofrills_3660", retailer: "no_frills", id: "3660" },
  { key: "sobeys_clark_hilda", retailer: "sobeys", id: "659" },
] as const;

const catalogs = Object.fromEntries(
  stores.map((s) => [s.key, buildFixtureOffers(s.key, s.retailer, s.id)]),
) as Record<string, ReturnType<typeof buildFixtureOffers>>;

const itemIds = Object.keys(catalogs.walmart_5831);
const lines: BasketLineInput[] = itemIds.map((itemId) => ({
  itemId,
  label: catalogs.walmart_5831[itemId].name,
  quantity: 1,
  offersByStore: {
    walmart_5831: catalogs.walmart_5831[itemId],
    nofrills_3660: catalogs.nofrills_3660[itemId],
    sobeys_clark_hilda: catalogs.sobeys_clark_hilda[itemId],
  },
}));

const result = compareBaskets(
  lines,
  stores.map((s) => s.key),
);

if (!result.bestOneStore) throw new Error("expected best one-store");
if (!result.mixed.complete) throw new Error("expected complete mixed basket");
if (result.savingsVsBestOneStore == null) {
  throw new Error("expected savings number");
}

const stub = calculateProcurementCost(100, 2, {
  employeeHourlyWage: 20,
  travelTimeHours: 1,
  vehicleCost: 5,
  additionalStopCost: 3,
});
if (stub.realCost !== 128) {
  throw new Error(`unexpected future cost formula: ${stub.realCost}`);
}

console.log("basket self-check OK");
console.log(
  `best one-store: ${result.bestOneStore.storeKey} $${result.bestOneStore.productTotal}`,
);
console.log(
  `mixed: $${result.mixed.productTotal} (savings $${result.savingsVsBestOneStore.toFixed(2)})`,
);

{
  const cases: Array<[Record<string, string | undefined>, string]> = [
    [{ WALMART_SOURCE: "rapid" }, "missing_key"],
    [{ WALMART_SOURCE: "rapid", OPENWEBNINJA_API_KEY: "" }, "missing_key"],
    [{ WALMART_SOURCE: "rapid", OPENWEBNINJA_API_KEY: "  " }, "missing_key"],
    [{ WALMART_SOURCE: "rapid", RAPIDAPI_KEY: "k" }, "rapid"],
    [{ WALMART_SOURCE: "browser", RAPIDAPI_KEY: "k" }, "browser"],
    [{}, "browser"],
    [{ OPENWEBNINJA_API_KEY: "k" }, "rapid"],
  ];
  for (const [env, expected] of cases) {
    const got = resolveWalmartSource(env);
    if (got !== expected) {
      throw new Error(
        `walmart source ${JSON.stringify(env)} => ${got}, expected ${expected}`,
      );
    }
  }
  console.log("walmart-source self-check OK");
}

{
  const kept = applyRemovedStapleIds(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    ["b", "missing"],
  );
  if (kept.map((i) => i.id).join(",") !== "a,c") {
    throw new Error(`removed filter => ${kept.map((i) => i.id)}`);
  }
  console.log("removed-staples self-check OK");
}

{
  const cafe = JSON.parse(
    readFileSync(path.join(process.cwd(), "config/cafe-staples.json"), "utf8"),
  ) as {
    items: Array<{
      id: string;
      matchMode?: "preferred" | "cheapest";
      category?: string;
      preferredProductId?: string;
    }>;
  };
  const whites = cafe.items.find((i) => i.id === "simply_egg_whites");
  if (!whites) throw new Error("simply_egg_whites missing from cafe-staples");
  if (resolveMatchMode(whites) !== "preferred") {
    throw new Error("simply_egg_whites must be category A (preferred)");
  }
  if (whites.preferredProductId !== "6000196635381") {
    throw new Error(`egg whites SKU ${whites.preferredProductId}`);
  }

  const rapidImg =
    "https://i5.walmartimages.ca/asr/egg-whites.jpeg";
  const extracted = extractRetailerImage({
    image: rapidImg,
    images: [rapidImg],
  });
  if (extracted !== rapidImg) {
    throw new Error(`extractRetailerImage ${extracted}`);
  }
  const catA = preferredStapleImage({
    matchMode: "preferred",
    stapleImage: "/products/simply_egg_whites.png",
    wmOffer: { image: rapidImg },
  });
  if (catA !== rapidImg) {
    throw new Error(`category A should use Rapid photo, got ${catA}`);
  }
  const catB = preferredStapleImage({
    matchMode: "cheapest",
    stapleImage: "/products/tomatoes_grape.jpg",
    wmOffer: { image: rapidImg },
  });
  if (catB !== "/products/tomatoes_grape.jpg") {
    throw new Error(`category B should keep static photo, got ${catB}`);
  }
  console.log("category-A Rapid photo self-check OK");
}

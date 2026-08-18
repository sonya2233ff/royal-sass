import { buildFixtureOffers } from "@/connectors/fixtures";
import { resolveWalmartSource } from "@/connectors/walmart-source";
import {
  applyRemovedStapleIds,
  evaluateOfferStatus,
  resolveMatchMode,
} from "@/lib/staples";
import { compareBaskets, type BasketLineInput } from "@/domain/basket";
import { calculateProcurementCost } from "@/domain/procurement-cost";
import {
  extractRetailerImage,
  preferredStapleImage,
  retailerSideImage,
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

  const nfImg =
    "https://digital.loblaws.ca/PCX/20820355001_EA/en/1/front_1200.png";
  const pcxThumb =
    "https://digital.loblaws.ca/PCX/20820355001_EA/en/1/front_120.png";
  const fromPcx = extractRetailerImage({
    productImage: [{ thumbnailUrl: pcxThumb, imageUrl: nfImg }],
  });
  if (fromPcx !== nfImg) {
    throw new Error(`PCX productImage should prefer imageUrl, got ${fromPcx}`);
  }
  if (
    retailerSideImage({
      retailer: "walmart_ca",
      offer: { image: rapidImg },
      stapleImage: "/products/simply_egg_whites.png",
    }) !== rapidImg
  ) {
    throw new Error("WM column must use the Walmart offer photo");
  }
  if (
    retailerSideImage({
      retailer: "no_frills",
      offer: { image: nfImg },
      stapleImage: rapidImg,
    }) !== nfImg
  ) {
    throw new Error("NF column must use the No Frills offer photo");
  }
  if (
    retailerSideImage({
      retailer: "no_frills",
      offer: {},
      stapleImage: rapidImg,
    }) != null
  ) {
    throw new Error("NF must not reuse the Walmart / staple photo");
  }
  if (
    retailerSideImage({
      retailer: "no_frills",
      offer: { image: rapidImg },
      stapleImage: rapidImg,
    }) != null
  ) {
    throw new Error("NF must not display a Walmart CDN photo");
  }
  if (
    retailerSideImage({
      retailer: "walmart_ca",
      offer: {},
      stapleImage: "/products/simply_egg_whites.png",
    }) != null
  ) {
    throw new Error("WM Results must not use shared /products/ art");
  }
  const offerImgs = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "config/retailer-offer-images.json"),
      "utf8",
    ),
  ) as {
    walmart_ca: Record<string, string>;
    no_frills: Record<string, string>;
  };
  const wmEgg = offerImgs.walmart_ca["6000196635381"];
  const nfEgg = offerImgs.no_frills["20820355001_EA"];
  if (!wmEgg || !/walmartimages\./i.test(wmEgg)) {
    throw new Error("egg whites WM photo missing from retailer-offer-images");
  }
  if (!nfEgg || !/loblaws\.ca/i.test(nfEgg)) {
    throw new Error("egg whites NF photo missing from retailer-offer-images");
  }
  if (wmEgg === nfEgg) {
    throw new Error("egg whites WM and NF must not share one photo URL");
  }
  const fromSku = retailerSideImage({
    retailer: "no_frills",
    offer: { productId: "20820355001_EA" },
    stapleImage: rapidImg,
  });
  if (fromSku !== nfEgg) {
    throw new Error(`NF SKU lookup should use PCX photo, got ${fromSku}`);
  }
  console.log("per-store Results photo self-check OK");
}

{
  const oos = evaluateOfferStatus(
    {
      id: "tomatoes_grape",
      label: "Grape Tomatoes (pack)",
      queries: ["grape tomatoes"],
    },
    {
      productId: "6000194960083",
      name: "Your Fresh Market Tomato, Grape, 10 oz",
      price: 2.97,
      availability: "out_of_stock",
    },
  );
  if (oos.status !== "unavailable") {
    throw new Error(`OOS grape tomatoes must be unavailable, got ${oos.status}`);
  }
  const shelf = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "data/catalog/shelf-overrides.json"),
      "utf8",
    ),
  ) as {
    overrides?: Record<
      string,
      Record<string, { availability?: string }>
    >;
  };
  if (
    shelf.overrides?.walmart_5831?.tomatoes_grape?.availability !==
    "out_of_stock"
  ) {
    throw new Error("in-store visit override missing for WM grape tomatoes");
  }
  console.log("shelf OOS self-check OK");
}

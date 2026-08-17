/**
 * Seed NF → master mapping, match Walmart from cached catalogs, check price confidence.
 *   npx tsx src/poc/seed-and-match.ts
 *
 * Does not call Walmart Rapid or No Frills PCX.
 */
import {
  matchProducts,
} from "@/domain/entity-match";
import {
  NOFRILLS_RETAILER,
  WALMART_RETAILER,
  isNoFrillsRetailerSku,
  offerFailsStapleFilters,
} from "@/domain/catalog-normalize";
import {
  assignPriceConfidence,
  deliveryValidation,
} from "@/domain/price-confidence";
import { runSeedAndMatch } from "@/lib/seed-retailer-mappings";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const { store, summary } = await runSeedAndMatch();

  assert(summary.products >= 15, `expected ≥15 mapped staples, got ${summary.products}`);
  assert(summary.seeded >= 15, `expected ≥15 NF seeds, got ${summary.seeded}`);
  assert(summary.masterIdsAreStaples, `NF SKU used as master: ${summary.nfSkuUsedAsMaster}`);

  for (const [masterId, row] of Object.entries(store.products)) {
    assert(!isNoFrillsRetailerSku(masterId), `master must not look like PCX sku: ${masterId}`);
    const nf = row.retailers[NOFRILLS_RETAILER];
    if (nf) {
      assert(nf.retailerProductId !== masterId, `NF id leaked into master ${masterId}`);
      assert(nf.matchMethod === "seed_catalog", `${masterId} NF method`);
    }
  }

  const grape = store.products.tomatoes_grape;
  assert(grape, "tomatoes_grape mapped");
  const grapeWm = grape.retailers[WALMART_RETAILER];
  assert(grapeWm?.retailerProductId === "6000194960084", "locked YFM grape sku");
  assert(!/seed/i.test(grapeWm?.name ?? ""), "confirmed grape mapping must not be tomato seeds");
  const grapeWmPrice = grape.prices.find((p) => p.retailer === WALMART_RETAILER);
  assert(
    grapeWmPrice?.price === 2.97,
    `grape WM YFM price via Rapid alias, got ${grapeWmPrice?.price}`,
  );

  const butter = store.products.butter_454g;
  assert(butter?.retailers[NOFRILLS_RETAILER]?.retailerProductId === "20559466_EA", "NF butter sku");

  const ziplocWmPrice = store.products.ziploc_sandwich?.prices.find(
    (p) => p.retailer === WALMART_RETAILER,
  );
  assert(
    ziplocWmPrice?.price === 9.97,
    `ziploc WM price via Rapid alias, got ${ziplocWmPrice?.price}`,
  );

  const eggWhites = matchProducts(
    {
      retailer: "nofrills",
      retailerProductId: "20820130001_EA",
      name: "Burnbrae Farms Naturegg Free Run Egg Whites",
      brand: "Burnbrae Farms",
      sizeValue: 0.5,
      sizeUnit: "kg",
      category: "eggs",
    },
    {
      retailer: "walmart_ca",
      retailerProductId: "6000196635381",
      name: "Burnbrae Farms Naturegg Simply Egg Whites 1KG",
      brand: "Burnbrae Farms",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "eggs",
    },
  );
  assert(eggWhites.decision !== "auto_linked", "500g vs 1kg egg whites must not auto-link");

  assert(
    offerFailsStapleFilters(
      { id: "tomatoes_grape", mustNotInclude: ["seed", "seeds"] },
      "HJADGG Cherry Pink Grape Tomato Seeds, 200pcs",
    ),
    "seed filter",
  );

  const eggNf = store.products.simply_egg_whites?.prices.find((p) => p.retailer === NOFRILLS_RETAILER);
  assert(eggNf?.priceConfidence !== "MULTI_SOURCE_CONFIRMED", "500g vs 1kg egg whites are not the same pack price");

  const live = assignPriceConfidence({
    hasLiveOffer: true,
    offerConfidence: "exact",
    ageHours: 1,
    hasReceiptPrice: false,
    livePrice: 7.96,
  });
  assert(live === "LIVE_VERIFIED", `live ${live}`);

  const multi = assignPriceConfidence({
    hasLiveOffer: true,
    offerConfidence: "exact",
    ageHours: 1,
    hasReceiptPrice: true,
    receiptPrice: 9.47,
    livePrice: 9.47,
  });
  assert(multi === "MULTI_SOURCE_CONFIRMED", `multi ${multi}`);

  const uber = deliveryValidation({
    shelfPrice: 4.99,
    deliveryPrice: 5.79,
    source: "uber",
  });
  assert(uber.usableAsShelf === false, "uber not shelf");
  assert(uber.rankingHint === "delivery_higher", "uber spread");

  const confs = new Set(
    Object.values(store.products).flatMap((p) => p.prices.map((x) => x.priceConfidence)),
  );
  for (const c of confs) {
    assert(
      ["LIVE_VERIFIED", "RECEIPT_VERIFIED", "MULTI_SOURCE_CONFIRMED", "ESTIMATED", "UNKNOWN"].includes(c),
      `unexpected confidence ${c}`,
    );
  }

  console.log("seed-and-match", summary);
  console.log("seed-and-match ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

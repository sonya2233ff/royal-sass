/**
 * Thin Sobeys adapter: flyer item → ProductOffer → mapping → ESTIMATED price.
 *   npx tsx src/poc/sobeys-adapter-self-check.ts
 */
import {
  flyerItemToOffer,
  scoreFlyerItem,
  SOBEYS_CLARK_HILDA_STORE_CODE,
} from "@/connectors/sobeys";
import { SOBEYS_RETAILER } from "@/domain/catalog-normalize";
import { SOBEYS_FLYER_SOURCE } from "@/lib/sobeys-catalog";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const fixture = {
  id: 991122,
  name: "Omega-3 Eggs 12's",
  brand: "Gray Ridge",
  current_price: 6.99,
  description: "12 eggs",
  sku: null,
  clean_image_url: "https://example.test/eggs.jpg",
  sale_story: "SAVE $1",
  valid_from: "2026-08-13T04:00:00+00:00",
  valid_to: "2026-08-20T03:59:59+00:00",
};

const offer = flyerItemToOffer(fixture, {
  storeId: SOBEYS_CLARK_HILDA_STORE_CODE,
  flyerId: "8078854",
  validFrom: fixture.valid_from,
  validTo: fixture.valid_to,
  postalCode: "L4J6W7",
});

assert(offer, "fixture maps to ProductOffer");
assert(offer.retailer === "sobeys", "retailer sobeys");
assert(offer.storeId === "659", "store 659");
assert(offer.productId === "991122", "flyer item id is productId");
assert(offer.price === 6.99, "flyer current_price");
assert(offer.confidence === "estimated", "never exact / live shelf");
assert(offer.availability === "unknown", "flyer has no stock");
assert(offer.packageSize === "12 eggs", "description → packageSize");
assert(offer.image === "https://example.test/eggs.jpg", "flyer photo");
assert(offer.onSale === true, "sale_story → onSale");
const raw = offer.raw as { note?: string; flyerId?: string };
assert(raw.flyerId === "8078854", "flyer id in raw");
assert(/not Clark & Hilda shelf/i.test(raw.note ?? ""), "raw note is flyer not shelf");

assert(scoreFlyerItem(fixture, "omega-3 eggs") >= 0.5, "name tokens score");
assert(scoreFlyerItem(fixture, "065651002470") === 0, "UPC-only query scores 0");

const mapping = {
  masterId: "grayridge_eggs",
  retailers: {
    [SOBEYS_RETAILER]: {
      retailer: SOBEYS_RETAILER,
      storeId: "659",
      retailerProductId: offer.productId,
      matchMethod: "seed_catalog",
      kind: "staple_winner",
      verified: false,
    },
  },
  prices: [
    {
      retailer: SOBEYS_RETAILER,
      storeId: "659",
      retailerProductId: offer.productId,
      price: offer.price,
      source: SOBEYS_FLYER_SOURCE,
      priceConfidence: "ESTIMATED" as const,
    },
  ],
};

assert(mapping.retailers.sobeys.kind === "staple_winner", "weekly flyer is not identity lock");
assert(mapping.prices[0].priceConfidence === "ESTIMATED", "observation ESTIMATED");
assert(mapping.prices[0].source === "sobeys_flyer_659", "source tag");

console.log("sobeys-adapter-self-check ok", {
  productId: offer.productId,
  name: offer.name,
  price: offer.price,
  confidence: offer.confidence,
  mappingKind: mapping.retailers.sobeys.kind,
  priceConfidence: mapping.prices[0].priceConfidence,
});

async function maybeLiveFlyer(): Promise<void> {
  if (process.env.SOBEYS_LIVE_FLYER !== "1") return;
  const { SobeysConnector, loadSobeysFlyer, resetSobeysFlyerCache } =
    await import("@/connectors/sobeys");
  resetSobeysFlyerCache();
  const flyer = await loadSobeysFlyer("L4J6W7");
  assert(flyer.items.length > 0, "live flyer has items");
  const sb = new SobeysConnector("L4J6W7");
  const eggs = await sb.searchProducts("eggs", "659");
  console.log("live flyer", {
    flyerId: flyer.flyerId,
    flyerName: flyer.flyerName,
    itemCount: flyer.items.length,
    eggHits: eggs.length,
    top: eggs[0]
      ? { name: eggs[0].name, price: eggs[0].price, id: eggs[0].productId }
      : null,
  });
}

void maybeLiveFlyer().catch((e) => {
  console.error(e);
  process.exit(1);
});

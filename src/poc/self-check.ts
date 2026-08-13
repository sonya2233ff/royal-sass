import { buildFixtureOffers } from "@/connectors/fixtures";
import { compareBaskets, type BasketLineInput } from "@/domain/basket";
import { calculateProcurementCost } from "@/domain/procurement-cost";

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

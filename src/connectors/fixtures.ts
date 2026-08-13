import type { ProductOffer } from "@/connectors/types";

/** Deterministic fixture offers for offline basket math — not live prices. */
export function buildFixtureOffers(
  storeKey: string,
  retailer: string,
  storeId: string,
): Record<string, ProductOffer> {
  const checkedAt = new Date().toISOString();

  const prices: Record<string, Record<string, number>> = {
    milk_2pct_4l: { walmart_ca: 6.47, no_frills: 6.44, sobeys: 6.99 },
    eggs: { walmart_ca: 4.88, no_frills: 4.49, sobeys: 5.29 },
    chicken_breast: { walmart_ca: 13.97, no_frills: 11.99, sobeys: 14.99 },
    canola_oil: { walmart_ca: 9.97, no_frills: 9.49, sobeys: 8.99 },
    bananas: { walmart_ca: 1.74, no_frills: 1.54, sobeys: 1.99 },
  };

  const names: Record<string, string> = {
    milk_2pct_4l: "2% Milk 4L",
    eggs: "Large Eggs 12pk",
    chicken_breast: "Chicken Breast Boneless per kg",
    canola_oil: "Canola Oil",
    bananas: "Bananas per kg",
  };

  const out: Record<string, ProductOffer> = {};
  for (const [itemId, byRetailer] of Object.entries(prices)) {
    const price = byRetailer[retailer];
    if (price == null) continue;
    out[itemId] = {
      retailer,
      storeId,
      productId: `fix-${itemId}-${storeId}`,
      name: names[itemId] ?? itemId,
      price,
      availability: "in_stock",
      confidence: "exact",
      checkedAt,
      sourceUrl: `fixture://${storeKey}/${itemId}`,
    };
  }
  void storeKey;
  return out;
}

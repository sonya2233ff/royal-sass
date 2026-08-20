/**
 * Catalog wasPrice / onSale is display-only. Checkout still uses offer.price.
 * No dedicated sales page — show the flag on the homepage list and cards.
 */

export type SaleStoreId = "walmart" | "nofrills" | "wholesaleclub" | "mvr";

export const SALE_STORE_SHORT: Record<SaleStoreId, string> = {
  walmart: "WM",
  nofrills: "NF",
  wholesaleclub: "WC",
  mvr: "MVR",
};

export type SaleOffer = {
  store: SaleStoreId;
  price: number;
  wasPrice?: number | null;
  onSale?: boolean;
};

export function isShelfSale(
  offer:
    | {
        price?: number | null;
        wasPrice?: number | null;
        onSale?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!offer || !(Number(offer.price) > 0)) return false;
  const price = Number(offer.price);
  if (offer.wasPrice != null && offer.wasPrice > price + 0.005) return true;
  return Boolean(offer.onSale);
}

export function saleWasPrice(
  offer:
    | {
        price?: number | null;
        wasPrice?: number | null;
      }
    | null
    | undefined,
): number | null {
  if (!offer || !(Number(offer.price) > 0)) return null;
  const price = Number(offer.price);
  if (offer.wasPrice != null && offer.wasPrice > price + 0.005) {
    return offer.wasPrice;
  }
  return null;
}

export function saleSaving(offer: SaleOffer): number | null {
  const was = saleWasPrice(offer);
  if (was == null) return null;
  return Math.round((was - offer.price) * 100) / 100;
}

export function cheapestStoreIds(offers: readonly SaleOffer[]): SaleStoreId[] {
  const priced = offers.filter((o) => o.price > 0);
  if (!priced.length) return [];
  const min = Math.min(...priced.map((o) => o.price));
  return priced.filter((o) => o.price <= min + 0.005).map((o) => o.store);
}

/** On sale and currently the cheapest (or tied) among stores that have a price. */
export function cheaperSaleOffers(offers: readonly SaleOffer[]): SaleOffer[] {
  const cheap = new Set(cheapestStoreIds(offers));
  return offers.filter((o) => cheap.has(o.store) && isShelfSale(o));
}

export function saleOffersFromPrices(input: {
  walmart?: { price?: number | null; wasPrice?: number | null; onSale?: boolean } | null;
  nofrills?: { price?: number | null; wasPrice?: number | null; onSale?: boolean } | null;
  wholesaleclub?: {
    price?: number | null;
    wasPrice?: number | null;
    onSale?: boolean;
  } | null;
  mvr?: { price?: number | null; wasPrice?: number | null; onSale?: boolean } | null;
}): SaleOffer[] {
  const out: SaleOffer[] = [];
  const add = (
    store: SaleStoreId,
    row?: { price?: number | null; wasPrice?: number | null; onSale?: boolean } | null,
  ) => {
    if (!row || !(Number(row.price) > 0)) return;
    out.push({
      store,
      price: Number(row.price),
      wasPrice: row.wasPrice,
      onSale: row.onSale,
    });
  };
  add("walmart", input.walmart);
  add("nofrills", input.nofrills);
  add("wholesaleclub", input.wholesaleclub);
  add("mvr", input.mvr);
  return out;
}

export function cheaperSaleHint(offers: readonly SaleOffer[]): string | null {
  const rows = cheaperSaleOffers(offers);
  if (!rows.length) return null;
  const stores = rows.map((o) => SALE_STORE_SHORT[o.store]).join("/");
  return `${stores} дешевше · знижка`;
}

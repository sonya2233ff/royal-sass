import type { ProductOffer } from "@/connectors/types";
import {
  type ProcurementCostBreakdown,
  type ProcurementCostInputs,
  calculateProcurementCost,
} from "./procurement-cost";
import { packMassKg, packsSimilar } from "@/domain/fair-compare";

export interface BasketLineInput {
  itemId: string;
  label: string;
  quantity: number;
  /** Offers keyed by store key (e.g. walmart_1115) */
  offersByStore: Record<string, ProductOffer | null>;
}

export interface StoreBasketLine {
  itemId: string;
  label: string;
  quantity: number;
  offer: ProductOffer;
  lineTotal: number;
}

export interface OneStoreBasketResult {
  storeKey: string;
  retailer: string;
  storeId: string;
  complete: boolean;
  missingItemIds: string[];
  lines: StoreBasketLine[];
  productTotal: number;
  procurement: ProcurementCostBreakdown;
}

export interface MixedBasketAssignment {
  itemId: string;
  label: string;
  quantity: number;
  storeKey: string;
  retailer: string;
  storeId: string;
  offer: ProductOffer;
  lineTotal: number;
}

export interface MixedBasketResult {
  assignments: MixedBasketAssignment[];
  missingItemIds: string[];
  complete: boolean;
  productTotal: number;
  byStore: Record<
    string,
    { retailer: string; storeId: string; items: string[]; subtotal: number }
  >;
  procurement: ProcurementCostBreakdown;
}

export interface ComparisonResult {
  oneStore: OneStoreBasketResult[];
  bestOneStore: OneStoreBasketResult | null;
  mixed: MixedBasketResult;
  savingsVsBestOneStore: number | null;
}

function effectivePrice(offer: ProductOffer): number {
  if (offer.promoPrice != null && offer.promoPrice < offer.price) {
    return offer.promoPrice;
  }
  return offer.price;
}

/** Rank offers: $/kg when pack sizes differ, else shelf. */
function rankOffer(offer: ProductOffer, peers: ProductOffer[]): number {
  const price = effectivePrice(offer);
  const ownKg = packMassKg(offer.name, offer.packageSize);
  const peerKg = peers
    .map((p) => packMassKg(p.name, p.packageSize))
    .filter((k): k is number => k != null);
  if (
    ownKg &&
    peerKg.length > 0 &&
    peerKg.some((k) => !packsSimilar(ownKg, k))
  ) {
    return price / ownKg;
  }
  return price;
}

export function compareBaskets(
  lines: BasketLineInput[],
  storeKeys: string[],
  costInputs: ProcurementCostInputs = {},
): ComparisonResult {
  const oneStore = storeKeys.map((storeKey) =>
    buildOneStoreBasket(lines, storeKey, costInputs),
  );

  const completeOneStore = oneStore.filter((b) => b.complete);
  const bestOneStore =
    completeOneStore.length === 0
      ? null
      : completeOneStore.reduce((best, cur) =>
          cur.procurement.realCost < best.procurement.realCost ? cur : best,
        );

  const mixed = buildMixedBasket(lines, storeKeys, costInputs);

  let savingsVsBestOneStore: number | null = null;
  if (bestOneStore && mixed.complete) {
    savingsVsBestOneStore =
      bestOneStore.procurement.realCost - mixed.procurement.realCost;
  }

  return { oneStore, bestOneStore, mixed, savingsVsBestOneStore };
}

function buildOneStoreBasket(
  lines: BasketLineInput[],
  storeKey: string,
  costInputs: ProcurementCostInputs,
): OneStoreBasketResult {
  const basketLines: StoreBasketLine[] = [];
  const missingItemIds: string[] = [];
  let retailer = "";
  let storeId = "";

  for (const line of lines) {
    const offer = line.offersByStore[storeKey] ?? null;
    if (!offer) {
      missingItemIds.push(line.itemId);
      continue;
    }
    retailer = offer.retailer;
    storeId = offer.storeId;
    const lineTotal = effectivePrice(offer) * line.quantity;
    basketLines.push({
      itemId: line.itemId,
      label: line.label,
      quantity: line.quantity,
      offer,
      lineTotal,
    });
  }

  const productTotal = round2(basketLines.reduce((s, l) => s + l.lineTotal, 0));
  const stopCount = basketLines.length > 0 ? 1 : 0;

  return {
    storeKey,
    retailer,
    storeId,
    complete: missingItemIds.length === 0 && basketLines.length > 0,
    missingItemIds,
    lines: basketLines,
    productTotal,
    procurement: calculateProcurementCost(productTotal, stopCount, costInputs),
  };
}

function buildMixedBasket(
  lines: BasketLineInput[],
  storeKeys: string[],
  costInputs: ProcurementCostInputs,
): MixedBasketResult {
  const assignments: MixedBasketAssignment[] = [];
  const missingItemIds: string[] = [];
  const byStore: MixedBasketResult["byStore"] = {};

  for (const line of lines) {
    const peers: ProductOffer[] = [];
    for (const storeKey of storeKeys) {
      const offer = line.offersByStore[storeKey] ?? null;
      if (!offer) continue;
      if (offer.availability === "out_of_stock") continue;
      peers.push(offer);
    }

    let best: { storeKey: string; offer: ProductOffer; rank: number } | null =
      null;

    for (const storeKey of storeKeys) {
      const offer = line.offersByStore[storeKey] ?? null;
      if (!offer) continue;
      if (offer.availability === "out_of_stock") continue;
      const rank = rankOffer(offer, peers);
      if (!best || rank < best.rank) {
        best = { storeKey, offer, rank };
      }
    }

    if (!best) {
      missingItemIds.push(line.itemId);
      continue;
    }

    const lineTotal = round2(effectivePrice(best.offer) * line.quantity);
    assignments.push({
      itemId: line.itemId,
      label: line.label,
      quantity: line.quantity,
      storeKey: best.storeKey,
      retailer: best.offer.retailer,
      storeId: best.offer.storeId,
      offer: best.offer,
      lineTotal,
    });

    if (!byStore[best.storeKey]) {
      byStore[best.storeKey] = {
        retailer: best.offer.retailer,
        storeId: best.offer.storeId,
        items: [],
        subtotal: 0,
      };
    }
    byStore[best.storeKey].items.push(line.label);
    byStore[best.storeKey].subtotal = round2(
      byStore[best.storeKey].subtotal + lineTotal,
    );
  }

  const productTotal = round2(assignments.reduce((s, a) => s + a.lineTotal, 0));
  const stopCount = Object.keys(byStore).length;

  return {
    assignments,
    missingItemIds,
    complete: missingItemIds.length === 0 && assignments.length > 0,
    productTotal,
    byStore,
    procurement: calculateProcurementCost(productTotal, stopCount, costInputs),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

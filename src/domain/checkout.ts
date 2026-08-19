/**
 * Checkout cost from sale mode. Normalized $/100g is display-only.
 * Basket totals always use checkoutCost (2 decimal line totals).
 */
import { inferSaleMode, type SaleMode } from "@/domain/sale-mode";
import {
  convertAmount,
  dimensionOf,
  fromBase,
  parseMassKg,
  parseVolumeMl,
  roundMoney,
  toBase,
  type AmountUnit,
  type BaseUnit,
} from "@/domain/purchase-units";
import type { RestaurantProduct } from "@/domain/restaurant-product";

export interface StoreOfferInput {
  price: number;
  name: string;
  packageSize?: string;
  parsedMassKg?: number;
  /** $/kg when the offer is truly loose / per-kg. Ignored for packs/cases. */
  pricePerKg?: number;
  stapleSoldByWeight?: boolean;
  checkedAt?: string;
}

export interface PurchaseOption {
  valid: boolean;
  reason?: string;
  saleMode: SaleMode;
  packs: number;
  packAmount: number | null;
  packUnit: AmountUnit | null;
  purchasedAmount: number;
  purchasedUnit: AmountUnit;
  leftoverAmount: number;
  leftoverUnit: AmountUnit;
  shelfPrice: number;
  checkoutCost: number | null;
  unitPrice: number | null;
  warning?: string;
}

export function saleModeOf(offer: StoreOfferInput): SaleMode {
  return inferSaleMode({
    name: offer.name,
    packageSize: offer.packageSize,
    stapleSoldByWeight: offer.stapleSoldByWeight,
  });
}

function packBaseInProductUnit(
  offer: StoreOfferInput,
  product: RestaurantProduct,
): { amount: number; unit: AmountUnit } | null {
  const text = `${offer.name} ${offer.packageSize ?? ""}`;
  const dim = dimensionOf(product.unit);
  if (dim === "mass") {
    const kg =
      parseMassKg(text) ??
      (offer.parsedMassKg != null && offer.parsedMassKg > 0
        ? offer.parsedMassKg
        : null);
    if (kg == null || !(kg > 0)) return null;
    const amount = convertAmount(kg, "kg", product.unit === "g" ? "g" : "kg");
    if (amount == null) return null;
    return { amount, unit: product.unit === "g" ? "g" : "kg" };
  }
  if (dim === "volume") {
    const ml = parseVolumeMl(text);
    if (ml == null || !(ml > 0)) return null;
    const unit: AmountUnit = product.unit === "ml" ? "ml" : "l";
    const amount = convertAmount(ml, "ml", unit);
    if (amount == null) return null;
    return { amount, unit };
  }
  return { amount: 1, unit: product.unit === "ea" ? "ea" : "pack" };
}

function pricePerProductUnitLoose(
  offer: StoreOfferInput,
  product: RestaurantProduct,
): number | null {
  if (dimensionOf(product.unit) !== "mass") return null;
  const perKg =
    offer.pricePerKg && offer.pricePerKg > 0
      ? offer.pricePerKg
      : /per\s*kg/i.test(`${offer.name} ${offer.packageSize ?? ""}`)
        ? offer.price
        : null;
  if (perKg == null || !(perKg > 0)) return null;
  if (product.unit === "g") return perKg / 1000;
  return perKg;
}

function option(
  partial: Omit<PurchaseOption, "leftoverUnit" | "purchasedUnit"> & {
    purchasedUnit: AmountUnit;
  },
): PurchaseOption {
  return {
    ...partial,
    leftoverUnit: partial.purchasedUnit,
    leftoverAmount: roundMoney(partial.leftoverAmount),
    purchasedAmount: roundMoney(partial.purchasedAmount),
    checkoutCost:
      partial.checkoutCost == null ? null : roundMoney(partial.checkoutCost),
    unitPrice:
      partial.unitPrice == null ? null : roundMoney(partial.unitPrice),
  };
}

export function checkoutLoose(
  requested: number,
  unit: AmountUnit,
  pricePerUnit: number,
): PurchaseOption {
  const cost = roundMoney(requested * pricePerUnit);
  return option({
    valid: requested > 0 && pricePerUnit > 0,
    saleMode: "loose_weight",
    packs: 1,
    packAmount: null,
    packUnit: null,
    purchasedAmount: requested,
    purchasedUnit: unit,
    leftoverAmount: 0,
    shelfPrice: pricePerUnit,
    checkoutCost: cost,
    unitPrice: pricePerUnit,
  });
}

export function checkoutFixedPacks(input: {
  requested: number;
  unit: AmountUnit;
  packAmount: number;
  packPrice: number;
  saleMode: SaleMode;
}): PurchaseOption {
  const packs = Math.max(1, Math.ceil(input.requested / input.packAmount - 1e-9));
  const purchased = packs * input.packAmount;
  const cost = roundMoney(packs * input.packPrice);
  const leftover = Math.max(0, purchased - input.requested);
  return option({
    valid: true,
    saleMode: input.saleMode,
    packs,
    packAmount: input.packAmount,
    packUnit: input.unit,
    purchasedAmount: purchased,
    purchasedUnit: input.unit,
    leftoverAmount: leftover,
    shelfPrice: input.packPrice,
    checkoutCost: cost,
    unitPrice: input.packAmount > 0 ? cost / purchased : null,
  });
}

export function exactNeedBounds(requested: number, tolerancePercent: number) {
  const t = tolerancePercent / 100;
  return {
    minimumAmount: requested * (1 - t),
    maximumAmount: requested * (1 + t),
  };
}

export function inExactNeedRange(
  purchased: number,
  requested: number,
  tolerancePercent: number,
): boolean {
  const { minimumAmount, maximumAmount } = exactNeedBounds(
    requested,
    tolerancePercent,
  );
  return purchased + 1e-6 >= minimumAmount && purchased - 1e-6 <= maximumAmount;
}

function iteratePackCounts(
  packAmount: number,
  minPurchased: number,
  maxPurchased: number,
): number[] {
  if (!(packAmount > 0)) return [];
  const start = Math.max(1, Math.ceil(minPurchased / packAmount - 1e-9));
  const end = Math.floor(maxPurchased / packAmount + 1e-9);
  const out: number[] = [];
  for (let n = start; n <= end && n <= 40; n++) out.push(n);
  return out;
}

export function evaluatePurchase(input: {
  product: RestaurantProduct;
  requested: number;
  offer: StoreOfferInput;
}): PurchaseOption {
  const { product, requested, offer } = input;
  const mode = saleModeOf(offer);
  if (!(offer.price > 0) || !(requested > 0)) {
    return option({
      valid: false,
      reason: "no_match",
      saleMode: mode,
      packs: 0,
      packAmount: null,
      packUnit: null,
      purchasedAmount: 0,
      purchasedUnit: product.unit,
      leftoverAmount: 0,
      shelfPrice: offer.price || 0,
      checkoutCost: null,
      unitPrice: null,
    });
  }

  if (mode === "loose_weight") {
    const per = pricePerProductUnitLoose(offer, product);
    if (per == null) {
      return option({
        valid: false,
        reason: "Немає упаковки близького розміру",
        saleMode: mode,
        packs: 0,
        packAmount: null,
        packUnit: null,
        purchasedAmount: 0,
        purchasedUnit: product.unit,
        leftoverAmount: 0,
        shelfPrice: offer.price,
        checkoutCost: null,
        unitPrice: null,
      });
    }
    const loose = checkoutLoose(requested, product.unit, per);
    if (product.purchaseStrategy === "stock_up" && product.maximumAmount != null) {
      if (requested - 1e-6 > product.maximumAmount) {
        return { ...loose, valid: false, reason: "over_maximum", checkoutCost: null };
      }
    }
    return loose;
  }

  const pack = packBaseInProductUnit(offer, product);
  if (!pack) {
    if (dimensionOf(product.unit) === "count") {
      return finalizeStrategy(
        product,
        requested,
        checkoutFixedPacks({
          requested,
          unit: product.unit,
          packAmount: 1,
          packPrice: offer.price,
          saleMode: mode,
        }),
        1,
        offer.price,
        mode,
      );
    }
    return option({
      valid: false,
      reason: "Немає упаковки близького розміру",
      saleMode: mode,
      packs: 0,
      packAmount: null,
      packUnit: null,
      purchasedAmount: 0,
      purchasedUnit: product.unit,
      leftoverAmount: 0,
      shelfPrice: offer.price,
      checkoutCost: null,
      unitPrice: null,
      warning: `${offer.name} — розмір пачки невідомий`,
    });
  }

  return finalizeStrategy(
    product,
    requested,
    checkoutFixedPacks({
      requested,
      unit: pack.unit,
      packAmount: pack.amount,
      packPrice: offer.price,
      saleMode: mode,
    }),
    pack.amount,
    offer.price,
    mode,
  );
}

function finalizeStrategy(
  product: RestaurantProduct,
  requested: number,
  ceilPlan: PurchaseOption,
  packAmount: number,
  packPrice: number,
  mode: SaleMode,
): PurchaseOption {
  if (product.purchaseStrategy === "stock_up") {
    const max = product.maximumAmount;
    if (max == null) {
      return {
        ...ceilPlan,
        valid: false,
        reason: "Немає maximumAmount для stock_up",
        checkoutCost: null,
      };
    }
    const counts = iteratePackCounts(packAmount, requested, max);
    let best: PurchaseOption | null = null;
    for (const n of counts) {
      const purchased = n * packAmount;
      const cost = roundMoney(n * packPrice);
      const cand = option({
        valid: true,
        saleMode: mode,
        packs: n,
        packAmount,
        packUnit: product.unit,
        purchasedAmount: purchased,
        purchasedUnit: product.unit,
        leftoverAmount: Math.max(0, purchased - requested),
        shelfPrice: packPrice,
        checkoutCost: cost,
        unitPrice: purchased > 0 ? cost / purchased : null,
      });
      if (!best) best = cand;
      else if (
        (cand.unitPrice ?? Infinity) + 1e-9 < (best.unitPrice ?? Infinity)
      ) {
        best = cand;
      } else if (
        Math.abs((cand.unitPrice ?? 0) - (best.unitPrice ?? 0)) < 1e-9 &&
        (cand.checkoutCost ?? Infinity) < (best.checkoutCost ?? Infinity)
      ) {
        best = cand;
      }
    }
    if (!best) {
      return {
        ...ceilPlan,
        valid: false,
        reason: "Немає упаковки близького розміру",
        checkoutCost: null,
        warning: ceilPlan.checkoutCost != null
          ? `Найближче: ${ceilPlan.packs} × ${packAmount} ${product.unit}`
          : undefined,
      };
    }
    return best;
  }

  const ok = inExactNeedRange(
    ceilPlan.purchasedAmount,
    requested,
    product.tolerancePercent,
  );
  if (ok) return ceilPlan;
  const { minimumAmount, maximumAmount } = exactNeedBounds(
    requested,
    product.tolerancePercent,
  );
  const counts = iteratePackCounts(packAmount, minimumAmount, maximumAmount);
  if (counts.length) {
    const n = counts[0]!;
    const purchased = n * packAmount;
    const cost = roundMoney(n * packPrice);
    return option({
      valid: true,
      saleMode: mode,
      packs: n,
      packAmount,
      packUnit: product.unit,
      purchasedAmount: purchased,
      purchasedUnit: product.unit,
      leftoverAmount: Math.max(0, purchased - requested),
      shelfPrice: packPrice,
      checkoutCost: cost,
      unitPrice: purchased > 0 ? cost / purchased : null,
    });
  }
  return {
    ...ceilPlan,
    valid: false,
    reason: "Немає упаковки близького розміру",
    checkoutCost: null,
    warning: `Найближче: ${ceilPlan.purchasedAmount} ${product.unit} за $${ceilPlan.checkoutCost ?? "—"}`,
  };
}

export interface StoreLine {
  storeId: string;
  valid: boolean;
  checkoutCost: number | null;
  purchasedAmount: number;
  option: PurchaseOption;
}

/**
 * Fair savings: winner quantity Q, other stores cheapest way to buy ≥ Q
 * within stock_up max / exact_need bounds.
 */
export function fairCompareCheckouts(
  lines: StoreLine[],
  product: RestaurantProduct,
  requested: number,
): { cheaper: string; delta: number | null } {
  const valid = lines.filter((l) => l.valid && l.checkoutCost != null);
  if (valid.length < 2) {
    return { cheaper: "incomplete", delta: null };
  }
  if (product.purchaseStrategy !== "stock_up") {
    const min = Math.min(...valid.map((l) => l.checkoutCost!));
    const winners = valid.filter((l) => Math.abs(l.checkoutCost! - min) < 0.005);
    const second = [...valid.map((l) => l.checkoutCost!)].sort((a, b) => a - b)[1];
    return {
      cheaper: winners.length > 1 ? "tie" : winners[0]!.storeId,
      delta: second != null ? roundMoney(min - second) : null,
    };
  }
  const ranked = [...valid].sort((a, b) => {
    const ua = a.option.unitPrice ?? Infinity;
    const ub = b.option.unitPrice ?? Infinity;
    if (ua !== ub) return ua - ub;
    return (a.checkoutCost ?? Infinity) - (b.checkoutCost ?? Infinity);
  });
  const winner = ranked[0]!;
  const q = winner.purchasedAmount;
  const comparable: Array<{ storeId: string; cost: number }> = [];
  for (const line of lines) {
    if (!line.valid || line.option.packAmount == null) {
      if (line.storeId === winner.storeId && line.checkoutCost != null) {
        comparable.push({ storeId: line.storeId, cost: line.checkoutCost });
      }
      continue;
    }
    const pack = line.option.packAmount;
    const max =
      product.maximumAmount ??
      exactNeedBounds(requested, product.tolerancePercent).maximumAmount;
    const n = Math.ceil(q / pack - 1e-9);
    const purchased = n * pack;
    if (purchased - 1e-6 > max) continue;
    comparable.push({
      storeId: line.storeId,
      cost: roundMoney(n * line.option.shelfPrice),
    });
  }
  if (comparable.length < 2) return { cheaper: "incomplete", delta: null };
  const min = Math.min(...comparable.map((c) => c.cost));
  const winners = comparable.filter((c) => Math.abs(c.cost - min) < 0.005);
  const second = [...comparable.map((c) => c.cost)].sort((a, b) => a - b)[1];
  return {
    cheaper: winners.length > 1 ? "tie" : winners[0]!.storeId,
    delta: second != null ? roundMoney(min - second) : null,
  };
}

export function toBaseRequested(amount: number, unit: AmountUnit): {
  amount: number;
  unit: BaseUnit;
} {
  return toBase(amount, unit);
}

export function fromBaseAmount(amount: number, unit: AmountUnit): number {
  return fromBase(amount, unit);
}

/**
 * Build one staples compare row from already-resolved catalog offers.
 * Used by /api/staples/compare and the full-app audit. No Rapid/PCX calls.
 */
import {
  classifyMatchKind,
  extractBarcodes,
  fairCompareThree,
  packMassKg,
} from "@/domain/fair-compare";
import type { ResolveReason } from "@/domain/compare-resolve";
import {
  defaultNeededGrams,
  isEggPackItem,
  isSoldByWeightItem,
  resolveMatchMode,
  summarizeOffer,
  usesNeededWeightPick,
  usesSharedPackCover,
  withExpectedPackSize,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";
import {
  offerMassKg,
  typicalEachGramsOf,
  withTypicalEachMass,
} from "@/domain/same-packed-item";
import { isPreferredIdentityRejected } from "@/lib/retailer-mappings";
import { preferredStapleImage, retailerSideImage } from "@/lib/product-image";
import {
  looseWeightPurchase,
  purchasePlanForPack,
  sharedCoverGramsForDissimilarPacks,
  type WeightPurchasePlan,
} from "@/domain/needed-weight-pick";
import type { OfferStatus } from "@/domain/sanity";
import {
  applyProductOverride,
  toRestaurantProduct,
  type ProductOverride,
} from "@/domain/restaurant-product";
import {
  evaluatePurchase,
  fairCompareCheckouts,
  type PurchaseOption,
} from "@/domain/checkout";
import { dimensionOf } from "@/domain/purchase-units";
import { offerMatchesIdentity } from "@/domain/product-identity";
import { inferSaleMode } from "@/domain/sale-mode";
import { isShelfSale, saleWasPrice } from "@/domain/shelf-sale";

export interface SideEval {
  status: OfferStatus;
  reason?: string;
  ageLabel: string | null;
}

export interface StapleCompareRow {
  id: string;
  label: string;
  image: string | null;
  confirmed: boolean;
  soldByWeight: boolean;
  grams: number | null;
  qty: number;
  matchKind: string;
  fairBasis: string;
  fairLabel: string;
  mappingDecision?: string;
  resolveReason?: {
    walmart?: ResolveReason;
    noFrills?: ResolveReason;
    wholesaleClub?: ResolveReason;
    mvr?: ResolveReason;
  };
  walmart: Record<string, unknown>;
  noFrills: Record<string, unknown>;
  wholesaleClub: Record<string, unknown>;
  mvr: Record<string, unknown>;
  cheaper: string;
  delta: number | null;
  basketWalmart: number | null;
  basketNoFrills: number | null;
  basketWholesaleClub: number | null;
  basketMvr: number | null;
  requestedAmount?: number;
  requestedUnit?: string;
  purchaseStrategy?: string;
  matchModeCanonical?: string;
}

function asCatalogOffer(
  offer: CatalogOffer | null,
): CatalogOffer | null {
  return offer && offer.productId && offer.price > 0 ? offer : null;
}

function checkoutFromWeightPlan(
  plan: WeightPurchasePlan,
  saleMode: PurchaseOption["saleMode"],
): PurchaseOption {
  const leftover = Math.max(0, plan.gotGrams - plan.neededGrams);
  return {
    valid: true,
    saleMode: plan.soldByWeight ? "loose_weight" : saleMode,
    packs: plan.soldByWeight ? 0 : plan.packs,
    packAmount:
      plan.soldByWeight || !(plan.packGrams > 0) ? null : plan.packGrams,
    packUnit: plan.soldByWeight ? null : "g",
    purchasedAmount: plan.gotGrams,
    purchasedUnit: "g",
    leftoverAmount: leftover,
    leftoverUnit: "g",
    shelfPrice: plan.shelfPrice,
    checkoutCost: plan.totalPrice,
    unitPrice: null,
  };
}

export function buildStapleCompareRow(input: {
  item: StapleItem;
  wmOffer: CatalogOffer | null;
  nfOffer: CatalogOffer | null;
  wcOffer?: CatalogOffer | null;
  mvrOffer?: CatalogOffer | null;
  wmEval: SideEval;
  nfEval: SideEval;
  wcEval?: SideEval;
  mvrEval?: SideEval;
  wmUsable: boolean;
  nfUsable: boolean;
  wcUsable?: boolean;
  mvrUsable?: boolean;
  grams: number | null;
  /** Pack / carton count for non-weight staples. Default 1. */
  qty?: number;
  requestedAmount?: number;
  productOverride?: ProductOverride | null;
  confirmedStoreProducts?: Record<string, string>;
  confirmed: boolean;
  mappingDecision?: string;
  resolveReason?: {
    walmart?: ResolveReason;
    noFrills?: ResolveReason;
    wholesaleClub?: ResolveReason;
    mvr?: ResolveReason;
  };
  nfUpc?: string;
}): StapleCompareRow {
  const item = input.item;
  const soldByWeight = isSoldByWeightItem(item);
  const mode = resolveMatchMode(item);
  const userGrams =
    input.grams != null && Number.isFinite(input.grams) && input.grams > 0
      ? input.grams
      : null;
  const selectedQty = Math.max(1, Math.round(Number(input.qty) || 1));
  const userNeededGrams = soldByWeight
    ? (userGrams ?? defaultNeededGrams(item))
    : usesNeededWeightPick(item) && userGrams
      ? userGrams
      : null;

  const wmOffer = input.wmUsable ? asCatalogOffer(input.wmOffer) : null;
  const nfOffer = input.nfUsable ? asCatalogOffer(input.nfOffer) : null;
  const wcOffer = input.wcUsable ? asCatalogOffer(input.wcOffer ?? null) : null;
  const mvrOffer = input.mvrUsable ? asCatalogOffer(input.mvrOffer ?? null) : null;
  const wmRaw = wmOffer
    ? withExpectedPackSize(item, withTypicalEachMass(item, wmOffer))
    : null;
  const nfRaw = nfOffer
    ? withExpectedPackSize(item, withTypicalEachMass(item, nfOffer))
    : null;
  const wcRaw = wcOffer
    ? withExpectedPackSize(item, withTypicalEachMass(item, wcOffer))
    : null;
  const mvrRaw = mvrOffer
    ? withExpectedPackSize(item, withTypicalEachMass(item, mvrOffer))
    : null;
  const typicalEachGrams = typicalEachGramsOf(item);
  const sharedCoverGrams =
    userNeededGrams == null &&
    !soldByWeight &&
    usesSharedPackCover(item)
      ? sharedCoverGramsForDissimilarPacks(
          [wmRaw, nfRaw, wcRaw, mvrRaw].map((offer) =>
            offer ? offerMassKg(item, offer) : null,
          ),
          selectedQty,
        )
      : null;
  const neededGrams = userNeededGrams ?? sharedCoverGrams;
  const neededPickActive = Boolean(neededGrams && !soldByWeight);
  const packQty = soldByWeight || neededPickActive ? 1 : selectedQty;
  const qtyKg =
    soldByWeight && neededGrams != null
      ? neededGrams / 1000
      : soldByWeight &&
          input.grams != null &&
          Number.isFinite(input.grams) &&
          input.grams > 0
        ? input.grams / 1000
        : 1;
  const summarizeQty = isEggPackItem(item)
    ? Math.max(
        1,
        Math.round(
          Number(input.requestedAmount) || Number(input.qty) || packQty,
        ),
      )
    : soldByWeight
      ? qtyKg
      : packQty;

  const walmart = summarizeOffer(item, wmRaw, summarizeQty, "walmart_ca");
  const noFrills = summarizeOffer(
    item,
    nfRaw
      ? {
          name: nfRaw.name,
          price: nfRaw.price,
          productId: nfRaw.productId,
          packageSize: nfRaw.packageSize,
          parsedMassKg: nfRaw.parsedMassKg,
          unitPrice: nfRaw.unitPrice,
          confidence: nfRaw.confidence,
          checkedAt: nfRaw.checkedAt,
          retailer: "no_frills",
        }
      : null,
    summarizeQty,
    "no_frills",
  );
  const wholesaleClub = summarizeOffer(
    item,
    wcRaw
      ? {
          name: wcRaw.name,
          price: wcRaw.price,
          productId: wcRaw.productId,
          packageSize: wcRaw.packageSize,
          parsedMassKg: wcRaw.parsedMassKg,
          unitPrice: wcRaw.unitPrice,
          confidence: wcRaw.confidence,
          checkedAt: wcRaw.checkedAt,
          retailer: "wholesale_club",
        }
      : null,
    summarizeQty,
    "wholesale_club",
  );
  const mvr = summarizeOffer(
    item,
    mvrRaw
      ? {
          name: mvrRaw.name,
          price: mvrRaw.price,
          productId: mvrRaw.productId,
          packageSize: mvrRaw.packageSize,
          parsedMassKg: mvrRaw.parsedMassKg,
          unitPrice: mvrRaw.unitPrice,
          confidence: mvrRaw.confidence,
          checkedAt: mvrRaw.checkedAt,
          retailer: "mvr",
        }
      : null,
    summarizeQty,
    "mvr",
  );

  const egg = isEggPackItem(item);
  const wmOk =
    walmart &&
    (walmart.status === "ok" || walmart.status === "stale") &&
    walmart.lineTotal != null;
  const nfOk =
    noFrills &&
    (noFrills.status === "ok" || noFrills.status === "stale") &&
    noFrills.lineTotal != null;
  const wcOk =
    wholesaleClub &&
    (wholesaleClub.status === "ok" || wholesaleClub.status === "stale") &&
    wholesaleClub.lineTotal != null;
  const mvrOk =
    mvr &&
    (mvr.status === "ok" || mvr.status === "stale") &&
    mvr.lineTotal != null;

  const planFor = (
    raw: CatalogOffer | null,
    summarized: { pricePerKg?: number } | null,
  ): WeightPurchasePlan | null => {
    if (neededGrams == null || !raw) return null;
    const mode = inferSaleMode({
      name: raw.name,
      packageSize: raw.packageSize,
      parsedMassKg: raw.parsedMassKg,
      stapleSoldByWeight: soldByWeight,
    });
    if (mode === "loose_weight") {
      const perKg = summarized?.pricePerKg;
      if (!(perKg && perKg > 0)) return null;
      return looseWeightPurchase({
        neededGrams,
        pricePerKg: perKg,
        productId: raw.productId,
        name: raw.name,
        image: raw.image,
        shelfPrice: raw.price,
      });
    }
    return purchasePlanForPack(neededGrams, {
      ...raw,
      typicalEachGrams,
    });
  };

  const wmPlan = planFor(wmRaw, walmart);
  const nfPlan = planFor(nfRaw, noFrills);
  const wcPlan = planFor(wcRaw, wholesaleClub);
  const mvrPlan = planFor(mvrRaw, mvr);

  const wcEval: SideEval = input.wcEval ?? {
    status: "no_match",
    ageLabel: null,
  };

  const mvrEval: SideEval = input.mvrEval ?? {
    status: "no_match",
    ageLabel: null,
  };

  let fair = fairCompareThree(
    {
      ok: Boolean(wmOk),
      shelfPrice: walmart?.shelfPrice,
      lineTotal: walmart?.lineTotal,
      pricePerKg: egg ? null : walmart?.pricePerKg,
      pricePerEach: walmart?.pricePerEach,
      packKg: packMassKg(walmart?.name, walmart?.pack),
      isEgg: egg,
    },
    {
      ok: Boolean(nfOk),
      shelfPrice: noFrills?.shelfPrice,
      lineTotal: noFrills?.lineTotal,
      pricePerKg: egg ? null : noFrills?.pricePerKg,
      pricePerEach: noFrills?.pricePerEach,
      packKg: packMassKg(noFrills?.name, noFrills?.pack),
      isEgg: egg,
    },
    {
      ok: Boolean(wcOk),
      shelfPrice: wholesaleClub?.shelfPrice,
      lineTotal: wholesaleClub?.lineTotal,
      pricePerKg: egg ? null : wholesaleClub?.pricePerKg,
      pricePerEach: wholesaleClub?.pricePerEach,
      packKg: packMassKg(wholesaleClub?.name, wholesaleClub?.pack),
      isEgg: egg,
    },
    {
      ok: Boolean(mvrOk),
      shelfPrice: mvr?.shelfPrice,
      lineTotal: mvr?.lineTotal,
      pricePerKg: egg ? null : mvr?.pricePerKg,
      pricePerEach: mvr?.pricePerEach,
      packKg: packMassKg(mvr?.name, mvr?.pack),
      isEgg: egg,
    },
  );

  const product = applyProductOverride(
    toRestaurantProduct({
      ...item,
      soldByWeight,
    }),
    input.productOverride,
  );
  const requested =
    input.requestedAmount != null && input.requestedAmount > 0
      ? input.requestedAmount
      : product.unit === "g" && neededGrams
        ? neededGrams
        : product.unit === "kg" && neededGrams
          ? neededGrams / 1000
          : dimensionOf(product.unit) !== "count"
            ? product.defaultAmount
            : packQty;
  const displayRequested =
    neededPickActive && neededGrams != null ? neededGrams : requested;
  const displayUnit =
    neededPickActive && neededGrams != null ? "g" : product.unit;

  const ident = (
    raw: CatalogOffer | null,
    retailer: string,
  ): { ok: boolean; reason?: string } => {
    if (!raw) return { ok: false, reason: "no_match" };
    return offerMatchesIdentity({
      product,
      offer: raw,
      confirmedProductId: input.confirmedStoreProducts?.[retailer],
      preferredUpc: extractBarcodes(...item.queries, item.preferredProductId)[0],
    });
  };

  const purchaseOf = (
    raw: CatalogOffer | null,
    retailer: string,
    summarized: { pricePerKg?: number } | null,
  ): PurchaseOption | null => {
    const idn = ident(raw, retailer);
    if (!raw || !idn.ok) {
      return {
        valid: false,
        reason: idn.reason ?? "no_match",
        saleMode: "fixed_pack",
        packs: 0,
        packAmount: null,
        packUnit: null,
        purchasedAmount: 0,
        purchasedUnit: product.unit,
        leftoverAmount: 0,
        leftoverUnit: product.unit,
        shelfPrice: raw?.price ?? 0,
        checkoutCost: null,
        unitPrice: null,
      };
    }
    return evaluatePurchase({
      product,
      requested,
      offer: {
        price: raw.price,
        name: raw.name,
        packageSize: raw.packageSize,
        parsedMassKg: raw.parsedMassKg,
        pricePerKg: summarized?.pricePerKg,
        stapleSoldByWeight: soldByWeight,
        checkedAt: raw.checkedAt,
      },
    });
  };

  const wmBuy = purchaseOf(wmRaw, "walmart_ca", walmart);
  const nfBuy = purchaseOf(nfRaw, "no_frills", noFrills);
  const wcBuy = purchaseOf(wcRaw, "wholesale_club", wholesaleClub);
  const mvrBuy = purchaseOf(mvrRaw, "mvr", mvr);

  if (isPreferredIdentityRejected(mode, { decision: input.mappingDecision })) {
    fair = {
      cheaper: "incomplete",
      delta: null,
      fairBasis: "incomparable",
      fairLabel: "різні товари — не порівнюємо як угоду",
      wmFair: null,
      nfFair: null,
      wcFair: null,
      mvrFair: null,
    };
  } else if (
    neededPickActive &&
    !soldByWeight &&
    !egg &&
    (wmPlan || nfPlan || wcPlan || mvrPlan)
  ) {
    const wmTotal = wmOk && wmPlan ? wmPlan.totalPrice : null;
    const nfTotal = nfOk && nfPlan ? nfPlan.totalPrice : null;
    const wcTotal = wcOk && wcPlan ? wcPlan.totalPrice : null;
    const mvrTotal = mvrOk && mvrPlan ? mvrPlan.totalPrice : null;
    const priced = [
      ["walmart", wmTotal],
      ["nofrills", nfTotal],
      ["wholesaleclub", wcTotal],
      ["mvr", mvrTotal],
    ].filter((row): row is [string, number] => row[1] != null);
    if (priced.length >= 2) {
      const min = Math.min(...priced.map(([, v]) => v));
      const winners = priced.filter(([, v]) => Math.abs(v - min) < 0.005);
      const second = [...priced.map(([, v]) => v)].sort((a, b) => a - b)[1];
      fair = {
        cheaper: winners.length > 1 ? "tie" : (winners[0][0] as typeof fair.cheaper),
        delta: second != null ? Math.round((min - second) * 100) / 100 : null,
        fairBasis: "needed_weight",
        fairLabel: sharedCoverGrams
          ? `за ${neededGrams} g (різні пачки)`
          : "за потрібну закупівлю",
        wmFair: wmTotal,
        nfFair: nfTotal,
        wcFair: wcTotal,
        mvrFair: mvrTotal,
      };
    } else {
      fair = {
        cheaper: "incomplete",
        delta: null,
        fairBasis: "needed_weight",
        fairLabel: sharedCoverGrams
          ? `за ${neededGrams} g (різні пачки)`
          : "за потрібну закупівлю",
        wmFair: wmTotal,
        nfFair: nfTotal,
        wcFair: wcTotal,
        mvrFair: mvrTotal,
      };
    }
  }

  const useNeededWeightPlan =
    neededPickActive && !soldByWeight && !egg && Boolean(wmPlan || nfPlan || wcPlan || mvrPlan);

  const wmBasket = useNeededWeightPlan
    ? ident(wmRaw, "walmart_ca").ok && wmPlan
      ? wmPlan.totalPrice
      : null
    : wmBuy?.valid
      ? wmBuy.checkoutCost
      : null;
  const nfBasket = useNeededWeightPlan
    ? ident(nfRaw, "no_frills").ok && nfPlan
      ? nfPlan.totalPrice
      : null
    : nfBuy?.valid
      ? nfBuy.checkoutCost
      : null;
  const wcBasket = useNeededWeightPlan
    ? ident(wcRaw, "wholesale_club").ok && wcPlan
      ? wcPlan.totalPrice
      : null
    : wcBuy?.valid
      ? wcBuy.checkoutCost
      : null;
  const mvrBasket = useNeededWeightPlan
    ? ident(mvrRaw, "mvr").ok && mvrPlan
      ? mvrPlan.totalPrice
      : null
    : mvrBuy?.valid
      ? mvrBuy.checkoutCost
      : null;

  const checkoutFair = fairCompareCheckouts(
    [
      {
        storeId: "walmart",
        valid: Boolean(wmBuy?.valid),
        checkoutCost: wmBasket,
        purchasedAmount: wmBuy?.purchasedAmount ?? 0,
        option: wmBuy!,
      },
      {
        storeId: "nofrills",
        valid: Boolean(nfBuy?.valid),
        checkoutCost: nfBasket,
        purchasedAmount: nfBuy?.purchasedAmount ?? 0,
        option: nfBuy!,
      },
      {
        storeId: "wholesaleclub",
        valid: Boolean(wcBuy?.valid),
        checkoutCost: wcBasket,
        purchasedAmount: wcBuy?.purchasedAmount ?? 0,
        option: wcBuy!,
      },
      {
        storeId: "mvr",
        valid: Boolean(mvrBuy?.valid),
        checkoutCost: mvrBasket,
        purchasedAmount: mvrBuy?.purchasedAmount ?? 0,
        option: mvrBuy!,
      },
    ].filter((row) => row.option),
    product,
    requested,
  );
  if (
    !isPreferredIdentityRejected(mode, { decision: input.mappingDecision }) &&
    !useNeededWeightPlan
  ) {
    fair = {
      ...fair,
      cheaper: checkoutFair.cheaper as typeof fair.cheaper,
      delta: checkoutFair.delta,
      fairBasis: product.purchaseStrategy === "stock_up" ? "needed_weight" : fair.fairBasis,
      fairLabel:
        product.purchaseStrategy === "stock_up"
          ? "за фактичну закупівлю (stock up)"
          : "за checkout, не $/100g",
      wmFair: wmBasket,
      nfFair: nfBasket,
      wcFair: wcBasket,
      mvrFair: mvrBasket,
    };
  }

  const matchKind = classifyMatchKind({
    mode,
    preferredId: item.preferredProductId,
    productId:
      walmart?.productId ?? noFrills?.productId ?? wholesaleClub?.productId ?? "",
    upc: input.nfUpc,
    targetUpcs: extractBarcodes(...item.queries, item.preferredProductId),
  });

  const emptySide = (evalRow: SideEval) => ({
    status: evalRow.status,
    statusReason: evalRow.reason ?? evalRow.status,
    lineTotal: null as number | null,
    compareUnitLabel: null as string | null,
  });

  const decorate = (
    summarized: typeof walmart,
    buy: PurchaseOption | null,
    plan: WeightPurchasePlan | null,
    evalRow: SideEval,
    retailer: "walmart_ca" | "no_frills" | "wholesale_club" | "mvr",
    raw: CatalogOffer | null,
  ) => {
    if (!summarized && !raw) {
      return {
        ...emptySide(evalRow),
        checkout: buy,
        matchStatus: buy?.reason ?? evalRow.status,
      };
    }
    const identOk = ident(raw, retailer).ok;
    const fromPlan =
      useNeededWeightPlan && plan && identOk
        ? checkoutFromWeightPlan(plan, buy?.saleMode ?? "fixed_pack")
        : null;
    const shown = fromPlan ?? buy;
    const cost = fromPlan?.checkoutCost
      ?? (buy?.valid ? buy.checkoutCost : null);
    return {
      ...(summarized ?? emptySide(evalRow)),
      lineTotal: cost,
      ageLabel: evalRow.ageLabel,
      onSale: Boolean(raw && isShelfSale(raw)),
      wasPrice: saleWasPrice(raw),
      purchase: plan,
      checkout: shown,
      saleMode: shown?.saleMode,
      requestedAmount: displayRequested,
      requestedUnit: displayUnit,
      purchasedAmount: shown?.purchasedAmount ?? null,
      leftoverAmount: shown?.leftoverAmount ?? null,
      leftoverUnit: shown?.leftoverUnit ?? null,
      packsNeeded: shown?.packs ?? null,
      matchStatus:
        useNeededWeightPlan && plan && identOk
          ? "ok"
          : buy?.valid
            ? "ok"
            : buy?.reason ?? evalRow.status,
      image: retailerSideImage({
        retailer,
        offer: {
          image: plan?.image ?? raw?.image,
          productId: plan?.productId ?? raw?.productId,
        },
        stapleImage: retailer === "walmart_ca" ? item.image : undefined,
      }),
    };
  };

  return {
    id: item.id,
    label: item.label,
    image: preferredStapleImage({
      matchMode: mode,
      stapleImage: item.image,
      wmOffer: wmRaw,
      nfOffer: nfRaw,
      wcOffer: wcRaw,
      mvrOffer: mvrRaw,
    }),
    confirmed: input.confirmed,
    soldByWeight,
    grams: neededGrams ?? input.grams,
    qty: soldByWeight || neededPickActive ? 1 : packQty,
    matchKind,
    fairBasis: fair.fairBasis,
    fairLabel: fair.fairLabel,
    mappingDecision: input.mappingDecision,
    resolveReason: input.resolveReason,
    walmart: decorate(
      walmart,
      wmBuy,
      wmPlan,
      input.wmEval,
      "walmart_ca",
      wmRaw,
    ),
    noFrills: decorate(noFrills, nfBuy, nfPlan, input.nfEval, "no_frills", nfRaw),
    wholesaleClub: decorate(wholesaleClub, wcBuy, wcPlan, wcEval, "wholesale_club", wcRaw),
    mvr: decorate(mvr, mvrBuy, mvrPlan, mvrEval, "mvr", mvrRaw),
    cheaper: fair.cheaper,
    delta: fair.delta,
    basketWalmart: wmBasket,
    basketNoFrills: nfBasket,
    basketWholesaleClub: wcBasket,
    basketMvr: mvrBasket,
    requestedAmount: displayRequested,
    requestedUnit: displayUnit,
    purchaseStrategy: product.purchaseStrategy,
    matchModeCanonical: product.matchMode,
  };
}

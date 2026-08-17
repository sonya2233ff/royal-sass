/**
 * Build one staples compare row from already-resolved catalog offers.
 * Used by /api/staples/compare and the full-app audit. No Rapid/PCX calls.
 */
import {
  basketAmountForSide,
  classifyMatchKind,
  extractBarcodes,
  fairCompareSides,
  packMassKg,
  scaleBasketAmount,
} from "@/domain/fair-compare";
import type { ResolveReason } from "@/domain/compare-resolve";
import {
  defaultNeededGrams,
  isEggPackItem,
  isSoldByWeightItem,
  resolveMatchMode,
  summarizeOffer,
  usesNeededWeightPick,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";
import {
  typicalEachGramsOf,
  withTypicalEachMass,
} from "@/domain/same-packed-item";
import { isPreferredIdentityRejected } from "@/lib/retailer-mappings";
import { preferredStapleImage, retailerSideImage } from "@/lib/product-image";
import {
  looseWeightPurchase,
  purchasePlanForPack,
  type WeightPurchasePlan,
} from "@/domain/needed-weight-pick";
import type { OfferStatus } from "@/domain/sanity";

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
  resolveReason?: { walmart?: ResolveReason; noFrills?: ResolveReason };
  walmart: Record<string, unknown>;
  noFrills: Record<string, unknown>;
  cheaper: string;
  delta: number | null;
  basketWalmart: number | null;
  basketNoFrills: number | null;
}

function asCatalogOffer(
  offer: CatalogOffer | null,
): CatalogOffer | null {
  return offer && offer.productId && offer.price > 0 ? offer : null;
}

export function buildStapleCompareRow(input: {
  item: StapleItem;
  wmOffer: CatalogOffer | null;
  nfOffer: CatalogOffer | null;
  wmEval: SideEval;
  nfEval: SideEval;
  wmUsable: boolean;
  nfUsable: boolean;
  grams: number | null;
  /** Pack / carton count for non-weight staples. Default 1. */
  qty?: number;
  confirmed: boolean;
  mappingDecision?: string;
  resolveReason?: { walmart?: ResolveReason; noFrills?: ResolveReason };
  nfUpc?: string;
}): StapleCompareRow {
  const item = input.item;
  const soldByWeight = isSoldByWeightItem(item);
  const mode = resolveMatchMode(item);
  const neededPick = usesNeededWeightPick(item);
  const neededGrams =
    neededPick &&
    input.grams != null &&
    Number.isFinite(input.grams) &&
    input.grams > 0
      ? input.grams
      : neededPick
        ? defaultNeededGrams(item)
        : null;
  const packQty = soldByWeight || neededPick
    ? 1
    : Math.max(1, Math.round(Number(input.qty) || 1));
  const qtyKg =
    soldByWeight && neededGrams != null
      ? neededGrams / 1000
      : soldByWeight &&
          input.grams != null &&
          Number.isFinite(input.grams) &&
          input.grams > 0
        ? input.grams / 1000
        : 1;
  const summarizeQty = soldByWeight ? qtyKg : packQty;

  const wmOffer = input.wmUsable ? asCatalogOffer(input.wmOffer) : null;
  const nfOffer = input.nfUsable ? asCatalogOffer(input.nfOffer) : null;
  const wmRaw = wmOffer ? withTypicalEachMass(item, wmOffer) : null;
  const nfRaw = nfOffer ? withTypicalEachMass(item, nfOffer) : null;
  const typicalEachGrams = typicalEachGramsOf(item);

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

  const egg = isEggPackItem(item);
  const wmOk =
    walmart &&
    (walmart.status === "ok" || walmart.status === "stale") &&
    walmart.lineTotal != null;
  const nfOk =
    noFrills &&
    (noFrills.status === "ok" || noFrills.status === "stale") &&
    noFrills.lineTotal != null;

  const wmPlan: WeightPurchasePlan | null =
    neededPick && neededGrams != null && wmRaw
      ? soldByWeight && walmart?.pricePerKg
        ? looseWeightPurchase({
            neededGrams,
            pricePerKg: walmart.pricePerKg,
            productId: wmRaw.productId,
            name: wmRaw.name,
            image: wmRaw.image,
            shelfPrice: wmRaw.price,
          })
        : soldByWeight
          ? null
          : purchasePlanForPack(neededGrams, {
              ...wmRaw,
              typicalEachGrams,
            })
      : null;
  const nfPlan: WeightPurchasePlan | null =
    neededPick && neededGrams != null && nfRaw
      ? soldByWeight && noFrills?.pricePerKg
        ? looseWeightPurchase({
            neededGrams,
            pricePerKg: noFrills.pricePerKg,
            productId: nfRaw.productId,
            name: nfRaw.name,
            image: nfRaw.image,
            shelfPrice: nfRaw.price,
          })
        : soldByWeight
          ? null
          : purchasePlanForPack(neededGrams, {
              ...nfRaw,
              typicalEachGrams,
            })
      : null;

  let fair = fairCompareSides(
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
  );

  if (isPreferredIdentityRejected(mode, { decision: input.mappingDecision })) {
    fair = {
      cheaper: "incomplete",
      delta: null,
      fairBasis: "incomparable",
      fairLabel: "різні товари — не порівнюємо як угоду",
      wmFair: null,
      nfFair: null,
    };
  } else if (neededPick && !soldByWeight && !egg && (wmPlan || nfPlan)) {
    const wmTotal = wmOk && wmPlan ? wmPlan.totalPrice : null;
    const nfTotal = nfOk && nfPlan ? nfPlan.totalPrice : null;
    if (wmTotal != null && nfTotal != null) {
      const delta = Math.round((wmTotal - nfTotal) * 100) / 100;
      fair = {
        cheaper:
          Math.abs(delta) < 0.005
            ? "tie"
            : wmTotal < nfTotal
              ? "walmart"
              : "nofrills",
        delta,
        fairBasis: "needed_weight",
        fairLabel: "за потрібну закупівлю",
        wmFair: wmTotal,
        nfFair: nfTotal,
      };
    } else {
      fair = {
        cheaper: "incomplete",
        delta: null,
        fairBasis: "needed_weight",
        fairLabel: "за потрібну закупівлю",
        wmFair: wmTotal,
        nfFair: nfTotal,
      };
    }
  }

  const wmBasket = scaleBasketAmount(
    basketAmountForSide(fair, "walmart", wmOk ? walmart!.lineTotal : null),
    fair,
    { packQty, qtyKg },
  );
  const nfBasket = scaleBasketAmount(
    basketAmountForSide(fair, "nofrills", nfOk ? noFrills!.lineTotal : null),
    fair,
    { packQty, qtyKg },
  );

  const matchKind = classifyMatchKind({
    mode,
    preferredId: item.preferredProductId,
    productId: walmart?.productId ?? noFrills?.productId ?? "",
    upc: input.nfUpc,
    targetUpcs: extractBarcodes(...item.queries, item.preferredProductId),
  });

  return {
    id: item.id,
    label: item.label,
    image: preferredStapleImage({
      matchMode: mode,
      stapleImage: item.image,
      wmOffer: wmRaw,
      nfOffer: nfRaw,
    }),
    confirmed: input.confirmed,
    soldByWeight,
    grams: neededGrams ?? input.grams,
    qty: soldByWeight || neededPick ? 1 : packQty,
    matchKind,
    fairBasis: fair.fairBasis,
    fairLabel: fair.fairLabel,
    mappingDecision: input.mappingDecision,
    resolveReason: input.resolveReason,
    walmart: walmart
      ? {
          ...walmart,
          lineTotal: wmPlan?.totalPrice ?? walmart.lineTotal,
          ageLabel: input.wmEval.ageLabel,
          cardStatus: input.wmUsable ? input.wmEval.status : input.wmEval.status,
          purchase: wmPlan,
          image: retailerSideImage({
            retailer: "walmart_ca",
            offer: {
              image: wmPlan?.image ?? wmRaw?.image,
              productId: wmPlan?.productId ?? wmRaw?.productId,
            },
            stapleImage: item.image,
          }),
        }
      : {
          status: input.wmEval.status,
          statusReason: input.wmEval.reason ?? input.wmEval.status,
          lineTotal: null,
          compareUnitLabel: null,
        },
    noFrills: noFrills
      ? {
          ...noFrills,
          lineTotal: nfPlan?.totalPrice ?? noFrills.lineTotal,
          ageLabel: input.nfEval.ageLabel,
          purchase: nfPlan,
          image: retailerSideImage({
            retailer: "no_frills",
            offer: {
              image: nfPlan?.image ?? nfRaw?.image,
              productId: nfPlan?.productId ?? nfRaw?.productId,
            },
          }),
        }
      : {
          status: input.nfEval.status,
          statusReason: input.nfEval.reason,
          lineTotal: null,
          compareUnitLabel: null,
        },
    cheaper: fair.cheaper,
    delta: fair.delta,
    basketWalmart: wmBasket,
    basketNoFrills: nfBasket,
  };
}

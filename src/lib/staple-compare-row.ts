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
} from "@/domain/fair-compare";
import type { ResolveReason } from "@/domain/compare-resolve";
import {
  isEggPackItem,
  isSoldByWeightItem,
  resolveMatchMode,
  summarizeOffer,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";
import { isPreferredIdentityRejected } from "@/lib/retailer-mappings";
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
  confirmed: boolean;
  mappingDecision?: string;
  resolveReason?: { walmart?: ResolveReason; noFrills?: ResolveReason };
  nfUpc?: string;
}): StapleCompareRow {
  const item = input.item;
  const qtyKg =
    input.grams != null && Number.isFinite(input.grams) && input.grams > 0
      ? input.grams / 1000
      : 1;

  const wmRaw = input.wmUsable ? asCatalogOffer(input.wmOffer) : null;
  const nfRaw = input.nfUsable ? asCatalogOffer(input.nfOffer) : null;

  const walmart = summarizeOffer(item, wmRaw, qtyKg, "walmart_ca");
  const noFrills = summarizeOffer(
    item,
    nfRaw
      ? {
          name: nfRaw.name,
          price: nfRaw.price,
          productId: nfRaw.productId,
          packageSize: nfRaw.packageSize,
          unitPrice: nfRaw.unitPrice,
          confidence: nfRaw.confidence,
          checkedAt: nfRaw.checkedAt,
          retailer: "no_frills",
        }
      : null,
    qtyKg,
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

  const mode = resolveMatchMode(item);
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
  }

  const wmBasket = basketAmountForSide(
    fair,
    "walmart",
    wmOk ? walmart!.lineTotal : null,
  );
  const nfBasket = basketAmountForSide(
    fair,
    "nofrills",
    nfOk ? noFrills!.lineTotal : null,
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
    image: item.image ?? null,
    confirmed: input.confirmed,
    soldByWeight: isSoldByWeightItem(item),
    grams: input.grams,
    matchKind,
    fairBasis: fair.fairBasis,
    fairLabel: fair.fairLabel,
    mappingDecision: input.mappingDecision,
    resolveReason: input.resolveReason,
    walmart: walmart
      ? {
          ...walmart,
          ageLabel: input.wmEval.ageLabel,
          cardStatus: input.wmUsable ? input.wmEval.status : input.wmEval.status,
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
          ageLabel: input.nfEval.ageLabel,
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

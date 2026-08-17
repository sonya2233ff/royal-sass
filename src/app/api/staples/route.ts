import { NextResponse } from "next/server";
import {
  CACHE_STALE_HOURS,
  evaluateOfferStatus,
  isShownStaple,
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  resolveMatchMode,
  isProduceWeightItem,
  isSoldByWeightItem,
  isEggPackItem,
} from "@/lib/staples";
import { walmartSourceApiFields } from "@/connectors/walmart-source";
import {
  defaultWeightUnit,
  formatMoneyPerWeight,
  formatMoneyPerEach,
  parsePackCount,
  resolveUnitPrices,
  weightUnitLabel,
} from "@/domain/units";
import type { ProductOffer } from "@/connectors/types";
import { offerIsOnSale } from "@/connectors/types";
import { resolveCatalogOffer } from "@/domain/compare-resolve";
import {
  loadRetailerMappings,
  lookupConfirmed,
} from "@/lib/retailer-mappings";
import { preferredStapleImage } from "@/lib/product-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unitFields(
  retailer: "walmart_ca" | "no_frills",
  storeId: string,
  offer: {
    productId: string;
    name: string;
    packageSize?: string;
    price: number;
    unitPrice?: number;
    checkedAt?: string;
  },
  showWeightUnits: boolean,
) {
  if (!showWeightUnits) return null;
  const product: ProductOffer = {
    retailer,
    storeId,
    productId: offer.productId,
    name: offer.name,
    packageSize: offer.packageSize,
    price: offer.price,
    unitPrice: offer.unitPrice,
    availability: "unknown",
    confidence: "exact",
    checkedAt: offer.checkedAt ?? new Date().toISOString(),
  };
  return resolveUnitPrices(product, {
    displayUnit: defaultWeightUnit(retailer),
  });
}

function eggUnitFields(offer: {
  name: string;
  packageSize?: string;
  price: number;
}): {
  count: number;
  priceEach: number;
  label: string;
} | null {
  const count = parsePackCount(offer.name, offer.packageSize);
  if (!count || count <= 0 || !(offer.price > 0)) return null;
  const priceEach = offer.price / count;
  return {
    count,
    priceEach,
    label: formatMoneyPerEach(priceEach),
  };
}

export async function GET() {
  const cfg = await loadStaplesConfig();
  const catalog = await loadWalmartCatalog();
  const nfCatalog = await loadNoFrillsCatalog();
  const confirmed = await loadConfirmed();
  const mappings = await loadRetailerMappings();
  const byId = new Map(catalog?.items.map((i) => [i.id, i]) ?? []);
  const nfById = new Map(nfCatalog?.items.map((i) => [i.id, i]) ?? []);

  const items = cfg.items
    .filter(isShownStaple)
    .map((i) => {
      const cat = byId.get(i.id);
      const mode = resolveMatchMode(i);
      const wmLink = mappings.products[i.id]?.retailers.walmart_ca;
      const nfLink = mappings.products[i.id]?.retailers.nofrills;
      const wmResolved = resolveCatalogOffer({
        item: i,
        row: cat,
        link: wmLink,
        matchMode: mode,
      });
      const offer = wmResolved.offer;
      const evalStatus = evaluateOfferStatus(i, offer ?? null, {
        unavailable: i.unavailableAtWalmart,
        catalogStatus:
          wmResolved.reason === "mapped_sku_missing" ||
          wmResolved.reason === "rejected_filter"
            ? "no_match"
            : cat?.status,
      });

      let status = evalStatus.status;
      if (wmResolved.reason === "mapped_sku_missing") status = "no_match";
      if (wmResolved.reason === "rejected_filter") status = "rejected";
      if (!offer && cat?.status === "wrong_pack") status = "wrong_pack";
      if (!offer && cat?.status === "wrong_size") status = "wrong_size";
      if (!offer && cat?.status === "unavailable") status = "unavailable";
      if (!offer && (cat?.status === "no_match" || !cat) && status === evalStatus.status) {
        status = i.unavailableAtWalmart ? "unavailable" : "no_match";
      }

      const usable = Boolean(offer && (status === "ok" || status === "stale"));

      const conf = lookupConfirmed(confirmed, i.id);
      const lockedSku =
        i.preferredProductId ?? conf?.productId ?? wmLink?.retailerProductId ?? null;
      let statusReason = evalStatus.reason ?? wmResolved.detail ?? null;
      if (wmResolved.reason === "mapped_sku_missing") {
        statusReason = wmResolved.detail ?? statusReason;
      }
      if (
        !usable &&
        lockedSku &&
        (status === "no_match" || status === "unavailable")
      ) {
        statusReason =
          wmResolved.reason === "mapped_sku_missing"
            ? `залочений SKU ${lockedSku} немає в каталозі`
            : statusReason ??
              "SKU \u0437\u0430\u043b\u043e\u0447\u0435\u043d\u0438\u0439, \u0436\u0438\u0432\u0430 \u0446\u0456\u043d\u0430 \u0437 WM API \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 (Rapid 429 / \u0431\u043b\u043e\u043a \u0441\u0430\u0439\u0442\u0443)";
      }

      const showWeightUnits = isProduceWeightItem(i);
      const eggItem = isEggPackItem(i);
      const units =
        usable && offer && showWeightUnits
          ? unitFields(
              "walmart_ca",
              "5831",
              {
                productId: offer.productId,
                name: offer.name,
                packageSize: offer.packageSize,
                price: offer.price,
                unitPrice: offer.unitPrice,
                checkedAt: offer.checkedAt,
              },
              true,
            )
          : null;
      const eggWm =
        usable && offer && eggItem ? eggUnitFields(offer) : null;

      const nfCat = nfById.get(i.id);
      const nfResolved = resolveCatalogOffer({
        item: i,
        row: nfCat,
        link: nfLink,
        matchMode: mode,
      });
      const nfOffer = nfResolved.offer ?? null;
      const nfEval = evaluateOfferStatus(i, nfOffer, {
        catalogStatus:
          nfResolved.reason === "rejected_filter" ? "no_match" : nfCat?.status,
      });
      const nfUsable = Boolean(
        nfOffer && (nfEval.status === "ok" || nfEval.status === "stale"),
      );
      const nfUnits =
        nfUsable && nfOffer && showWeightUnits
          ? unitFields(
              "no_frills",
              "3660",
              {
                productId: nfOffer.productId,
                name: nfOffer.name,
                packageSize: nfOffer.packageSize,
                price: nfOffer.price,
                unitPrice: nfOffer.unitPrice,
                checkedAt: nfOffer.checkedAt,
              },
              true,
            )
          : null;
      const eggNf =
        nfUsable && nfOffer && eggItem ? eggUnitFields(nfOffer) : null;

      const wmOnSale = usable
        ? offerIsOnSale(offer) ||
          /athbdg=L1300/i.test(offer?.sourceUrl ?? "")
        : false;
      const nfOnSale = nfUsable ? offerIsOnSale(nfOffer) : false;

      return {
        id: i.id,
        label: i.label,
        image: preferredStapleImage({
          matchMode: resolveMatchMode(i),
          stapleImage: i.image,
          wmOffer: offer,
          nfOffer,
        }),
        notes: i.notes,
        status,
        statusReason,
        ageLabel: evalStatus.ageLabel,
        ageHours: evalStatus.ageHours ?? null,
        confirmed: Boolean(conf),
        confirmedProductId: conf?.productId ?? null,
        preferredProductId: lockedSku,
        matchMode: resolveMatchMode(i),
        weightCompare: showWeightUnits || eggItem,
        soldByWeight: isSoldByWeightItem(i),
        onSale: wmOnSale || nfOnSale,
        walmartCached: usable
          ? {
              name: offer!.name,
              price: offer!.price,
              productId: offer!.productId,
              packageSize: offer!.packageSize,
              checkedAt: offer!.checkedAt ?? catalog?.checkedAt,
              wasPrice: offer!.wasPrice ?? null,
              onSale: wmOnSale,
              pricePerKg: units?.pricePerKg ?? null,
              pricePerLb: units?.pricePerLb ?? null,
              nativeUnit: units?.nativeUnit ?? null,
              nativeUnitPrice: eggWm?.priceEach ?? units?.nativePrice ?? null,
              nativeUnitLabel: eggWm
                ? `за ${eggWm.count} шт`
                : units
                  ? weightUnitLabel(units.nativeUnit)
                  : null,
              nativeUnitPriceLabel: eggWm
                ? eggWm.label
                : units
                  ? formatMoneyPerWeight(units.nativePrice, units.nativeUnit)
                  : null,
            }
          : null,
        noFrillsCached: nfUsable
          ? {
              name: nfOffer!.name,
              price: nfOffer!.price,
              productId: nfOffer!.productId,
              packageSize: nfOffer!.packageSize,
              checkedAt: nfOffer!.checkedAt ?? nfCatalog?.checkedAt,
              wasPrice: nfOffer!.wasPrice ?? null,
              onSale: nfOnSale,
              ageLabel: nfEval.ageLabel,
              pricePerKg: nfUnits?.pricePerKg ?? null,
              pricePerLb: nfUnits?.pricePerLb ?? null,
              nativeUnit: nfUnits?.nativeUnit ?? null,
              nativeUnitPrice: eggNf?.priceEach ?? nfUnits?.nativePrice ?? null,
              nativeUnitLabel: eggNf
                ? `за ${eggNf.count} шт`
                : nfUnits
                  ? weightUnitLabel(nfUnits.nativeUnit)
                  : null,
              nativeUnitPriceLabel: eggNf
                ? eggNf.label
                : nfUnits
                  ? formatMoneyPerWeight(nfUnits.nativePrice, nfUnits.nativeUnit)
                  : null,
            }
          : null,
      };
    });

  return NextResponse.json({
    ok: true,
    stores: [
      { key: "walmart_5831", name: "Walmart #5831" },
      { key: "nofrills_3660", name: "No Frills #3660" },
    ],
    sobeysEnabled: false,
    ...walmartSourceApiFields(),
    cacheStaleHours: CACHE_STALE_HOURS,
    catalogCheckedAt: catalog?.checkedAt ?? null,
    noFrillsCatalogCheckedAt: nfCatalog?.checkedAt ?? null,
    unitNote:
      "кг/lb лише для овочів і фруктів (WM $/kg, NF $/lb). Решта — ціна за пачку.",
    items,
  });
}

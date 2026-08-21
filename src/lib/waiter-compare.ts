/**
 * Catalog-only checkout for a waiter list. No Rapid/PCX rematch.
 * Driver later recomputes purchase plans from these line costs.
 */
import { catalogRowForStaple, resolveCatalogOffer } from "@/domain/compare-resolve";
import { linesFromBasketRows } from "@/domain/purchase-plans";
import { stapleWithClientOverride } from "@/domain/restaurant-product";
import {
  parseWaiterCompare,
  parseWaiterPlanLine,
  type WaiterCompareSnapshot,
  type WaiterTicketLine,
} from "@/domain/waiter-tickets";
import { loadMvrCatalog } from "@/lib/mvr-catalog";
import {
  effectiveProduct,
  parseCustomStapleDrafts,
  parseOverrideMap,
} from "@/lib/product-config";
import { loadRetailerMappings, lookupConfirmed } from "@/lib/retailer-mappings";
import { buildStapleCompareRow } from "@/lib/staple-compare-row";
import {
  defaultNeededGrams,
  evaluateOfferStatus,
  explicitNeededGrams,
  isEggPackItem,
  isSoldByWeightItem,
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  resolveMatchMode,
  shownStaples,
  withExpectedPackSize,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";
import { loadWholesaleClubCatalog } from "@/lib/wholesaleclub-catalog";
import type { RestaurantProduct } from "@/domain/restaurant-product";
import type { RetailerSkuLink } from "@/lib/retailer-mappings";

type CatalogRow = {
  id: string;
  status: string;
  offer: CatalogOffer | null;
  alternates?: CatalogOffer[];
};

function resolveSide(
  item: StapleItem,
  product: RestaurantProduct,
  row: CatalogRow | null,
  link: RetailerSkuLink | undefined,
  requested: number,
  packPickGrams?: number,
  unavailable?: boolean,
) {
  const resolved = resolveCatalogOffer({
    item,
    row,
    link,
    matchMode: resolveMatchMode(item),
    neededGrams: packPickGrams,
    product,
    requested,
  });
  const offer = resolved.offer ? withExpectedPackSize(item, resolved.offer) : null;
  const evalRow = evaluateOfferStatus(item, offer, {
    unavailable,
    catalogStatus:
      resolved.reason === "rejected_filter" ||
      resolved.reason === "mapped_sku_missing"
        ? "no_match"
        : row?.status,
  });
  const usable = Boolean(
    offer && (evalRow.status === "ok" || evalRow.status === "stale"),
  );
  return { offer: usable ? offer : null, eval: evalRow, usable };
}

function waiterNeed(
  item: StapleItem,
  product: RestaurantProduct,
  multiplier: number,
) {
  const n = Math.max(1, Math.round(multiplier));
  const requestedAmount = product.defaultAmount * n;
  const soldByWeight = isSoldByWeightItem(item);
  const packPickGrams = explicitNeededGrams(item);
  const grams = soldByWeight
    ? product.unit === "g"
      ? requestedAmount
      : product.unit === "kg"
        ? requestedAmount * 1000
        : defaultNeededGrams(item) * n
    : packPickGrams != null
      ? packPickGrams * n
      : product.unit === "g"
        ? requestedAmount
        : null;
  const qty = soldByWeight
    ? 1
    : isEggPackItem(item)
      ? Math.max(1, Math.round(requestedAmount))
      : n;
  return { requestedAmount, grams, qty };
}

export async function compareWaiterLines(
  lines: WaiterTicketLine[],
  customStaples?: unknown,
  productOverrides?: unknown,
): Promise<WaiterCompareSnapshot | null> {
  if (!lines.length) return null;
  const extras = parseCustomStapleDrafts(customStaples);
  const overrides = parseOverrideMap(productOverrides);
  const cfg = await loadStaplesConfig(extras);
  const allowed = new Set((await shownStaples(cfg.items)).map((i) => i.id));
  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const [wmCat, nfCat, wcCat, mvrCat, confirmed, mappings] = await Promise.all([
    loadWalmartCatalog(),
    loadNoFrillsCatalog(),
    loadWholesaleClubCatalog(),
    loadMvrCatalog(),
    loadConfirmed(),
    loadRetailerMappings(),
  ]);
  const wmById = new Map(wmCat?.items.map((i) => [i.id, i]) ?? []);
  const nfById = new Map(nfCat?.items.map((i) => [i.id, i]) ?? []);
  const wcById = new Map(wcCat?.items.map((i) => [i.id, i]) ?? []);
  const mvrById = new Map(mvrCat?.items.map((i) => [i.id, i]) ?? []);

  const rows = [];
  for (const line of lines) {
    const raw = byId.get(line.id);
    if (!raw || !allowed.has(line.id)) continue;
    const ov = overrides[line.id];
    const conf = lookupConfirmed(confirmed, line.id);
    const item = stapleWithClientOverride({ ...raw }, ov) as StapleItem;
    if (conf?.productId) item.preferredProductId = conf.productId;
    if (ov?.preferredProductId) item.preferredProductId = ov.preferredProductId;
    const soldByWeight = isSoldByWeightItem(item);
    const product = effectiveProduct({ ...item, soldByWeight }, ov);
    const need = waiterNeed(item, product, line.qty);
    const packPickGrams = explicitNeededGrams(item);
    const productMap = mappings.products[line.id];
    const wm = resolveSide(
      item,
      product,
      catalogRowForStaple(item, wmById),
      productMap?.retailers.walmart_ca,
      product.defaultAmount,
      packPickGrams,
      item.unavailableAtWalmart,
    );
    const nf = resolveSide(
      item,
      product,
      catalogRowForStaple(item, nfById),
      productMap?.retailers.nofrills,
      product.defaultAmount,
      packPickGrams,
    );
    const wc = resolveSide(
      item,
      product,
      catalogRowForStaple(item, wcById),
      productMap?.retailers.wholesaleclub,
      product.defaultAmount,
      packPickGrams,
    );
    const mvr = resolveSide(
      item,
      product,
      catalogRowForStaple(item, mvrById),
      productMap?.retailers.mvr,
      product.defaultAmount,
      packPickGrams,
    );
    rows.push(
      buildStapleCompareRow({
        item,
        wmOffer: wm.offer,
        nfOffer: nf.offer,
        wcOffer: wc.offer,
        mvrOffer: mvr.offer,
        wmEval: wm.eval,
        nfEval: nf.eval,
        wcEval: wc.eval,
        mvrEval: mvr.eval,
        wmUsable: wm.usable,
        nfUsable: nf.usable,
        wcUsable: wc.usable,
        mvrUsable: mvr.usable,
        grams: need.grams,
        qty: need.qty,
        requestedAmount: need.requestedAmount,
        confirmed: Boolean(conf),
      }),
    );
  }

  const priced = new Map(
    linesFromBasketRows(rows).map((row) => [row.id, row]),
  );
  const snapshot = parseWaiterCompare({
    comparedAt: new Date().toISOString(),
    lines: lines.map((line) => {
      const hit = priced.get(line.id);
      return (
        parseWaiterPlanLine({
          id: line.id,
          label: line.label,
          costs: hit?.costs ?? {},
        }) ?? { id: line.id, label: line.label, costs: {} }
      );
    }),
  });
  return snapshot;
}

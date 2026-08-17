/**
 * Seed Master → No Frills from the cached NF catalog, then match Walmart.
 * Confirmed / preferred SKUs are not rematched.
 * Does not call Rapid or PCX.
 */
import {
  AUTO_LINK_THRESHOLD,
  matchProducts,
  type MatchDecision,
  type MatchMethod,
} from "@/domain/entity-match";
import {
  NOFRILLS_RETAILER,
  WALMART_RETAILER,
  catalogOfferToRecord,
  isNoFrillsRetailerSku,
  offerFailsStapleFilters,
  stapleBrandHint,
  upcFromOffer,
  type CatalogOfferLike,
} from "@/domain/catalog-normalize";
import {
  assignPriceConfidence,
  type PriceConfidence,
} from "@/domain/price-confidence";
import { ageHours } from "@/domain/sanity";
import {
  SEED_STALE_HOURS,
  loadSeedCatalog,
  loadSeedConfirmed,
  loadSeedReceipts,
  loadSeedStaples,
  seedMatchMode,
  type SeedCatalogOffer,
  type SeedStapleItem,
} from "@/lib/catalog-json";
import { findOfferForSku } from "@/domain/compare-resolve";
import {
  isLockedIdentityLink,
  isVerifiedLink,
  lookupConfirmed,
  loadRetailerMappings,
  saveRetailerMappings,
  type MappedPrice,
  type MappingKind,
  type MasterProductMapping,
  type RetailerMappingStore,
  type RetailerSkuLink,
} from "@/lib/retailer-mappings";

const NF_STORE = "3660";
const WM_STORE = "5831";

function nowIso(): string {
  return new Date().toISOString();
}

function link(
  partial: Omit<RetailerSkuLink, "updatedAt"> & { updatedAt?: string },
): RetailerSkuLink {
  return { ...partial, updatedAt: partial.updatedAt ?? nowIso() };
}

function lookupConfirmedRow(
  confirmed: Awaited<ReturnType<typeof loadSeedConfirmed>>,
  masterId: string,
): { productId: string; confirmedAt: string; label?: string } | undefined {
  return lookupConfirmed(confirmed, masterId);
}

function receiptLock(
  receipts: Awaited<ReturnType<typeof loadSeedReceipts>>,
  masterId: string,
): { productId?: string; upc?: string; name?: string } | undefined {
  if (!receipts?.preferredByStapleId) return undefined;
  return lookupConfirmed(receipts.preferredByStapleId, masterId);
}

function receiptPriceFor(
  receipts: Awaited<ReturnType<typeof loadSeedReceipts>>,
  upc?: string,
): number | undefined {
  if (!receipts || !upc) return undefined;
  const rows = Object.values(receipts.byStoreUpc ?? {});
  const hit = rows.find((r) => r.upc && r.upc.replace(/\D/g, "").endsWith(upc.replace(/\D/g, "")));
  return hit?.lastUnitPrice;
}

function identityKind(item: SeedStapleItem): MappingKind {
  return seedMatchMode(item) === "preferred" ? "identity" : "staple_winner";
}

function seedNoFrills(
  item: SeedStapleItem,
  offer: SeedCatalogOffer,
): RetailerSkuLink {
  return link({
    retailer: NOFRILLS_RETAILER,
    storeId: NF_STORE,
    retailerProductId: offer.productId,
    name: offer.name,
    upc: upcFromOffer(offer),
    matchMethod: "seed_catalog",
    matchConfidence: 1,
    verified: false,
    decision: "auto_linked",
    kind: identityKind(item) === "identity" ? "identity" : "staple_winner",
  });
}

function lockedWalmart(input: {
  item: SeedStapleItem;
  productId: string;
  name?: string;
  upc?: string;
  verifiedAt?: string;
  method: MatchMethod;
}): RetailerSkuLink {
  return link({
    retailer: WALMART_RETAILER,
    storeId: WM_STORE,
    retailerProductId: input.productId,
    name: input.name,
    upc: input.upc,
    matchMethod: input.method,
    matchConfidence: 1,
    verified: true,
    verifiedAt: input.verifiedAt ?? nowIso(),
    decision: "auto_linked",
    kind: "identity",
    skippedRematch: true,
  });
}

function matchWalmartCatalog(input: {
  item: SeedStapleItem;
  nfOffer: SeedCatalogOffer;
  wmOffer: CatalogOfferLike;
  threshold: number;
}): RetailerSkuLink {
  const filter = offerFailsStapleFilters(input.item, input.wmOffer.name);
  if (filter) {
    return link({
      retailer: WALMART_RETAILER,
      storeId: WM_STORE,
      retailerProductId: input.wmOffer.productId,
      name: input.wmOffer.name,
      matchMethod: "none",
      matchConfidence: 0,
      verified: false,
      decision: "rejected",
      kind: "staple_winner",
      filterReason: filter,
      explain: [{ stage: "gate", score: 0, reason: filter }],
    });
  }

  const brand = stapleBrandHint(input.item);
  const left = catalogOfferToRecord({
    retailer: NOFRILLS_RETAILER,
    offer: input.nfOffer,
    category: input.item.category,
    brandHint: brand,
    upc: upcFromOffer(input.nfOffer),
  });
  const right = catalogOfferToRecord({
    retailer: WALMART_RETAILER,
    offer: input.wmOffer,
    category: input.item.category,
    brandHint: input.wmOffer.brand ?? brand,
    upc: upcFromOffer(input.wmOffer),
  });
  const result = matchProducts(left, right, { threshold: input.threshold });
  const cheapest = seedMatchMode(input.item) === "cheapest";
  let decision: MatchDecision = result.decision;
  let kind: MappingKind = cheapest ? "staple_winner" : "identity";
  if (cheapest && decision === "auto_linked" && result.matchMethod !== "upc") {
    decision = "needs_review";
    kind = "staple_winner";
  }
  return link({
    retailer: WALMART_RETAILER,
    storeId: WM_STORE,
    retailerProductId: input.wmOffer.productId,
    name: input.wmOffer.name,
    upc: right.upc,
    matchMethod: result.matchMethod,
    matchConfidence: result.matchConfidence,
    verified: result.verified,
    decision,
    kind,
    explain: result.explain,
  });
}

function priceRow(input: {
  retailer: string;
  storeId: string;
  offer?: CatalogOfferLike | null;
  source: string;
  priceConfidence: PriceConfidence;
}): MappedPrice {
  return {
    retailer: input.retailer,
    storeId: input.storeId,
    retailerProductId: input.offer?.productId,
    price: input.offer?.price,
    availability: input.offer?.availability,
    checkedAt: input.offer?.checkedAt,
    source: input.source,
    priceConfidence: input.priceConfidence,
  };
}

export interface SeedMatchSummary {
  threshold: number;
  seeded: number;
  skippedRematch: number;
  autoLinkedIdentity: number;
  needsReview: number;
  rejected: number;
  masterIdsAreStaples: boolean;
  nfSkuUsedAsMaster: string[];
  products: number;
}

export async function runSeedAndMatch(): Promise<{
  store: RetailerMappingStore;
  summary: SeedMatchSummary;
}> {
  const threshold = AUTO_LINK_THRESHOLD;
  const items = await loadSeedStaples();
  const nfCat = await loadSeedCatalog("data/catalog/nofrills_3660_latest.json");
  const wmCat = await loadSeedCatalog("data/catalog/walmart_5831_latest.json");
  const confirmed = await loadSeedConfirmed();
  const receipts = await loadSeedReceipts();
  const prev = await loadRetailerMappings();

  const nfById = new Map((nfCat?.items ?? []).map((r) => [r.id, r]));
  const wmById = new Map((wmCat?.items ?? []).map((r) => [r.id, r]));

  const store: RetailerMappingStore = {
    updatedAt: nowIso(),
    autoLinkThreshold: threshold,
    note: prev.note || "masterId is the cafe staple id, not a No Frills or Walmart SKU",
    products: {},
  };

  let seeded = 0;
  let skippedRematch = 0;
  let autoLinkedIdentity = 0;
  let needsReview = 0;
  let rejected = 0;
  const nfSkuUsedAsMaster: string[] = [];

  const ids = items.map((i) => i.id).filter((id) => nfById.has(id) || wmById.has(id));

  for (const masterId of ids) {
    const item = items.find((i) => i.id === masterId);
    if (!item) continue;
    if (isNoFrillsRetailerSku(masterId)) nfSkuUsedAsMaster.push(masterId);

    const nfRow = nfById.get(masterId);
    const wmRow = wmById.get(masterId);
    const nfOffer = nfRow?.status === "ok" ? nfRow.offer : null;
    const wmOffer = wmRow?.status === "ok" ? wmRow.offer : null;
    if (!nfOffer && !wmOffer) continue;

    const existing = prev.products[masterId];
    const existingWm = existing?.retailers[WALMART_RETAILER];

    const retailers: Record<string, RetailerSkuLink> = {};

    if (nfOffer) {
      retailers[NOFRILLS_RETAILER] = seedNoFrills(item, nfOffer);
      seeded += 1;
    }

    const conf = lookupConfirmedRow(confirmed, masterId);
    const rec = receiptLock(receipts, masterId);
    const preferred = item.preferredProductId;

    if (isVerifiedLink(existingWm)) {
      retailers[WALMART_RETAILER] = {
        ...existingWm,
        skippedRematch: true,
        updatedAt: existingWm.updatedAt,
      };
      skippedRematch += 1;
    } else if (conf?.productId) {
      retailers[WALMART_RETAILER] = lockedWalmart({
        item,
        productId: conf.productId,
        name: conf.label,
        method: "locked_sku",
        verifiedAt: conf.confirmedAt,
      });
      skippedRematch += 1;
    } else if (preferred) {
      retailers[WALMART_RETAILER] = lockedWalmart({
        item,
        productId: preferred,
        name: wmOffer?.name,
        upc: rec?.upc,
        method: "locked_sku",
      });
      skippedRematch += 1;
    } else if (rec?.productId) {
      retailers[WALMART_RETAILER] = lockedWalmart({
        item,
        productId: rec.productId,
        name: rec.name,
        upc: rec.upc,
        method: "manual_mapping",
      });
      skippedRematch += 1;
    } else if (wmOffer && nfOffer) {
      retailers[WALMART_RETAILER] = matchWalmartCatalog({
        item,
        nfOffer,
        wmOffer: wmOffer as CatalogOfferLike,
        threshold,
      });
    } else if (wmOffer) {
      retailers[WALMART_RETAILER] = link({
        retailer: WALMART_RETAILER,
        storeId: WM_STORE,
        retailerProductId: wmOffer.productId,
        name: wmOffer.name,
        matchMethod: "seed_catalog",
        matchConfidence: 0.5,
        verified: false,
        decision: "needs_review",
        kind: "staple_winner",
        explain: [
          {
            stage: "gate",
            score: 0.5,
            reason: "Walmart catalog winner without No Frills seed to score against",
          },
        ],
      });
    }

    const wmLink = retailers[WALMART_RETAILER];
    if (wmLink?.decision === "auto_linked" && wmLink.kind === "identity") {
      autoLinkedIdentity += 1;
    } else if (wmLink?.decision === "needs_review") {
      needsReview += 1;
    } else if (wmLink?.decision === "rejected") {
      rejected += 1;
    }

    const identityLinked =
      isLockedIdentityLink(wmLink) ||
      (wmLink?.kind === "identity" && wmLink.decision === "auto_linked");

    const wmPriceOffer = wmLink
      ? findOfferForSku(wmRow ?? undefined, wmLink.retailerProductId) ??
        (wmLink.kind === "staple_winner" ? wmOffer : null)
      : wmOffer;

    const nfAge = ageHours(nfOffer?.checkedAt);
    const wmAge = ageHours(wmPriceOffer?.checkedAt);
    const recPrice = receiptPriceFor(
      receipts,
      rec?.upc ?? wmLink?.upc,
    );

    const prices: MappedPrice[] = [];
    if (nfOffer) {
      prices.push(
        priceRow({
          retailer: NOFRILLS_RETAILER,
          storeId: NF_STORE,
          offer: nfOffer,
          source: "catalog_nofrills_3660_latest",
          priceConfidence: assignPriceConfidence({
            hasLiveOffer: true,
            offerConfidence: nfOffer.confidence,
            ageHours: nfAge,
            staleAfterHours: SEED_STALE_HOURS,
            hasReceiptPrice: false,
            livePrice: nfOffer.price,
            otherLivePrice: wmPriceOffer?.price,
            identityLinked,
          }),
        }),
      );
    }
    if (wmPriceOffer) {
      prices.push(
        priceRow({
          retailer: WALMART_RETAILER,
          storeId: WM_STORE,
          offer: wmPriceOffer,
          source: "catalog_walmart_5831_latest",
          priceConfidence: assignPriceConfidence({
            hasLiveOffer: true,
            offerConfidence: wmPriceOffer.confidence,
            ageHours: wmAge,
            staleAfterHours: SEED_STALE_HOURS,
            hasReceiptPrice: recPrice != null,
            receiptPrice: recPrice,
            livePrice: wmPriceOffer.price,
            otherLivePrice: nfOffer?.price,
            identityLinked,
          }),
        }),
      );
    }

    const row: MasterProductMapping = {
      masterId,
      label: item.label,
      category: item.category,
      retailers,
      prices,
    };
    store.products[masterId] = row;
  }

  await saveRetailerMappings(store);

  return {
    store,
    summary: {
      threshold,
      seeded,
      skippedRematch,
      autoLinkedIdentity,
      needsReview,
      rejected,
      masterIdsAreStaples: nfSkuUsedAsMaster.length === 0,
      nfSkuUsedAsMaster,
      products: Object.keys(store.products).length,
    },
  };
}

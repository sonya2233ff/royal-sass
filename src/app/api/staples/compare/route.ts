import { NextResponse } from "next/server";
import { walmartSourceApiFields } from "@/connectors/walmart-source";
import {
  appendMatchLog,
  CACHE_STALE_HOURS,
  evaluateOfferStatus,
  shownStaples,
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  pickStapleOfferWithAlternate,
  searchNoFrillsPool,
  searchWalmartPackPool,
  searchWalmartQueryPool,
  catalogOfferFromLive,
  defaultNeededGrams,
  isSoldByWeightItem,
  isEggPackItem,
  eggCartonCountOk,
  resolveMatchMode,
  explicitNeededGrams,
  type CatalogOffer,
  type MatchLogEntry,
  type StapleItem,
} from "@/lib/staples";
import { offerIsOnShelf, resolveCatalogOffer, catalogCandidates, catalogRowForStaple } from "@/domain/compare-resolve";
import { pickCheapestCoveringOffer } from "@/domain/checkout";
import { buildStapleCompareRow } from "@/lib/staple-compare-row";
import {
  mergeLivePackSizes,
  packSizeNotes,
  persistPackSizeRow,
  shouldExpandPackSizes,
} from "@/lib/expand-pack-sizes";
import {
  loadRetailerMappings,
  lookupConfirmed,
  type RetailerSkuLink,
} from "@/lib/retailer-mappings";
import { loadWholesaleClubCatalog } from "@/lib/wholesaleclub-catalog";
import { searchWholesaleClubPool } from "@/lib/wholesaleclub-observe";
import { loadMvrCatalog } from "@/lib/mvr-catalog";
import { searchMvrPool } from "@/lib/mvr-observe";
import { recordCompareResult } from "@/lib/compare-stats";
import { parseOverrideMap, parseCustomStapleDrafts, effectiveProduct } from "@/lib/product-config";
import { offerFailsStapleOfferFilters } from "@/domain/catalog-normalize";
import { offerMatchesIdentity } from "@/domain/product-identity";
import { stapleWithClientOverride, type Cart } from "@/domain/restaurant-product";
import {
  asAlternateStapleView,
  hasCategoryAAlternate,
  pickCategoryAPrimaryOrAlternate,
} from "@/domain/category-a-alternate";
import {
  completeBasketWinner,
  storeCoverage,
} from "@/domain/basket-coverage";
import {
  linesFromBasketRows,
  recommendPurchasePlans,
} from "@/domain/purchase-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function coveringPackedOffer(
  item: StapleItem,
  product: Parameters<typeof pickCheapestCoveringOffer>[0],
  requested: number,
  row: Parameters<typeof catalogCandidates>[0],
  fallback: CatalogOffer | null,
  matchMode: "preferred" | "cheapest",
): CatalogOffer | null {
  if (!row) return fallback;
  if (matchMode === "cheapest" && !isEggPackItem(item)) return fallback;
  const pool = catalogCandidates(row)
    .filter(offerIsOnShelf)
    .filter((o) => offerFailsStapleOfferFilters(item, o) == null)
    .filter((o) => eggCartonCountOk(item, o.name, o.packageSize));
  const identPool = isEggPackItem(item)
    ? pool
    : pool.filter((o) => offerMatchesIdentity({ product, offer: o }).ok);
  const picked = pickCheapestCoveringOffer(
    product,
    requested,
    identPool.length ? identPool : pool,
  );
  if (!hasCategoryAAlternate(item)) {
    return picked ? toCatalogOffer(picked) : fallback;
  }
  const alt = asAlternateStapleView(item);
  const altPool = catalogCandidates(row)
    .filter(offerIsOnShelf)
    .filter((o) =>
      alt ? offerFailsStapleOfferFilters(alt, o) == null : false,
    )
    .filter((o) => eggCartonCountOk(item, o.name, o.packageSize));
  const altCover = pickCheapestCoveringOffer(product, requested, altPool);
  const chosen = pickCategoryAPrimaryOrAlternate(
    item,
    picked ?? fallback,
    altCover,
  );
  return chosen ? toCatalogOffer(chosen) : fallback;
}

function coveringFromLivePool(
  item: StapleItem,
  product: Parameters<typeof pickCheapestCoveringOffer>[0],
  requested: number,
  pool: Array<{
    productId: string;
    name: string;
    price: number;
    packageSize?: string;
    parsedMassKg?: number;
    brand?: string;
    image?: string | null;
    sourceUrl?: string;
    upc?: string;
  }>,
): { offer: CatalogOffer | null; alternates: CatalogOffer[] } {
  const passing = pool
    .filter((o) => o.price > 0)
    .filter((o) => offerFailsStapleOfferFilters(item, o) == null)
    .filter((o) => eggCartonCountOk(item, o.name, o.packageSize))
    .filter((o) => offerMatchesIdentity({ product, offer: o }).ok)
    .map((o) => toCatalogOffer({ ...o, image: o.image ?? undefined }))
    .filter((o): o is CatalogOffer => o != null);
  const picked = pickCheapestCoveringOffer(product, requested, passing);
  if (!hasCategoryAAlternate(item)) {
    if (!picked) return { offer: null, alternates: passing };
    return {
      offer: toCatalogOffer(picked),
      alternates: passing.filter((o) => o.productId !== picked.productId),
    };
  }
  const alt = asAlternateStapleView(item);
  const altPassing = pool
    .filter((o) => o.price > 0)
    .filter((o) =>
      alt ? offerFailsStapleOfferFilters(alt, o) == null : false,
    )
    .filter((o) => eggCartonCountOk(item, o.name, o.packageSize))
    .map((o) => toCatalogOffer({ ...o, image: o.image ?? undefined }))
    .filter((o): o is CatalogOffer => o != null);
  const altCover = pickCheapestCoveringOffer(product, requested, altPassing);
  const chosen = pickCategoryAPrimaryOrAlternate(item, picked, altCover);
  const extras = [
    ...passing.filter((o) => o.productId !== chosen?.productId),
    ...altPassing.filter((o) => o.productId !== chosen?.productId),
  ];
  return {
    offer: chosen ? toCatalogOffer(chosen) : null,
    alternates: extras,
  };
}

function toCatalogOffer(
  offer: {
    productId: string;
    name: string;
    price: number;
    packageSize?: string;
    parsedMassKg?: number;
    unitPrice?: number;
    wasPrice?: number;
    onSale?: boolean;
    confidence?: string;
    checkedAt?: string;
    sourceUrl?: string;
    brand?: string;
    image?: string;
  } | null,
): CatalogOffer | null {
  if (!offer) return null;
  return {
    productId: offer.productId,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    parsedMassKg: offer.parsedMassKg,
    unitPrice: offer.unitPrice,
    wasPrice: offer.wasPrice,
    onSale: offer.onSale,
    confidence: offer.confidence,
    checkedAt: offer.checkedAt,
    sourceUrl: offer.sourceUrl,
    brand: offer.brand,
    image: offer.image,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: string[];
    refreshNoFrills?: boolean;
    grams?: Record<string, number>;
    qty?: Record<string, number>;
    cart?: Cart;
    productOverrides?: unknown;
    customStaples?: unknown;
  };
  const extras = parseCustomStapleDrafts(body.customStaples);
  const cfg = await loadStaplesConfig(extras);
  const overrides = parseOverrideMap(body.productOverrides);
  const allowed = new Set(
    (await shownStaples(cfg.items)).map((i) => i.id),
  );
  const cartIds = body.cart ? Object.keys(body.cart) : [];
  const wanted = (cartIds.length
    ? cartIds
    : body.ids?.length
      ? body.ids
      : [...allowed]
  ).filter((id) => allowed.has(id));

  const catalog = await loadWalmartCatalog();
  const nfCatalog = await loadNoFrillsCatalog();
  const wcCatalog = await loadWholesaleClubCatalog();
  const mvrCatalog = await loadMvrCatalog();
  const confirmed = await loadConfirmed();
  const mappings = await loadRetailerMappings();
  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const catById = new Map(catalog?.items.map((i) => [i.id, i]) ?? []);
  const nfById = new Map(nfCatalog?.items.map((i) => [i.id, i]) ?? []);
  const wcById = new Map(wcCatalog?.items.map((i) => [i.id, i]) ?? []);
  const mvrById = new Map(mvrCatalog?.items.map((i) => [i.id, i]) ?? []);

  const entries: MatchLogEntry[] = [];
  const rows = [];
  let nfLiveHits = 0;
  let nfCacheHits = 0;
  let wcLiveHits = 0;
  let wcCacheHits = 0;
  let mvrLiveHits = 0;
  let mvrCacheHits = 0;

  for (const id of wanted) {
    const raw = byId.get(id);
    if (!raw) continue;

    const ov = overrides[id];
    const conf = lookupConfirmed(confirmed, id);
    const item = stapleWithClientOverride({ ...raw }, ov);
    if (conf?.productId) {
      item.preferredProductId = conf.productId;
    }

    const mode = resolveMatchMode(item);
    const productMap = mappings.products[id];
    const withConfirm = (
      link: RetailerSkuLink | undefined,
      retailer: string,
    ): RetailerSkuLink | undefined => {
      const pid = ov?.confirmedStoreProducts?.[retailer];
      if (pid) {
        return {
          retailer,
          storeId: link?.storeId ?? "",
          retailerProductId: pid,
          matchMethod: "manual_mapping",
          matchConfidence: 1,
          verified: true,
          decision: "auto_linked",
          kind: "identity",
          updatedAt: new Date().toISOString(),
        };
      }
      if (ov?.needsReview && link) {
        return { ...link, decision: "needs_review", verified: false };
      }
      return link;
    };
    const wmLink = withConfirm(productMap?.retailers.walmart_ca, "walmart_ca");
    const nfLink = withConfirm(productMap?.retailers.nofrills, "no_frills");
    const wcLink = withConfirm(productMap?.retailers.wholesaleclub, "wholesale_club");
    const mvrLink = withConfirm(productMap?.retailers.mvr, "mvr");

    const rawGrams = Number(body.grams?.[id]);
    const soldByWeight = isSoldByWeightItem(item);
    const product = effectiveProduct(
      { ...item, soldByWeight },
      overrides[id],
    );
    if (overrides[id]?.preferredProductId) {
      item.preferredProductId = overrides[id]!.preferredProductId;
    }
    const packPickGrams = explicitNeededGrams(item, rawGrams);
    const cartItem = body.cart?.[id];
    const requestedAmount =
      cartItem?.requestedAmount != null && cartItem.requestedAmount > 0
        ? cartItem.requestedAmount
        : product.defaultAmount;
    const grams = soldByWeight
      ? product.unit === "g"
        ? requestedAmount
        : product.unit === "kg"
          ? requestedAmount * 1000
          : Number.isFinite(rawGrams) && rawGrams > 0
            ? rawGrams
            : defaultNeededGrams(item)
      : packPickGrams ??
        (product.unit === "g" ? requestedAmount : null);

    let wmRow = catalogRowForStaple(item, catById);
    let wmResolved = resolveCatalogOffer({
      item,
      row: wmRow,
      link: wmLink,
      matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });

    const wmLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "walmart_ca",
      queries: wmRow ? ["catalog_cache"] : [],
      rejected: [],
      status: "no_match",
    };
    if (
      shouldExpandPackSizes({
        item,
        neededGrams: packPickGrams,
        link: wmLink,
        row: wmRow,
      })
    ) {
      const pool = await searchWalmartPackPool(item, wmLog);
      if (pool.length) {
        const merged = mergeLivePackSizes({
          item,
          row: wmRow,
          live: pool,
          keepProductId: offerIsOnShelf(wmRow?.offer)
            ? wmRow?.offer?.productId
            : undefined,
        });
        await persistPackSizeRow({
          retailer: "walmart_ca",
          id,
          label: item.label,
          offer: merged.offer,
          alternates: merged.alternates,
          notes: packSizeNotes(
            "walmart_ca",
            1 + merged.alternates.length,
          ),
          image: item.image,
        });
        wmRow = {
          id,
          status: merged.offer ? "ok" : "no_match",
          offer: merged.offer,
          alternates: merged.alternates,
        };
        catById.set(id, wmRow);
        wmResolved = resolveCatalogOffer({
          item,
          row: wmRow,
          link: wmLink,
          matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
      }
    }

    if (
      !item.unavailableAtWalmart &&
      mode === "preferred" &&
      (!wmResolved.offer || !offerIsOnShelf(wmResolved.offer))
    ) {
      const pool = await searchWalmartQueryPool(item, wmLog);
      const best = pickStapleOfferWithAlternate(item, pool, wmLog);
      if (best) {
        const offer = catalogOfferFromLive(best);
        const others = pool
          .filter((o) => o.productId !== best.productId)
          .slice(0, 8)
          .map(catalogOfferFromLive);
        await persistPackSizeRow({
          retailer: "walmart_ca",
          id,
          label: item.label,
          offer,
          alternates: others,
          notes: `Nearest alternate — locked SKU not on the shelf`,
          image: item.image,
        });
        wmRow = {
          id,
          status: "ok",
          offer,
          alternates: others,
        };
        catById.set(id, wmRow);
        wmResolved = resolveCatalogOffer({
          item,
          row: wmRow,
          link: wmLink,
          matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
      }
    }

    const wmOffer = toCatalogOffer(wmResolved.offer);
    const wmEval = evaluateOfferStatus(item, wmOffer, {
      unavailable: item.unavailableAtWalmart,
      catalogStatus:
        wmResolved.reason === "mapped_sku_missing" ||
        wmResolved.reason === "rejected_filter"
          ? "no_match"
          : wmRow?.status,
    });
    if (wmResolved.reason === "mapped_sku_missing") {
      wmEval.status = "no_match";
      wmEval.reason = wmResolved.detail;
    } else if (wmResolved.reason === "rejected_filter") {
      wmEval.status = "rejected";
      wmEval.reason = wmResolved.detail;
    }

    const wmUsable =
      Boolean(wmOffer) &&
      (wmEval.status === "ok" || wmEval.status === "stale") &&
      wmRow?.status !== "unavailable";
    wmLog.status = wmEval.status;
    if (wmUsable && wmOffer) {
      wmLog.accepted = {
        productId: wmOffer.productId,
        name: wmOffer.name,
        price: wmOffer.price,
      };
    } else {
      wmLog.rejected.push({
        reason: wmEval.reason ?? wmResolved.detail ?? wmEval.status,
        productId: wmRow?.offer?.productId,
        name: wmRow?.offer?.name,
        price: wmRow?.offer?.price,
      });
    }
    entries.push(wmLog);

    let nfRow = catalogRowForStaple(item, nfById);
    let nfResolved = resolveCatalogOffer({
      item,
      row: nfRow,
      link: nfLink,
      matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
    const nfCacheEval = evaluateOfferStatus(item, nfResolved.offer, {
      catalogStatus:
        nfResolved.reason === "rejected_filter"
          ? "no_match"
          : nfRow?.status,
    });
    const needNfExpand = shouldExpandPackSizes({
      item,
      neededGrams: packPickGrams,
      link: nfLink,
      row: nfRow,
    });
    const nfCacheUsable =
      !body.refreshNoFrills &&
      !needNfExpand &&
      Boolean(nfResolved.offer) &&
      (nfCacheEval.status === "ok" || nfCacheEval.status === "stale");

    const nfLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "no_frills",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    let nfOfferUpc: string | undefined;
    let nfCatalogOffer: CatalogOffer | null = null;
    if (nfCacheUsable && nfResolved.offer) {
      nfCacheHits += 1;
      nfCatalogOffer = toCatalogOffer(nfResolved.offer);
      nfLog.queries = ["catalog_cache"];
      nfLog.status = nfCacheEval.status;
      nfLog.accepted = {
        productId: nfResolved.offer.productId,
        name: nfResolved.offer.name,
        price: nfResolved.offer.price,
      };
    } else if (
      body.refreshNoFrills ||
      !nfRow?.offer ||
      !nfResolved.offer ||
      needNfExpand
    ) {
      const pool = await searchNoFrillsPool(item, nfLog);
      nfLiveHits += 1;
      const best = pickStapleOfferWithAlternate(item, pool, nfLog);
      if (pool.length || best) {
        const merged = mergeLivePackSizes({
          item,
          row: nfRow,
          live: pool,
          keepProductId: body.refreshNoFrills
            ? best?.productId
            : (nfRow?.offer?.productId ?? best?.productId),
        });
        const covering =
          mode === "preferred"
            ? coveringFromLivePool(item, product, requestedAmount, pool)
            : { offer: null as CatalogOffer | null, alternates: [] as CatalogOffer[] };
        const offer =
          covering.offer ??
          merged.offer ??
          (best &&
          (mode !== "preferred" ||
            offerMatchesIdentity({ product, offer: best }).ok)
            ? catalogOfferFromLive(best)
            : null);
        const alternates = covering.offer
          ? covering.alternates
          : merged.alternates;
        await persistPackSizeRow({
          retailer: "no_frills",
          id,
          label: item.label,
          offer,
          alternates,
          notes:
            alternates.length > 0
              ? packSizeNotes("no_frills", 1 + alternates.length)
              : `Cached from live NF search (TTL ${CACHE_STALE_HOURS}h)`,
        });
        nfRow = {
          id,
          status: offer ? "ok" : "no_match",
          offer,
          alternates,
        };
        nfById.set(id, nfRow);
        nfResolved = resolveCatalogOffer({
          item,
          row: nfRow,
          link: nfLink,
          matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
        nfCatalogOffer = toCatalogOffer(nfResolved.offer);
        nfOfferUpc = best?.upc;
      } else if (nfRow?.offer && !body.refreshNoFrills) {
        nfCatalogOffer = toCatalogOffer(nfResolved.offer);
        nfLog.rejected.push({
          reason: "pack-size search missed — kept catalog offer",
        });
        if (nfResolved.offer) {
          nfLog.status = nfCacheEval.status;
          nfLog.accepted = {
            productId: nfResolved.offer.productId,
            name: nfResolved.offer.name,
            price: nfResolved.offer.price,
          };
        }
      } else {
        await persistPackSizeRow({
          retailer: "no_frills",
          id,
          label: item.label,
          offer: null,
          alternates: [],
          notes: nfLog.rejected.at(-1)?.reason ?? "no_match",
        });
      }
    } else {
      nfLog.queries = ["catalog_cache"];
      nfLog.status = "rejected";
      nfLog.rejected.push({
        productId: nfRow?.offer?.productId,
        name: nfRow?.offer?.name,
        price: nfRow?.offer?.price,
        reason: nfResolved.detail ?? "filter",
      });
    }
    entries.push(nfLog);

    const rawQty = Number(body.qty?.[id]);
    const qtyFromCart =
      cartItem && (product.unit === "pack" || product.unit === "ea")
        ? Math.max(1, Math.round(cartItem.requestedAmount))
        : null;
    const qty =
      qtyFromCart ??
      (!soldByWeight && Number.isFinite(rawQty) && rawQty > 0
        ? Math.max(1, Math.round(rawQty))
        : 1);

    const nfEval = nfCacheUsable
      ? nfCacheEval
      : nfCatalogOffer
        ? evaluateOfferStatus(item, nfCatalogOffer, {
            catalogStatus: nfRow?.status,
          })
        : {
            status: nfLog.status,
            reason: nfLog.rejected.at(-1)?.reason,
            ageLabel: null as string | null,
          };

    const nfUsable = Boolean(
      nfCatalogOffer &&
        (nfEval.status === "ok" || nfEval.status === "stale"),
    );

    let wcRow = catalogRowForStaple(item, wcById);
    let wcResolved = resolveCatalogOffer({
      item,
      row: wcRow,
      link: wcLink,
      matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
    const wcCacheEval = evaluateOfferStatus(item, wcResolved.offer, {
      catalogStatus:
        wcResolved.reason === "rejected_filter"
          ? "no_match"
          : wcRow?.status,
    });
    const needWcExpand = shouldExpandPackSizes({
      item,
      neededGrams: packPickGrams,
      link: wcLink,
      row: wcRow,
    });
    const wcCacheUsable =
      !needWcExpand &&
      Boolean(wcResolved.offer) &&
      (wcCacheEval.status === "ok" || wcCacheEval.status === "stale");

    const wcLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "wholesale_club",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    let wcCatalogOffer: CatalogOffer | null = null;
    if (wcCacheUsable && wcResolved.offer) {
      wcCacheHits += 1;
      wcCatalogOffer = toCatalogOffer(wcResolved.offer);
      wcLog.queries = ["catalog_cache"];
      wcLog.status = wcCacheEval.status;
      wcLog.accepted = {
        productId: wcResolved.offer.productId,
        name: wcResolved.offer.name,
        price: wcResolved.offer.price,
      };
    } else if (!wcRow?.offer || !wcResolved.offer || needWcExpand) {
      const pool = await searchWholesaleClubPool(item, wcLog);
      wcLiveHits += 1;
      const best = pickStapleOfferWithAlternate(item, pool, wcLog);
      if (pool.length || best) {
        const merged = mergeLivePackSizes({
          item,
          row: wcRow,
          live: pool,
          keepProductId: wcRow?.offer?.productId ?? best?.productId,
        });
        const covering =
          mode === "preferred"
            ? coveringFromLivePool(item, product, requestedAmount, pool)
            : { offer: null as CatalogOffer | null, alternates: [] as CatalogOffer[] };
        const offer =
          covering.offer ??
          merged.offer ??
          (best &&
          (mode !== "preferred" ||
            offerMatchesIdentity({ product, offer: best }).ok)
            ? catalogOfferFromLive(best)
            : null);
        const alternates = covering.offer
          ? covering.alternates
          : merged.alternates;
        await persistPackSizeRow({
          retailer: "wholesale_club",
          id,
          label: item.label,
          offer,
          alternates,
          notes:
            alternates.length > 0
              ? packSizeNotes("wholesale_club", 1 + alternates.length)
              : `Cached from live WC search (TTL ${CACHE_STALE_HOURS}h)`,
        });
        wcRow = {
          id,
          status: offer ? "ok" : "no_match",
          offer,
          alternates,
        };
        wcById.set(id, wcRow);
        wcResolved = resolveCatalogOffer({
          item,
          row: wcRow,
          link: wcLink,
          matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
        wcCatalogOffer = toCatalogOffer(wcResolved.offer);
      } else if (wcRow?.offer) {
        wcCatalogOffer = toCatalogOffer(wcResolved.offer);
        wcLog.rejected.push({
          reason: "pack-size search missed — kept catalog offer",
        });
        if (wcResolved.offer) {
          wcLog.status = wcCacheEval.status;
          wcLog.accepted = {
            productId: wcResolved.offer.productId,
            name: wcResolved.offer.name,
            price: wcResolved.offer.price,
          };
        }
      } else {
        await persistPackSizeRow({
          retailer: "wholesale_club",
          id,
          label: item.label,
          offer: null,
          alternates: [],
          notes: wcLog.rejected.at(-1)?.reason ?? "no_match",
        });
      }
    } else {
      wcLog.queries = ["catalog_cache"];
      wcLog.status = "rejected";
      wcLog.rejected.push({
        productId: wcRow?.offer?.productId,
        name: wcRow?.offer?.name,
        price: wcRow?.offer?.price,
        reason: wcResolved.detail ?? "filter",
      });
    }
    entries.push(wcLog);

    const wcEval = wcCacheUsable
      ? wcCacheEval
      : wcCatalogOffer
        ? evaluateOfferStatus(item, wcCatalogOffer, {
            catalogStatus: wcRow?.status,
          })
        : {
            status: wcLog.status,
            reason: wcLog.rejected.at(-1)?.reason,
            ageLabel: null as string | null,
          };
    const wcUsable = Boolean(
      wcCatalogOffer &&
        (wcEval.status === "ok" || wcEval.status === "stale"),
    );

    let mvrRow = catalogRowForStaple(item, mvrById);
    let mvrResolved = resolveCatalogOffer({
      item,
      row: mvrRow,
      link: mvrLink,
      matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
    const mvrCacheEval = evaluateOfferStatus(item, mvrResolved.offer, {
      catalogStatus:
        mvrResolved.reason === "rejected_filter"
          ? "no_match"
          : mvrRow?.status,
    });
    const needMvrExpand = shouldExpandPackSizes({
      item,
      neededGrams: packPickGrams,
      link: mvrLink,
      row: mvrRow,
    });
    const mvrCacheUsable =
      !needMvrExpand &&
      Boolean(mvrResolved.offer) &&
      (mvrCacheEval.status === "ok" || mvrCacheEval.status === "stale");

    const mvrLog: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "mvr",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    let mvrCatalogOffer: CatalogOffer | null = null;
    if (mvrCacheUsable && mvrResolved.offer) {
      mvrCacheHits += 1;
      mvrCatalogOffer = toCatalogOffer(mvrResolved.offer);
      mvrLog.queries = ["catalog_cache"];
      mvrLog.status = mvrCacheEval.status;
      mvrLog.accepted = {
        productId: mvrResolved.offer.productId,
        name: mvrResolved.offer.name,
        price: mvrResolved.offer.price,
      };
    } else if (!mvrRow?.offer || !mvrResolved.offer || needMvrExpand) {
      const pool = await searchMvrPool(item, mvrLog);
      mvrLiveHits += 1;
      const best = pickStapleOfferWithAlternate(item, pool, mvrLog);
      if (pool.length || best) {
        const merged = mergeLivePackSizes({
          item,
          row: mvrRow,
          live: pool,
          keepProductId: mvrRow?.offer?.productId ?? best?.productId,
        });
        const covering =
          mode === "preferred"
            ? coveringFromLivePool(item, product, requestedAmount, pool)
            : { offer: null as CatalogOffer | null, alternates: [] as CatalogOffer[] };
        const offer =
          covering.offer ??
          merged.offer ??
          (best &&
          (mode !== "preferred" ||
            offerMatchesIdentity({ product, offer: best }).ok)
            ? catalogOfferFromLive(best)
            : null);
        const alternates = covering.offer
          ? covering.alternates
          : merged.alternates;
        await persistPackSizeRow({
          retailer: "mvr",
          id,
          label: item.label,
          offer,
          alternates,
          notes:
            alternates.length > 0
              ? packSizeNotes("mvr", 1 + alternates.length)
              : `Cached from live MVR search (TTL ${CACHE_STALE_HOURS}h)`,
        });
        mvrRow = {
          id,
          status: offer ? "ok" : "no_match",
          offer,
          alternates,
        };
        mvrById.set(id, mvrRow);
        mvrResolved = resolveCatalogOffer({
          item,
          row: mvrRow,
          link: mvrLink,
          matchMode: mode,
        neededGrams: packPickGrams,
        product,
        requested: requestedAmount,
      });
        mvrCatalogOffer = toCatalogOffer(mvrResolved.offer);
      } else if (mvrRow?.offer) {
        mvrCatalogOffer = toCatalogOffer(mvrResolved.offer);
        mvrLog.rejected.push({
          reason: "pack-size search missed — kept catalog offer",
        });
        if (mvrResolved.offer) {
          mvrLog.status = mvrCacheEval.status;
          mvrLog.accepted = {
            productId: mvrResolved.offer.productId,
            name: mvrResolved.offer.name,
            price: mvrResolved.offer.price,
          };
        }
      } else {
        await persistPackSizeRow({
          retailer: "mvr",
          id,
          label: item.label,
          offer: null,
          alternates: [],
          notes: mvrLog.rejected.at(-1)?.reason ?? "no_match",
        });
      }
    } else {
      mvrLog.queries = ["catalog_cache"];
      mvrLog.status = "rejected";
      mvrLog.rejected.push({
        productId: mvrRow?.offer?.productId,
        name: mvrRow?.offer?.name,
        price: mvrRow?.offer?.price,
        reason: mvrResolved.detail ?? "filter",
      });
    }
    entries.push(mvrLog);

    const mvrEval = mvrCacheUsable
      ? mvrCacheEval
      : mvrCatalogOffer
        ? evaluateOfferStatus(item, mvrCatalogOffer, {
            catalogStatus: mvrRow?.status,
          })
        : {
            status: mvrLog.status,
            reason: mvrLog.rejected.at(-1)?.reason,
            ageLabel: null as string | null,
          };
    const mvrUsable = Boolean(
      mvrCatalogOffer &&
        (mvrEval.status === "ok" || mvrEval.status === "stale"),
    );

    const wmCompare = coveringPackedOffer(
      item,
      product,
      requestedAmount,
      wmRow,
      wmUsable ? wmOffer : null,
      mode,
    );
    const nfCompare = coveringPackedOffer(
      item,
      product,
      requestedAmount,
      nfRow,
      nfUsable ? nfCatalogOffer : null,
      mode,
    );
    const wcCompare = coveringPackedOffer(
      item,
      product,
      requestedAmount,
      wcRow,
      wcUsable ? wcCatalogOffer : null,
      mode,
    );
    const mvrCompare = coveringPackedOffer(
      item,
      product,
      requestedAmount,
      mvrRow,
      mvrUsable ? mvrCatalogOffer : null,
      mode,
    );
    const wmEggEval = wmCompare
      ? evaluateOfferStatus(item, wmCompare, {
          unavailable: item.unavailableAtWalmart,
          catalogStatus: wmRow?.status,
        })
      : wmEval;
    const nfEggEval = nfCompare
      ? evaluateOfferStatus(item, nfCompare, { catalogStatus: nfRow?.status })
      : nfEval;
    const wcEggEval = wcCompare
      ? evaluateOfferStatus(item, wcCompare, { catalogStatus: wcRow?.status })
      : wcEval;
    const mvrEggEval = mvrCompare
      ? evaluateOfferStatus(item, mvrCompare, { catalogStatus: mvrRow?.status })
      : mvrEval;
    const wmEggUsable = Boolean(
      wmCompare && (wmEggEval.status === "ok" || wmEggEval.status === "stale"),
    );
    const nfEggUsable = Boolean(
      nfCompare && (nfEggEval.status === "ok" || nfEggEval.status === "stale"),
    );
    const wcEggUsable = Boolean(
      wcCompare && (wcEggEval.status === "ok" || wcEggEval.status === "stale"),
    );
    const mvrEggUsable = Boolean(
      mvrCompare && (mvrEggEval.status === "ok" || mvrEggEval.status === "stale"),
    );

    rows.push(
      buildStapleCompareRow({
        item,
        wmOffer: wmEggUsable ? wmCompare : null,
        nfOffer: nfEggUsable ? nfCompare : null,
        wcOffer: wcEggUsable ? wcCompare : null,
        mvrOffer: mvrEggUsable ? mvrCompare : null,
        wmEval: wmEggEval,
        nfEval: nfEggEval,
        wcEval: wcEggEval,
        mvrEval: mvrEggEval,
        wmUsable: wmEggUsable,
        nfUsable: nfEggUsable,
        wcUsable: wcEggUsable,
        mvrUsable: mvrEggUsable,
        grams,
        qty,
        requestedAmount,
        productOverride: overrides[id],
        confirmedStoreProducts: overrides[id]?.confirmedStoreProducts,
        confirmed: Boolean(conf),
        mappingDecision: wmLink?.decision,
        resolveReason: {
          walmart: wmResolved.reason,
          noFrills: nfResolved.reason,
          wholesaleClub: wcResolved.reason,
          mvr: mvrResolved.reason,
        },
        nfUpc: nfOfferUpc,
      }),
    );
  }

  const roundMoney = (n: number) => Math.round(n * 100) / 100;
  const basketWinner = (
    parts: Array<{ id: string; total: number }>,
  ): string => {
    if (!parts.length) return "incomplete";
    const min = Math.min(...parts.map((b) => b.total));
    const winners = parts.filter((b) => Math.abs(b.total - min) < 0.005);
    return winners.length === 1 ? winners[0].id : "tie";
  };

  // WM vs NF totals stay on rows both stores can price (same as the 2-store POC).
  const wmNfRows = rows.filter(
    (r) => r.basketWalmart != null && r.basketNoFrills != null,
  );
  const wmSum = wmNfRows.reduce((s, r) => s + (r.basketWalmart ?? 0), 0);
  const nfSum = wmNfRows.reduce((s, r) => s + (r.basketNoFrills ?? 0), 0);
  const cheaperTwoWay = basketWinner([
    { id: "walmart", total: wmSum },
    { id: "nofrills", total: nfSum },
  ]);

  // 3-store overall uses the intersection so a missing WC SKU is not $0.
  const tripleRows = rows.filter(
    (r) =>
      r.basketWalmart != null &&
      r.basketNoFrills != null &&
      r.basketWholesaleClub != null,
  );
  const tripleWm = tripleRows.reduce((s, r) => s + (r.basketWalmart ?? 0), 0);
  const tripleNf = tripleRows.reduce((s, r) => s + (r.basketNoFrills ?? 0), 0);
  const tripleWc = tripleRows.reduce(
    (s, r) => s + (r.basketWholesaleClub ?? 0),
    0,
  );
  const wcAllRows = rows.filter((r) => r.basketWholesaleClub != null);
  const wcAllSum = wcAllRows.reduce(
    (s, r) => s + (r.basketWholesaleClub ?? 0),
    0,
  );
  const cheaperThree =
    tripleRows.length > 0
      ? basketWinner([
          { id: "walmart", total: tripleWm },
          { id: "nofrills", total: tripleNf },
          { id: "wholesaleclub", total: tripleWc },
        ])
      : cheaperTwoWay;

  const quadRows = rows.filter(
    (r) =>
      r.basketWalmart != null &&
      r.basketNoFrills != null &&
      r.basketWholesaleClub != null &&
      r.basketMvr != null,
  );
  const quadWm = quadRows.reduce((s, r) => s + (r.basketWalmart ?? 0), 0);
  const quadNf = quadRows.reduce((s, r) => s + (r.basketNoFrills ?? 0), 0);
  const quadWc = quadRows.reduce(
    (s, r) => s + (r.basketWholesaleClub ?? 0),
    0,
  );
  const quadMvr = quadRows.reduce((s, r) => s + (r.basketMvr ?? 0), 0);
  const mvrAllRows = rows.filter((r) => r.basketMvr != null);
  const mvrAllSum = mvrAllRows.reduce((s, r) => s + (r.basketMvr ?? 0), 0);
  const cheaperFour =
    quadRows.length > 0
      ? basketWinner([
          { id: "walmart", total: quadWm },
          { id: "nofrills", total: quadNf },
          { id: "wholesaleclub", total: quadWc },
          { id: "mvr", total: quadMvr },
        ])
      : cheaperThree;

  const wmCov = storeCoverage(rows.map((r) => r.basketWalmart));
  const nfCov = storeCoverage(rows.map((r) => r.basketNoFrills));
  const wcCov = storeCoverage(rows.map((r) => r.basketWholesaleClub));
  const mvrCov = storeCoverage(rows.map((r) => r.basketMvr));
  const cheaperOverall = completeBasketWinner([
    { id: "walmart", coverage: wmCov },
    { id: "nofrills", coverage: nfCov },
    { id: "wholesaleclub", coverage: wcCov },
    { id: "mvr", coverage: mvrCov },
  ]);
  const completeParts = [
    { id: "walmart", total: wmCov.checkoutTotal },
    { id: "nofrills", total: nfCov.checkoutTotal },
    { id: "wholesaleclub", total: wcCov.checkoutTotal },
    { id: "mvr", total: mvrCov.checkoutTotal },
  ].filter((p): p is { id: string; total: number } => p.total != null);
  const incompleteItems = rows
    .filter(
      (r) =>
        r.basketWalmart == null ||
        r.basketNoFrills == null ||
        r.basketWholesaleClub == null ||
        r.basketMvr == null,
    )
    .map((r) => ({
      id: r.id,
      label: r.label,
      missing: [
        r.basketWalmart == null ? "Walmart" : null,
        r.basketNoFrills == null ? "No Frills" : null,
        r.basketWholesaleClub == null ? "Wholesale Club" : null,
        r.basketMvr == null ? "MVR" : null,
      ].filter(Boolean),
    }));

  const logId = await appendMatchLog(entries);
  const comparedAt = new Date().toISOString();
  const purchasePlans = recommendPurchasePlans(linesFromBasketRows(rows));
  const totals = {
    completeCount: wmNfRows.length,
    requestedItems: rows.length,
    walmart: wmCov.checkoutTotal,
    noFrills: nfCov.checkoutTotal,
    wholesaleClub: wcCov.checkoutTotal,
    mvr: mvrCov.checkoutTotal,
    walmartComplete: wmCov,
    noFrillsComplete: nfCov,
    wholesaleClubComplete: wcCov,
    mvrComplete: mvrCov,
    cheaper: cheaperOverall,
    cheaperTwoWay,
    cheaperThree,
    tripleCount: tripleRows.length,
    tripleWalmart: roundMoney(tripleWm),
    tripleNoFrills: roundMoney(tripleNf),
    tripleWholesaleClub: roundMoney(tripleWc),
    wholesaleClubItemCount: wcAllRows.length,
    quadCount: quadRows.length,
    quadWalmart: roundMoney(quadWm),
    quadNoFrills: roundMoney(quadNf),
    quadWholesaleClub: roundMoney(quadWc),
    quadMvr: roundMoney(quadMvr),
    mvrItemCount: mvrAllRows.length,
    incompleteItems,
    note:
      cheaperOverall === "incomplete"
        ? `Немає повного кошика в жодному магазині. Покриття: WM ${wmCov.coverage}, NF ${nfCov.coverage}, WC ${wcCov.coverage}, MVR ${mvrCov.coverage}. Missing ≠ $0.`
        : completeParts.length === 1
          ? `Повний кошик лише в одному магазині (${completeParts[0].id}). Інші — неповні, не переможець.`
          : `Повний кошик: ${rows.length} товарів. Checkout, не пропорційна ціна пачки.`,
  };
  const saved = await recordCompareResult({
    comparedAt,
    matchLogId: logId,
    rows,
    totals,
  });

  return NextResponse.json({
    ok: true,
    comparedAt,
    ...walmartSourceApiFields(),
    noFrillsSource:
      nfLiveHits === 0 && nfCacheHits > 0
        ? "catalog_cache"
        : nfCacheHits > 0
          ? "cache_and_live"
          : nfLiveHits > 0
            ? "live_api"
            : "catalog_cache",
    nfCacheHits,
    nfLiveHits,
    wholesaleClubSource:
      wcLiveHits === 0 && wcCacheHits > 0
        ? "catalog_cache"
        : wcCacheHits > 0
          ? "cache_and_live"
          : wcLiveHits > 0
            ? "live_api"
            : "catalog_cache",
    wcCacheHits,
    wcLiveHits,
    mvrSource:
      mvrLiveHits === 0 && mvrCacheHits > 0
        ? "catalog_cache"
        : mvrCacheHits > 0
          ? "cache_and_live"
          : mvrLiveHits > 0
            ? "live_api"
            : "catalog_cache",
    mvrCacheHits,
    mvrLiveHits,
    stores: [
      "walmart_5831",
      "nofrills_3660",
      "wholesaleclub_3724",
      "mvr_weston",
    ],
    sobeysEnabled: false,
    wholesaleClubEnabled: true,
    mvrEnabled: true,
    matchLogId: logId,
    rows,
    totals: { ...totals, purchasePlans },
    savedRunId: saved.run.id,
    statsPersisted: saved.persisted,
    stats: { summary: saved.summary, runs: saved.runs.slice(0, 40) },
  });
}

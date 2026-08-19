/**
 * Developer-only match inspector. Does not change compare, catalog pick,
 * or customer UI. Reuses entity-match + query scoring as-is.
 */
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import { resolveWalmartSource } from "@/connectors/walmart-source";
import { NoFrillsConnector } from "@/connectors/nofrills";
import {
  WholesaleClubConnector,
  WHOLESALECLUB_STORE_ID,
} from "@/connectors/wholesaleclub";
import { MvrConnector, MVR_STORE_ID } from "@/connectors/mvr";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import type { ProductOffer } from "@/connectors/types";
import {
  brandsMatch,
  matchProducts,
  nameTokens,
  normalizeName,
  offerToProductRecord,
  recordJaccard,
  sizeAgreement,
  structuredScore,
  type EntityMatchResult,
  type ProductRecord,
} from "@/domain/entity-match";
import {
  MVR_RETAILER,
  NOFRILLS_RETAILER,
  WALMART_RETAILER,
  WHOLESALECLUB_RETAILER,
  catalogOfferToRecord,
  categoryBSearchQueries,
  isCategoryBStaple,
  offerFailsStapleOfferFilters,
  retailerCategoryFromTaxonomy,
  stapleBrandHint,
  upcFromOffer,
} from "@/domain/catalog-normalize";
import { scoreOfferMatch, pickBestOffer, staplePickQuery } from "@/domain/matching";
import { parseMassFromText } from "@/domain/units";
import {
  loadRetailerMappings,
  saveRetailerMappings,
  isLockedIdentityLink,
  type RetailerSkuLink,
} from "@/lib/retailer-mappings";
import { loadMvrCatalog } from "@/lib/mvr-catalog";
import {
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  type CatalogOffer,
  type StapleItem,
  type StoreCatalog,
} from "@/lib/staples";
import { loadWholesaleClubCatalog } from "@/lib/wholesaleclub-catalog";

export const WM_STORE = "5831";
export const NF_STORE = "3660";
export const WC_STORE = WHOLESALECLUB_STORE_ID;
export const MVR_STORE = MVR_STORE_ID;

export const INSPECTOR_RETAILERS = [
  "walmart_ca",
  "no_frills",
  "wholesale_club",
  "mvr",
] as const;

export type InspectorRetailer = (typeof INSPECTOR_RETAILERS)[number];
export type CandidateStatus = "selected" | "rejected" | "candidate";
export type PriceSource =
  | "walmart_rapid"
  | "walmart_ssr"
  | "pcx_bff"
  | "mvr_shopify"
  | "catalog_json";

export function isInspectorRetailer(value: string): value is InspectorRetailer {
  return (INSPECTOR_RETAILERS as readonly string[]).includes(value);
}

export type FieldScores = {
  name: number;
  brand: number;
  size: number;
  category: number;
  queryFit: number | null;
  structuredTotal: number;
};

export type NormalizedCandidate = ProductRecord & {
  packageSize?: string;
  parsedMassKg?: number;
};

export type InspectorCandidate = {
  retailer: InspectorRetailer;
  storeId: string;
  retailerProductId: string;
  name: string;
  brand?: string;
  currentPrice: number;
  priceSource: PriceSource;
  lastChecked: string | null;
  matchMethod: EntityMatchResult["matchMethod"];
  confidence: number;
  decision: EntityMatchResult["decision"];
  status: CandidateStatus;
  mappingStatus: "locked" | "rejected" | "needs_review" | "none";
  filterReason: string | null;
  fieldScores: FieldScores;
  explain: EntityMatchResult["explain"];
  queryFitScore: number | null;
  winner: boolean;
  normalized: NormalizedCandidate;
  raw: unknown;
};

export type InspectorResult = {
  ok: boolean;
  originalQuery: string;
  normalizedQuery: string;
  queryTokens: string[];
  stapleId: string | null;
  stapleLabel: string | null;
  live: boolean;
  walmartSource: string;
  errors: Partial<Record<InspectorRetailer, string>>;
  candidates: InspectorCandidate[];
};

export type MappingAction = "approve" | "reject";

function mappingRetailer(retailer: string): string {
  if (retailer === "no_frills" || retailer === "nofrills") return NOFRILLS_RETAILER;
  if (retailer === "wholesale_club" || retailer === "wholesaleclub") {
    return WHOLESALECLUB_RETAILER;
  }
  if (retailer === "mvr") return MVR_RETAILER;
  return WALMART_RETAILER;
}

function asInspectorRetailer(retailer: string): InspectorRetailer {
  const mapped = mappingRetailer(retailer);
  if (mapped === NOFRILLS_RETAILER) return "no_frills";
  if (mapped === WHOLESALECLUB_RETAILER) return "wholesale_club";
  if (mapped === MVR_RETAILER) return "mvr";
  return "walmart_ca";
}

function storeFor(retailer: InspectorRetailer): string {
  if (retailer === "no_frills") return NF_STORE;
  if (retailer === "wholesale_club") return WC_STORE;
  if (retailer === "mvr") return MVR_STORE;
  return WM_STORE;
}

function priceSourceFor(
  retailer: InspectorRetailer,
  live: boolean,
): PriceSource {
  if (!live) return "catalog_json";
  if (retailer === "no_frills" || retailer === "wholesale_club") return "pcx_bff";
  if (retailer === "mvr") return "mvr_shopify";
  const src = resolveWalmartSource();
  if (src === "rapid") return "walmart_rapid";
  if (src === "missing_key") return "walmart_rapid";
  return "walmart_ssr";
}

function queryRecord(query: string, item?: StapleItem): ProductRecord {
  const mass = parseMassFromText(query);
  return {
    retailer: "query",
    name: query,
    normalizedName: normalizeName(query),
    brand: item ? stapleBrandHint(item) : undefined,
    category: item?.category,
    sizeValue: mass?.kg,
    sizeUnit: mass ? "kg" : undefined,
  };
}

function offerAsCatalog(offer: ProductOffer): CatalogOffer {
  const mass =
    parseMassFromText(offer.packageSize ?? "") ?? parseMassFromText(offer.name);
  const brand = (offer.brand ?? "").trim();
  return {
    productId: offer.productId,
    name:
      brand && !offer.name.toLowerCase().includes(brand.toLowerCase())
        ? `${brand} ${offer.name}`
        : offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    parsedMassKg: mass?.kg,
    brand: offer.brand,
    unitPrice: offer.unitPrice,
    wasPrice: offer.wasPrice,
    onSale: offer.onSale,
    confidence: offer.confidence,
    checkedAt: offer.checkedAt,
    sourceUrl: offer.sourceUrl,
    image: offer.image,
  };
}

function catalogAsOffer(
  retailer: InspectorRetailer,
  offer: CatalogOffer,
): ProductOffer {
  return {
    retailer,
    storeId: storeFor(retailer),
    productId: offer.productId,
    name: offer.name,
    brand: offer.brand,
    packageSize: offer.packageSize,
    price: offer.price,
    unitPrice: offer.unitPrice,
    wasPrice: offer.wasPrice,
    onSale: offer.onSale,
    availability: "unknown",
    confidence:
      offer.confidence === "exact" || offer.confidence === "estimated"
        ? offer.confidence
        : "stale",
    checkedAt: offer.checkedAt ?? new Date().toISOString(),
    sourceUrl: offer.sourceUrl,
    image: offer.image,
  };
}

function fieldScores(
  query: ProductRecord,
  cand: ProductRecord,
  offer: ProductOffer,
  searchQuery: string,
  targetMassKg?: number,
): FieldScores {
  const structured = structuredScore(query, cand);
  const brand = brandsMatch(query.brand, cand.brand);
  const size = sizeAgreement(query, cand);
  const qFit = scoreOfferMatch(offer, searchQuery, { targetMassKg });
  return {
    name: round3(recordJaccard(query, cand)),
    brand:
      brand === "exact" ? 0.28 : brand === "partial" ? 0.16 : brand === "mismatch" ? -0.2 : 0,
    size: size === "same" ? 0.22 : size === "close" ? 0.1 : 0,
    category: structured.explain.find((e) => e.reason.startsWith("category"))?.score ?? 0,
    queryFit: qFit === -Infinity ? null : round3(qFit),
    structuredTotal: round3(structured.score),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function mappingStatusFor(
  link: RetailerSkuLink | undefined,
  productId: string,
): InspectorCandidate["mappingStatus"] {
  if (!link?.retailerProductId) return "none";
  if (link.retailerProductId !== productId) return "none";
  if (link.decision === "rejected") return "rejected";
  if (isLockedIdentityLink(link) || link.verified) return "locked";
  if (link.decision === "needs_review") return "needs_review";
  if (link.decision === "auto_linked") return "locked";
  return "none";
}

function candidateStatus(
  mapStatus: InspectorCandidate["mappingStatus"],
  winner: boolean,
  queryFit: number | null,
  filterReason: string | null,
  decision: EntityMatchResult["decision"],
): CandidateStatus {
  if (mapStatus === "locked") return "selected";
  if (mapStatus === "rejected" || filterReason || queryFit == null) {
    return "rejected";
  }
  if (winner) return "selected";
  if (decision === "rejected") return "rejected";
  return "candidate";
}

function buildCandidate(input: {
  offer: ProductOffer;
  queryRec: ProductRecord;
  searchQuery: string;
  item?: StapleItem;
  live: boolean;
  winner: boolean;
  link?: RetailerSkuLink;
  includeRaw: boolean;
}): InspectorCandidate {
  const retailer = asInspectorRetailer(input.offer.retailer);
  const cat = offerAsCatalog(input.offer);
  const retailerCategory = retailerCategoryFromTaxonomy(input.offer.raw);
  const rec = catalogOfferToRecord({
    retailer: mappingRetailer(retailer),
    offer: cat,
    category: retailerCategory ?? input.item?.category,
    brandHint: input.offer.brand ?? (input.item ? stapleBrandHint(input.item) : undefined),
    upc: upcFromOffer(cat, [input.offer.upc]),
  });
  const targetMass = input.item?.targetMassKg;
  const scores = fieldScores(
    input.queryRec,
    rec,
    input.offer,
    input.searchQuery,
    targetMass,
  );
  const entity = matchProducts(input.queryRec, rec);
  const filter = input.item
    ? offerFailsStapleOfferFilters(input.item, {
        name: input.offer.name,
        brand: input.offer.brand,
        packageSize: input.offer.packageSize,
        raw: input.offer.raw,
      })
    : null;
  const mapStatus = mappingStatusFor(input.link, input.offer.productId);
  const status = candidateStatus(
    mapStatus,
    input.winner,
    scores.queryFit,
    filter,
    entity.decision,
  );
  return {
    retailer,
    storeId: input.offer.storeId || storeFor(retailer),
    retailerProductId: input.offer.productId,
    name: input.offer.name,
    brand: input.offer.brand,
    currentPrice: input.offer.price,
    priceSource: priceSourceFor(retailer, input.live),
    lastChecked: input.offer.checkedAt ?? null,
    matchMethod: entity.matchMethod,
    confidence: entity.matchConfidence,
    decision: entity.decision,
    status,
    mappingStatus: mapStatus,
    filterReason: filter,
    fieldScores: scores,
    explain: entity.explain,
    queryFitScore: scores.queryFit,
    winner: input.winner,
    normalized: {
      ...rec,
      packageSize: input.offer.packageSize,
      parsedMassKg: rec.sizeValue,
    },
    raw: input.includeRaw
      ? (input.offer.raw ?? offerToProductRecord(input.offer))
      : undefined,
  };
}

function uniqueOffers(offers: ProductOffer[]): ProductOffer[] {
  const seen = new Set<string>();
  const out: ProductOffer[] = [];
  for (const o of offers) {
    if (!o?.productId || seen.has(o.productId)) continue;
    seen.add(o.productId);
    out.push(o);
  }
  return out;
}

function looksLikeWalmartId(q: string): string | null {
  const url = q.match(/walmart\.ca\/(?:en|fr)\/ip\/[^/?#]+\/([A-Za-z0-9]+)/i);
  if (url?.[1]) return url[1];
  const bare = q.trim();
  if (/^\d{6,14}$/.test(bare)) return bare;
  if (/^[A-Z0-9]{10,14}$/i.test(bare) && /\d/.test(bare) && /[A-Za-z]/.test(bare)) {
    return bare;
  }
  return null;
}

async function liveOffers(
  retailer: InspectorRetailer,
  query: string,
  item?: StapleItem,
): Promise<ProductOffer[]> {
  const mappings = await loadRetailerMappings();
  const lockedSku = item
    ? mappings.products[item.id]?.retailers[mappingRetailer(retailer)]
        ?.retailerProductId
    : undefined;
  const queries =
    item && isCategoryBStaple(item)
      ? categoryBSearchQueries({ ...item, queries: [query, ...item.queries] }, 6)
      : [query];

  async function searchMany(
    search: (q: string) => Promise<ProductOffer[]>,
    getDirect?: (sku: string) => Promise<ProductOffer | null>,
  ): Promise<ProductOffer[]> {
    const hits: ProductOffer[] = [];
    if (lockedSku && getDirect) {
      const direct = await getDirect(lockedSku);
      if (direct) hits.push(direct);
    }
    for (const q of queries) {
      try {
        const found = await search(q);
        for (const h of found) hits.push(h);
      } catch {
        /* other queries still run */
      }
    }
    return uniqueOffers(hits).slice(0, 24);
  }

  if (retailer === "no_frills") {
    const nf = new NoFrillsConnector();
    return searchMany(
      (q) => nf.searchProducts(q, NF_STORE),
      (sku) => nf.getProduct(sku, NF_STORE),
    );
  }

  if (retailer === "wholesale_club") {
    const wc = new WholesaleClubConnector();
    return searchMany(
      (q) => wc.searchProducts(q, WC_STORE),
      (sku) => wc.getProduct(sku, WC_STORE),
    );
  }

  if (retailer === "mvr") {
    const mvr = new MvrConnector();
    return searchMany(
      (q) => mvr.searchProducts(q, MVR_STORE),
      (sku) => mvr.getProduct(sku, MVR_STORE),
    );
  }

  const wm = createWalmartConnector("L4J0A7");
  const out: ProductOffer[] = [];
  const sku =
    item?.preferredProductId ??
    looksLikeWalmartId(query) ??
    lockedSku;
  if (sku) {
    try {
      const direct = await wm.getProduct(sku, WM_STORE);
      if (direct) out.push(direct);
    } catch {
      /* search still runs */
    }
  }
  for (const q of queries) {
    const hits = await wm.searchProducts(looksLikeWalmartId(q) ?? q, WM_STORE);
    for (const h of hits) {
      if (!out.some((x) => x.productId === h.productId)) out.push(h);
    }
  }
  return uniqueOffers(out).slice(0, 24);
}

function catalogOffersFor(
  retailer: InspectorRetailer,
  query: string,
  item: StapleItem | undefined,
  catalogs: Partial<Record<InspectorRetailer, StoreCatalog | null>>,
): ProductOffer[] {
  const needle = normalizeName(query);
  const rows = catalogs[retailer]?.items ?? [];
  const out: ProductOffer[] = [];
  for (const row of rows) {
    if (item && row.id !== item.id) continue;
    const pool = [
      ...(row.offer ? [row.offer] : []),
      ...(row.alternates ?? []),
    ];
    for (const offer of pool) {
      if (!offer?.productId) continue;
      if (
        !item &&
        needle &&
        !normalizeName(`${offer.name} ${offer.brand ?? ""}`).includes(needle) &&
        !normalizeName(offer.productId).includes(needle)
      ) {
        continue;
      }
      out.push(catalogAsOffer(retailer, offer));
    }
  }
  return uniqueOffers(out).slice(0, 24);
}

export async function listInspectorStaples(): Promise<
  Array<{ id: string; label: string; queries: string[] }>
> {
  const cfg = await loadStaplesConfig();
  return cfg.items.map((i) => ({
    id: i.id,
    label: i.label,
    queries: i.queries.slice(0, 3),
  }));
}

export async function runMatchInspect(input: {
  query?: string;
  stapleId?: string;
  retailers?: InspectorRetailer[];
  live?: boolean;
  includeRaw?: boolean;
}): Promise<InspectorResult> {
  const cfg = await loadStaplesConfig();
  const item = input.stapleId
    ? cfg.items.find((i) => i.id === input.stapleId)
    : undefined;
  const originalQuery = (
    input.query?.trim() ||
    (item ? staplePickQuery(item) : "") ||
    item?.label ||
    ""
  ).trim();
  const live = input.live !== false;
  const includeRaw = input.includeRaw !== false;
  const retailers = input.retailers?.filter(isInspectorRetailer).length
    ? input.retailers.filter(isInspectorRetailer)
    : [...INSPECTOR_RETAILERS];

  if (!originalQuery) {
    return {
      ok: false,
      originalQuery: "",
      normalizedQuery: "",
      queryTokens: [],
      stapleId: item?.id ?? null,
      stapleLabel: item?.label ?? null,
      live,
      walmartSource: resolveWalmartSource(),
      errors: {},
      candidates: [],
    };
  }

  const queryRec = queryRecord(originalQuery, item);
  const mappings = await loadRetailerMappings();
  const linkFor = (retailer: InspectorRetailer) =>
    item
      ? mappings.products[item.id]?.retailers[mappingRetailer(retailer)]
      : undefined;

  const errors: InspectorResult["errors"] = {};
  const catalogs: Parameters<typeof catalogOffersFor>[3] = {
    walmart_ca: await loadWalmartCatalog(),
    no_frills: await loadNoFrillsCatalog(),
    wholesale_club: await loadWholesaleClubCatalog(),
    mvr: await loadMvrCatalog(),
  };
  const candidates: InspectorCandidate[] = [];

  try {
    await Promise.all(
      retailers.map(async (retailer) => {
        let offers: ProductOffer[] = [];
        let usedCatalogFallback = false;
        try {
          if (live) {
            offers = await liveOffers(retailer, originalQuery, item);
          } else {
            offers = catalogOffersFor(retailer, originalQuery, item, catalogs);
          }
        } catch (e) {
          errors[retailer] = e instanceof Error ? e.message : String(e);
          offers = catalogOffersFor(retailer, originalQuery, item, catalogs);
          usedCatalogFallback = offers.length > 0;
          if (usedCatalogFallback) {
            errors[retailer] = `${errors[retailer]} (showing catalog fallback)`;
          }
        }

        const preferred =
          retailer === "walmart_ca"
            ? (item?.preferredProductId ?? linkFor(retailer)?.retailerProductId)
            : linkFor(retailer)?.retailerProductId;
        const winner = pickBestOffer(offers, originalQuery, preferred, {
          targetMassKg: item?.targetMassKg,
          preferredUpc: item?.queries.find((q) => /\d{8,14}/.test(q)),
        });
        const winnerId = winner?.productId;
        for (const offer of offers) {
          candidates.push(
            buildCandidate({
              offer,
              queryRec,
              searchQuery: originalQuery,
              item,
              live: live && !usedCatalogFallback,
              winner: offer.productId === winnerId,
              link: linkFor(retailer),
              includeRaw,
            }),
          );
        }
      }),
    );
  } finally {
    await closeWalmartBrowser().catch(() => undefined);
  }

  return {
    ok: true,
    originalQuery,
    normalizedQuery: normalizeName(originalQuery),
    queryTokens: nameTokens(originalQuery),
    stapleId: item?.id ?? null,
    stapleLabel: item?.label ?? null,
    live,
    walmartSource: resolveWalmartSource(),
    errors,
    candidates,
  };
}

export async function applyInspectorMapping(input: {
  action: MappingAction;
  stapleId: string;
  retailer: InspectorRetailer;
  retailerProductId: string;
  name?: string;
  storeId?: string;
}): Promise<{ ok: boolean; error?: string; link?: RetailerSkuLink }> {
  const stapleId = input.stapleId.trim();
  const sku = input.retailerProductId.trim();
  if (!stapleId || !sku) {
    return { ok: false, error: "stapleId and retailerProductId required" };
  }
  const cfg = await loadStaplesConfig();
  const item = cfg.items.find((i) => i.id === stapleId);
  if (!item) return { ok: false, error: "unknown stapleId" };

  const retailer = mappingRetailer(input.retailer);
  const storeId = input.storeId?.trim() || storeFor(input.retailer);
  const store = await loadRetailerMappings();
  const master =
    store.products[stapleId] ??
    ({
      masterId: stapleId,
      label: item.label,
      category: item.category,
      retailers: {},
      prices: [],
    } satisfies typeof store.products[string]);

  const prev = master.retailers[retailer];
  if (
    input.action === "reject" &&
    prev?.retailerProductId &&
    prev.retailerProductId !== sku &&
    isLockedIdentityLink(prev)
  ) {
    return {
      ok: false,
      error: `locked mapping is ${prev.retailerProductId}; reject that SKU or approve a replacement`,
      link: prev,
    };
  }

  const now = new Date().toISOString();
  const link: RetailerSkuLink =
    input.action === "approve"
      ? {
          retailer,
          storeId,
          retailerProductId: sku,
          name: input.name ?? prev?.name,
          matchMethod: "manual_mapping",
          matchConfidence: 1,
          verified: true,
          verifiedAt: now,
          decision: "auto_linked",
          kind: "identity",
          skippedRematch: true,
          updatedAt: now,
        }
      : {
          retailer,
          storeId,
          retailerProductId: sku,
          name: input.name ?? prev?.name,
          matchMethod: prev?.matchMethod ?? "none",
          matchConfidence: 0,
          verified: false,
          decision: "rejected",
          kind: prev?.kind ?? "identity",
          explain: [
            {
              stage: "manual_mapping",
              score: 0,
              reason: "rejected from match inspector",
            },
          ],
          updatedAt: now,
        };

  master.retailers[retailer] = link;
  store.products[stapleId] = master;
  await saveRetailerMappings(store);
  return { ok: true, link };
}

export function inspectorEnabled(): boolean {
  if (process.env.ALLOW_MATCH_INSPECTOR === "0") return false;
  return true;
}

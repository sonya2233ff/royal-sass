import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NoFrillsConnector } from "@/connectors/nofrills";
import { WalmartConnector } from "@/connectors/walmart";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import type { ProductOffer } from "@/connectors/types";
import { pickBestOffer } from "@/domain/matching";
import {
  type CompareUnit,
  type OfferStatus,
  ageHours,
  compareUnitLabel,
  formatAge,
  sanityCheckOffer,
} from "@/domain/sanity";
import {
  formatMass,
  parseMassFromText,
  priceByPackCount,
  priceForMassKg,
  round2,
} from "@/domain/units";

export interface StapleItem {
  id: string;
  label: string;
  queries: string[];
  unavailableAtWalmart?: boolean;
  preferredProductId?: string;
  targetMassKg?: number;
  /** Expected retail pack mass for sanity (milk 2L ≈ 2) */
  expectedPackKg?: number;
  minPlausiblePrice?: number;
  maxPlausiblePrice?: number;
  image?: string;
  notes?: string;
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
  preferNameIncludes?: string[];
}

export interface CatalogOffer {
  productId: string;
  name: string;
  price: number;
  packageSize?: string;
  parsedMassKg?: number;
  unitPrice?: number;
  confidence?: string;
  checkedAt?: string;
  sourceUrl?: string;
}

export interface MatchLogEntry {
  at: string;
  itemId: string;
  retailer: string;
  queries: string[];
  accepted?: { productId: string; name: string; price: number };
  rejected: Array<{ productId?: string; name?: string; price?: number; reason: string }>;
  status: OfferStatus;
}

export type ConfirmedMap = Record<
  string,
  { productId: string; confirmedAt: string; label?: string }
>;

export const PINNED_IDS = [
  "oat_beverage_original",
  "homo_milk",
  "milk_2pct",
  "simply_egg_whites",
  "red_peppers",
  "tomatoes",
  "sweet_potatoes",
] as const;

export const CACHE_STALE_HOURS = Number(
  process.env.STAPLES_CACHE_STALE_HOURS ?? "72",
);

const DATA_CATALOG = path.join(process.cwd(), "data", "catalog");

export async function loadStaplesConfig(): Promise<{
  store: { externalStoreId: string; name: string; address: string };
  items: StapleItem[];
}> {
  const raw = await readFile(
    path.join(process.cwd(), "config", "cafe-staples.json"),
    "utf8",
  );
  return JSON.parse(raw);
}

export async function loadWalmartCatalog(): Promise<{
  checkedAt?: string;
  items: Array<{
    id: string;
    status: string;
    offer: CatalogOffer | null;
    image?: string;
    rejected?: unknown;
    notes?: string;
  }>;
} | null> {
  try {
    const raw = await readFile(
      path.join(DATA_CATALOG, "walmart_5831_latest.json"),
      "utf8",
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveWalmartCatalog(catalog: unknown): Promise<void> {
  await mkdir(DATA_CATALOG, { recursive: true });
  await writeFile(
    path.join(DATA_CATALOG, "walmart_5831_latest.json"),
    JSON.stringify(catalog, null, 2),
    "utf8",
  );
}

export async function loadConfirmed(): Promise<ConfirmedMap> {
  try {
    const raw = await readFile(
      path.join(DATA_CATALOG, "confirmed.json"),
      "utf8",
    );
    const data = JSON.parse(raw) as { confirmed?: ConfirmedMap } & ConfirmedMap;
    return data.confirmed ?? (data as ConfirmedMap);
  } catch {
    return {};
  }
}

export async function saveConfirmed(map: ConfirmedMap): Promise<void> {
  try {
    await mkdir(DATA_CATALOG, { recursive: true });
    await writeFile(
      path.join(DATA_CATALOG, "confirmed.json"),
      JSON.stringify(
        { updatedAt: new Date().toISOString(), confirmed: map },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Vercel / read-only FS — confirmation is in-memory for the request only
  }
}

export async function appendMatchLog(entries: MatchLogEntry[]): Promise<string> {
  const id = `match-${Date.now()}`;
  try {
    await mkdir(path.join(process.cwd(), "data", "runs"), { recursive: true });
    await writeFile(
      path.join(process.cwd(), "data", "runs", `${id}.json`),
      JSON.stringify({ id, at: new Date().toISOString(), entries }, null, 2),
      "utf8",
    );
  } catch {
    // Serverless: skip disk log; still return id for UI
  }
  return id;
}

function passesFilters(name: string, item: StapleItem): boolean {
  const n = name.toLowerCase();
  if (item.mustIncludeAny?.length) {
    if (!item.mustIncludeAny.some((t) => n.includes(t.toLowerCase()))) {
      return false;
    }
  }
  if (item.mustNotInclude?.length) {
    for (const bad of item.mustNotInclude) {
      if (n.includes(bad.toLowerCase())) return false;
    }
  }
  return true;
}

function expectedPackFor(item: StapleItem): number | undefined {
  if (item.expectedPackKg != null) return item.expectedPackKg;
  if (item.targetMassKg != null) return item.targetMassKg;
  if (item.id === "milk_2pct" || item.id === "homo_milk") return 2;
  if (item.id === "oat_beverage_original") return 1.75;
  return undefined;
}

export function evaluateOfferStatus(
  item: StapleItem,
  offer: CatalogOffer | null | undefined,
  opts?: { unavailable?: boolean; catalogStatus?: string },
): { status: OfferStatus; reason?: string; ageHours?: number; ageLabel: string | null } {
  if (opts?.unavailable || item.unavailableAtWalmart) {
    return { status: "unavailable", reason: "not sold at this store", ageLabel: null };
  }
  if (!offer) {
    const st = opts?.catalogStatus;
    if (st === "wrong_pack" || st === "wrong_size") {
      return { status: st, reason: "rejected by catalog", ageLabel: null };
    }
    return { status: "no_match", reason: "no offer", ageLabel: null };
  }

  const sanity = sanityCheckOffer({
    itemId: item.id,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    unitPrice: offer.unitPrice,
    expectedPackKg: expectedPackFor(item),
    allowCompose: item.targetMassKg != null,
    minPlausiblePrice: item.minPlausiblePrice,
    maxPlausiblePrice: item.maxPlausiblePrice,
    checkedAt: offer.checkedAt,
    staleAfterHours: CACHE_STALE_HOURS,
  });

  return {
    status: sanity.status,
    reason: sanity.reason,
    ageHours: sanity.ageHours ?? ageHours(offer.checkedAt),
    ageLabel: formatAge(sanity.ageHours ?? ageHours(offer.checkedAt)),
  };
}

export async function searchNoFrills(
  item: StapleItem,
  log?: MatchLogEntry,
): Promise<ProductOffer | null> {
  const nf = new NoFrillsConnector();
  const seen = new Map<string, ProductOffer>();
  const queries = item.queries.filter(Boolean).slice(0, 3);
  if (log) log.queries = [...queries];

  for (const q of queries) {
    try {
      const hits = await nf.searchProducts(q, "3660");
      for (const h of hits) {
        if (!seen.has(h.productId)) seen.set(h.productId, h);
      }
    } catch (e) {
      log?.rejected.push({
        reason: `search error: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`,
      });
    }
  }

  const all = [...seen.values()];
  for (const o of all) {
    if (!passesFilters(o.name, item)) {
      log?.rejected.push({
        productId: o.productId,
        name: o.name,
        price: o.price,
        reason: "filter mustInclude/mustNotInclude",
      });
    }
  }

  const pool = all.filter((o) => passesFilters(o.name, item));
  let best: ProductOffer | null = null;
  if (pool.length) {
    best =
      pickBestOffer(pool, item.label, item.preferredProductId, {
        targetMassKg: item.targetMassKg,
      }) ?? pool[0] ?? null;
  }

  if (best) {
    const sanity = sanityCheckOffer({
      itemId: item.id,
      name: best.name,
      price: best.price,
      packageSize: best.packageSize,
      unitPrice: best.unitPrice,
      expectedPackKg: expectedPackFor(item),
      allowCompose: item.targetMassKg != null,
      minPlausiblePrice: item.minPlausiblePrice,
      checkedAt: best.checkedAt,
    });
    if (!sanity.ok && sanity.status !== "stale") {
      log?.rejected.push({
        productId: best.productId,
        name: best.name,
        price: best.price,
        reason: sanity.reason ?? sanity.status,
      });
      if (log) log.status = sanity.status;
      return null;
    }
    if (log) {
      log.accepted = {
        productId: best.productId,
        name: best.name,
        price: best.price,
      };
      log.status = sanity.status;
    }
  } else if (log) {
    log.status = "no_match";
    log.rejected.push({ reason: "no relevant hits after filters" });
  }

  return best;
}

export interface SummarizedOffer {
  name: string;
  productId: string;
  shelfPrice: number;
  lineTotal: number | null;
  pack?: string;
  note?: string;
  confidence?: string;
  compareUnit: CompareUnit;
  compareUnitLabel: string;
  status: OfferStatus;
  statusReason?: string;
}

export function summarizeOffer(
  item: StapleItem,
  offer: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    unitPrice?: number;
    confidence?: string;
    checkedAt?: string;
  } | null,
  qty = 1,
): SummarizedOffer | null {
  if (!offer) return null;

  const sanity = sanityCheckOffer({
    itemId: item.id,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    unitPrice: offer.unitPrice,
    expectedPackKg: expectedPackFor(item),
    allowCompose: item.targetMassKg != null,
    minPlausiblePrice: item.minPlausiblePrice,
    maxPlausiblePrice: item.maxPlausiblePrice,
    checkedAt: offer.checkedAt,
    staleAfterHours: CACHE_STALE_HOURS,
  });

  if (!sanity.ok && sanity.status !== "stale") {
    return {
      name: offer.name,
      productId: offer.productId,
      shelfPrice: offer.price,
      lineTotal: null,
      pack: offer.packageSize,
      compareUnit: "per_pack",
      compareUnitLabel: compareUnitLabel("per_pack"),
      status: sanity.status,
      statusReason: sanity.reason,
      note: sanity.reason,
    };
  }

  const mass =
    parseMassFromText(offer.packageSize ?? "") ??
    parseMassFromText(offer.name);
  const pack = offer.packageSize ?? (mass ? formatMass(mass.kg) : undefined);

  if (item.targetMassKg != null) {
    const need = item.targetMassKg * qty;
    const asPacks = priceByPackCount(
      {
        retailer: "x",
        storeId: "x",
        productId: offer.productId,
        name: offer.name,
        packageSize: offer.packageSize,
        price: offer.price,
        availability: "unknown",
        confidence: "exact",
        checkedAt: new Date().toISOString(),
      },
      need,
    );
    if (asPacks) {
      const sameSize =
        Math.abs(asPacks.packKg - item.targetMassKg) / item.targetMassKg <= 0.2;
      const unit: CompareUnit = sameSize ? "per_pack" : "composed_packs";
      return {
        name: offer.name,
        productId: offer.productId,
        shelfPrice: offer.price,
        lineTotal: asPacks.lineTotal,
        pack,
        note: sameSize
          ? `${asPacks.basis}`
          : `${asPacks.basis} → ${formatMass(asPacks.coveredKg)}`,
        confidence: offer.confidence,
        compareUnit: unit,
        compareUnitLabel: compareUnitLabel(unit),
        status: sanity.status,
        statusReason: sanity.reason,
      };
    }
  }

  if (["tomatoes"].includes(item.id)) {
    return {
      name: offer.name,
      productId: offer.productId,
      shelfPrice: offer.price,
      lineTotal: round2(offer.price * qty),
      pack,
      note: pack ? `пачка ${pack}` : undefined,
      confidence: offer.confidence,
      compareUnit: "per_pack",
      compareUnitLabel: compareUnitLabel("per_pack"),
      status: sanity.status,
      statusReason: sanity.reason,
    };
  }

  if (["red_peppers", "sweet_potatoes", "pineapple"].includes(item.id)) {
    const priced = priceForMassKg(
      {
        retailer: "x",
        storeId: "x",
        productId: offer.productId,
        name: offer.name,
        packageSize: offer.packageSize,
        price: offer.price,
        unitPrice: offer.unitPrice,
        availability: "unknown",
        confidence: "exact",
        checkedAt: new Date().toISOString(),
      },
      1,
    );
    if (priced) {
      return {
        name: offer.name,
        productId: offer.productId,
        shelfPrice: offer.price,
        lineTotal: priced.lineTotal,
        pack,
        note: `1 kg · ${priced.basis}`,
        confidence: offer.confidence,
        compareUnit: "per_kg",
        compareUnitLabel: compareUnitLabel("per_kg"),
        status: sanity.status,
        statusReason: sanity.reason,
      };
    }
  }

  return {
    name: offer.name,
    productId: offer.productId,
    shelfPrice: offer.price,
    lineTotal: round2(offer.price * qty),
    pack,
    confidence: offer.confidence,
    compareUnit: "per_pack",
    compareUnitLabel: compareUnitLabel("per_pack"),
    status: sanity.status,
    statusReason: sanity.reason,
  };
}

function slimOffer(o: ProductOffer): CatalogOffer {
  const mass =
    parseMassFromText(o.packageSize ?? "") ?? parseMassFromText(o.name);
  return {
    productId: o.productId,
    name: o.name,
    packageSize: o.packageSize ?? (mass ? formatMass(mass.kg) : undefined),
    parsedMassKg: mass?.kg,
    price: o.price,
    unitPrice: o.unitPrice,
    confidence: o.confidence,
    checkedAt: o.checkedAt,
    sourceUrl: o.sourceUrl,
  };
}

/** Live-refresh Walmart catalog rows for selected staple ids only. */
export async function refreshWalmartSelected(ids: string[]): Promise<{
  updated: string[];
  logId: string;
  entries: MatchLogEntry[];
}> {
  const cfg = await loadStaplesConfig();
  const confirmed = await loadConfirmed();
  const catalog =
    (await loadWalmartCatalog()) ??
    ({
      type: "walmart-staples-catalog",
      checkedAt: new Date().toISOString(),
      items: [],
    } as {
      checkedAt: string;
      items: Array<Record<string, unknown>>;
    });

  const byId = new Map(cfg.items.map((i) => [i.id, i]));
  const wm = new WalmartConnector("L4J0A7");
  const entries: MatchLogEntry[] = [];
  const updated: string[] = [];

  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;

    const log: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "walmart_ca",
      queries: [],
      rejected: [],
      status: "no_match",
    };

    if (item.unavailableAtWalmart) {
      log.status = "unavailable";
      log.rejected.push({ reason: "marked unavailableAtWalmart" });
      entries.push(log);
      const row = (catalog.items as Array<Record<string, unknown>>).find(
        (r) => r.id === id,
      );
      if (row) {
        row.status = "unavailable";
        row.offer = null;
      }
      updated.push(id);
      continue;
    }

    const lockedId = confirmed[id]?.productId ?? null;
    const preferred = lockedId ?? item.preferredProductId ?? null;
    // 👍 confirmed → only that SKU, no fuzzy queries
    const queries = lockedId
      ? [lockedId]
      : [
          ...(preferred ? [preferred] : []),
          ...item.queries.filter(Boolean).slice(0, 3),
        ];
    log.queries = queries;

    const seen = new Map<string, ProductOffer>();
    for (const q of queries) {
      try {
        const hits = await wm.searchProducts(q, "5831");
        for (const h of hits) {
          if (!seen.has(h.productId)) seen.set(h.productId, h);
        }
      } catch (e) {
        log.rejected.push({
          reason: `search error: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`,
        });
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    let best: ProductOffer | null = null;
    if (lockedId) {
      best =
        [...seen.values()].find((o) => o.productId === lockedId) ?? null;
      if (!best) {
        log.rejected.push({
          productId: lockedId,
          reason: "confirmed SKU not found on refresh",
        });
        log.status = "no_match";
      }
      for (const o of seen.values()) {
        if (o.productId !== lockedId) {
          log.rejected.push({
            productId: o.productId,
            name: o.name,
            price: o.price,
            reason: "ignored — match confirmed, no fuzzy",
          });
        }
      }
    } else {
      let pool = [...seen.values()].filter((o) => passesFilters(o.name, item));
      for (const o of seen.values()) {
        if (!passesFilters(o.name, item)) {
          log.rejected.push({
            productId: o.productId,
            name: o.name,
            price: o.price,
            reason: "name filter",
          });
        }
      }
      if (preferred) {
        const locked = [...seen.values()].find((o) => o.productId === preferred);
        if (locked) {
          pool = [locked, ...pool.filter((p) => p.productId !== preferred)];
        }
      }
      best =
        pickBestOffer(pool, item.label, preferred ?? undefined, {
          targetMassKg: item.targetMassKg,
        }) ?? pool[0] ?? null;
    }

    if (best) {
      const sanity = sanityCheckOffer({
        itemId: item.id,
        name: best.name,
        price: best.price,
        packageSize: best.packageSize,
        unitPrice: best.unitPrice,
        expectedPackKg: expectedPackFor(item),
        allowCompose: item.targetMassKg != null,
        minPlausiblePrice: item.minPlausiblePrice,
        checkedAt: best.checkedAt,
      });
      if (!sanity.ok && sanity.status !== "stale") {
        log.rejected.push({
          productId: best.productId,
          name: best.name,
          price: best.price,
          reason: sanity.reason ?? sanity.status,
        });
        log.status = sanity.status;
        best = null;
      } else {
        log.accepted = {
          productId: best.productId,
          name: best.name,
          price: best.price,
        };
        log.status = sanity.status;
      }
    }

    let row = (catalog.items as Array<Record<string, unknown>>).find(
      (r) => r.id === id,
    );
    if (!row) {
      row = { id, label: item.label };
      (catalog.items as Array<Record<string, unknown>>).push(row);
    }
    row.label = item.label;
    row.image = item.image;
    row.queriesTried = queries;
    if (best) {
      row.status = log.status === "stale" ? "ok" : log.status;
      row.offer = slimOffer(best);
      row.notes = item.notes;
      delete row.rejected;
    } else {
      row.status = log.status;
      row.offer = null;
      row.rejected = log.rejected[log.rejected.length - 1] ?? {
        reason: "no_match",
      };
      row.notes = item.notes;
    }
    updated.push(id);
    entries.push(log);
  }

  (catalog as { checkedAt: string }).checkedAt = new Date().toISOString();
  await saveWalmartCatalog(catalog);
  const logId = await appendMatchLog(entries);
  await closeWalmartBrowser().catch(() => undefined);
  return { updated, logId, entries };
}

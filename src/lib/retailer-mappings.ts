/**
 * Master staple id → retailer SKU mappings.
 * Master is cafe-staples `id` (simply_egg_whites), never a No Frills PCX id.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MatchDecision, MatchMethod } from "@/domain/entity-match";
import type { PriceConfidence } from "@/domain/price-confidence";

const FILE = path.join(process.cwd(), "data", "catalog", "retailer-mappings.json");

export type MappingKind = "identity" | "staple_winner";

export interface RetailerSkuLink {
  retailer: string;
  storeId: string;
  retailerProductId: string;
  name?: string;
  upc?: string;
  matchMethod: MatchMethod;
  matchConfidence: number;
  verified: boolean;
  verifiedAt?: string;
  decision: MatchDecision;
  kind: MappingKind;
  skippedRematch?: boolean;
  filterReason?: string;
  explain?: Array<{ stage: string; score: number; reason: string }>;
  updatedAt: string;
}

export interface MappedPrice {
  retailer: string;
  storeId: string;
  retailerProductId?: string;
  price?: number;
  availability?: string;
  checkedAt?: string;
  source: string;
  priceConfidence: PriceConfidence;
}

export interface MasterProductMapping {
  masterId: string;
  label: string;
  category?: string;
  retailers: Record<string, RetailerSkuLink>;
  prices: MappedPrice[];
}

export interface RetailerMappingStore {
  updatedAt: string;
  autoLinkThreshold: number;
  note: string;
  products: Record<string, MasterProductMapping>;
}

function emptyStore(threshold: number): RetailerMappingStore {
  return {
    updatedAt: new Date().toISOString(),
    autoLinkThreshold: threshold,
    note: "masterId is the cafe staple id, not a No Frills or Walmart SKU",
    products: {},
  };
}

export async function loadRetailerMappings(): Promise<RetailerMappingStore> {
  try {
    const raw = await readFile(FILE, "utf8");
    return JSON.parse(raw) as RetailerMappingStore;
  } catch {
    return emptyStore(0.85);
  }
}

export async function saveRetailerMappings(
  store: RetailerMappingStore,
): Promise<void> {
  store.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
}

export function isVerifiedLink(link?: RetailerSkuLink): boolean {
  return Boolean(link?.verified && link.retailerProductId);
}

/** confirmed.json used "tomatoes" for the grape-tomato staple. */
export const CONFIRMED_STAPLE_ALIASES: Record<string, string[]> = {
  tomatoes_grape: ["tomatoes_grape", "tomatoes"],
};

export function lookupConfirmed<T>(
  map: Record<string, T> | undefined,
  masterId: string,
): T | undefined {
  if (!map) return undefined;
  const keys = CONFIRMED_STAPLE_ALIASES[masterId] ?? [masterId];
  for (const k of keys) {
    if (map[k]) return map[k];
  }
  return undefined;
}

import { mappingIsLockedIdentity } from "@/domain/compare-resolve";

/** Human lock / receipt / preferred SKU — do not rematch or swap catalog winners. */
export function isLockedIdentityLink(link?: RetailerSkuLink): boolean {
  return mappingIsLockedIdentity(link);
}

/**
 * Preferred-brand staples whose NF vs WM identity was rejected (Folgers vs
 * a different coffee). Still show both shelves, but never call that a deal.
 */
export function isPreferredIdentityRejected(
  mode: "preferred" | "cheapest",
  link?: { decision?: string },
): boolean {
  return mode === "preferred" && link?.decision === "rejected";
}

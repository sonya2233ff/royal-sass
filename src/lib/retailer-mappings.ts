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

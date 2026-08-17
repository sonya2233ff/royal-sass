/**
 * Read catalog JSON without importing store connectors (Playwright / Rapid).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), rel), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface SeedStapleItem {
  id: string;
  label: string;
  queries: string[];
  preferredProductId?: string;
  matchMode?: "preferred" | "cheapest";
  category?: string;
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
}

export interface SeedCatalogOffer {
  productId: string;
  name: string;
  price: number;
  packageSize?: string;
  parsedMassKg?: number;
  brand?: string;
  availability?: string;
  confidence?: string;
  checkedAt?: string;
  sourceUrl?: string;
}

export interface SeedCatalogRow {
  id: string;
  status: string;
  offer: SeedCatalogOffer | null;
}

export async function loadSeedStaples(): Promise<SeedStapleItem[]> {
  const cfg = await readJson<{ items: SeedStapleItem[] }>("config/cafe-staples.json");
  return cfg?.items ?? [];
}

export async function loadSeedCatalog(
  rel: string,
): Promise<{ items: SeedCatalogRow[] } | null> {
  return readJson(rel);
}

export async function loadSeedConfirmed(): Promise<
  Record<string, { productId: string; confirmedAt: string; label?: string }>
> {
  const data = await readJson<{ confirmed?: Record<string, { productId: string; confirmedAt: string; label?: string }> }>(
    "data/catalog/confirmed.json",
  );
  return data?.confirmed ?? {};
}

export async function loadSeedReceipts(): Promise<{
  preferredByStapleId?: Record<
    string,
    { productId?: string; upc?: string; store: string; name: string }
  >;
  byStoreUpc?: Record<string, { upc?: string; lastUnitPrice?: number }>;
} | null> {
  return readJson("data/catalog/receipt_sku_map.json");
}

export const SEED_STALE_HOURS = Number(
  process.env.STAPLES_CACHE_STALE_HOURS ?? "72",
);

export function seedMatchMode(
  item: SeedStapleItem,
): "preferred" | "cheapest" {
  if (item.matchMode) return item.matchMode;
  if (
    item.category === "produce" ||
    item.category === "frozen" ||
    item.category === "eggs"
  ) {
    return "cheapest";
  }
  return "preferred";
}

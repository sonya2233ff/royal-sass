/**
 * In-store shelf truth that Rapid/PCX listing flags cannot provide.
 * Rapid "In stock" is a website listing, not #5831 inventory.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { offerMatchesRetailerSku } from "@/domain/compare-resolve";

export type ShelfAvailability = "in_stock" | "out_of_stock";

export type ShelfOverride = {
  availability: ShelfAvailability;
  /** If set, only this retailer SKU (±1) is marked — not the whole staple. */
  productId?: string;
  source: string;
  at: string;
  note?: string;
};

type ShelfFile = {
  updatedAt?: string;
  overrides?: Record<string, Record<string, ShelfOverride>>;
};

const SHELF_PATH = path.join(
  process.cwd(),
  "data",
  "catalog",
  "shelf-overrides.json",
);

let cached: { at: number; data: ShelfFile } | null = null;

export async function loadShelfOverrides(): Promise<ShelfFile> {
  const now = Date.now();
  if (cached && now - cached.at < 2000) return cached.data;
  try {
    const raw = await readFile(SHELF_PATH, "utf8");
    const data = JSON.parse(raw) as ShelfFile;
    cached = { at: now, data };
    return data;
  } catch {
    const data: ShelfFile = { overrides: {} };
    cached = { at: now, data };
    return data;
  }
}

export function shelfOverrideFor(
  file: ShelfFile,
  storeKey: string,
  stapleId: string,
): ShelfOverride | null {
  return file.overrides?.[storeKey]?.[stapleId] ?? null;
}

export function applyShelfOverrideToOffer<
  T extends { productId?: string; sourceUrl?: string; availability?: string },
>(
  offer: T | null | undefined,
  override: ShelfOverride | null,
): T | null | undefined {
  if (!offer || !override) return offer;
  if (override.productId) {
    if (
      !offer.productId ||
      !offerMatchesRetailerSku(
        { productId: offer.productId, sourceUrl: offer.sourceUrl },
        override.productId,
      )
    ) {
      return offer;
    }
  }
  return { ...offer, availability: override.availability };
}

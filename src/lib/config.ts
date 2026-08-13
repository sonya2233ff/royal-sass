import { readFile } from "node:fs/promises";
import path from "node:path";

export interface StoreConfig {
  key: string;
  retailer: string;
  externalStoreId: string;
  name: string;
  city?: string;
  postalCode?: string;
  address?: string;
  active?: boolean;
}

export interface ProductConfigItem {
  id: string;
  genericName: string;
  brand?: string | null;
  category?: string;
  sizeValue?: number;
  sizeUnit?: string;
  quantity: number;
  quantityUnit: string;
  searchQueries: Record<string, string>;
  preferredProductIds?: Record<string, string>;
  notes?: string;
}

async function loadJson<T>(relativePath: string): Promise<T> {
  const full = path.join(process.cwd(), relativePath);
  const text = await readFile(full, "utf8");
  return JSON.parse(text) as T;
}

export async function loadStores(): Promise<StoreConfig[]> {
  try {
    const data = await loadJson<{ stores: StoreConfig[] }>("config/stores.json");
    return data.stores.filter((s) => s.active !== false);
  } catch {
    const data = await loadJson<{ stores: StoreConfig[] }>(
      "config/stores.example.json",
    );
    return data.stores.filter((s) => s.active !== false);
  }
}

export async function loadProducts(): Promise<ProductConfigItem[]> {
  try {
    const data = await loadJson<{ items: ProductConfigItem[] }>(
      "config/products.json",
    );
    return data.items;
  } catch {
    const data = await loadJson<{ items: ProductConfigItem[] }>(
      "config/products.example.json",
    );
    return data.items;
  }
}

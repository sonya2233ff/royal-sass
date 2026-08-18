import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OfferStatus } from "@/domain/sanity";
import type { CatalogOffer, StoreCatalog } from "@/lib/staples";
import { MVR_STORE_ID } from "@/connectors/mvr";

export const MVR_CATALOG_PATH = path.join(
  process.cwd(),
  "data",
  "catalog",
  "mvr_weston_latest.json",
);

export type MvrCatalogFile = StoreCatalog & {
  retailer?: "mvr";
  source?: "shopify_plus_mvrwholesale";
  note?: string;
};

export async function loadMvrCatalog(): Promise<MvrCatalogFile | null> {
  try {
    const raw = await readFile(MVR_CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as MvrCatalogFile;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveMvrCatalog(catalog: MvrCatalogFile): Promise<void> {
  try {
    await mkdir(path.dirname(MVR_CATALOG_PATH), { recursive: true });
    await writeFile(
      MVR_CATALOG_PATH,
      `${JSON.stringify(catalog, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* Serverless read-only FS */
  }
}

export async function upsertMvrCatalogItem(input: {
  id: string;
  label?: string;
  status: OfferStatus;
  offer: CatalogOffer | null;
  notes?: string;
  alternates?: CatalogOffer[];
}): Promise<void> {
  const existing =
    (await loadMvrCatalog()) ??
    ({
      retailer: "mvr",
      storeId: MVR_STORE_ID,
      source: "shopify_plus_mvrwholesale",
      checkedAt: new Date().toISOString(),
      note: "MVR Cash & Carry 3655 Weston Rd — INSTOREPRICE from plus.mvrwholesale.com. Case packs kept.",
      items: [],
    } as MvrCatalogFile);

  const idx = existing.items.findIndex((x) => x.id === input.id);
  const row = {
    id: input.id,
    label: input.label,
    status: input.status,
    offer: input.offer,
    notes: input.notes,
    alternates: input.alternates,
  };
  if (idx >= 0) {
    const prev = existing.items[idx];
    existing.items[idx] = {
      ...prev,
      ...row,
      alternates: input.alternates ?? prev.alternates,
    };
  } else {
    existing.items.push(row);
  }
  const now = new Date().toISOString();
  existing.checkedAt = now;
  existing.updatedAt = now;
  existing.retailer = "mvr";
  existing.storeId = MVR_STORE_ID;
  existing.source = "shopify_plus_mvrwholesale";
  await saveMvrCatalog(existing);
}

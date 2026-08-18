import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OfferStatus } from "@/domain/sanity";
import type { CatalogOffer, StoreCatalog } from "@/lib/staples";

export const SOBEYS_CLARK_HILDA_STORE = "659";
export const SOBEYS_FLYER_SOURCE = "sobeys_flyer_659";
export const SOBEYS_CATALOG_PATH = path.join(
  process.cwd(),
  "data",
  "catalog",
  "sobeys_659_latest.json",
);

export type SobeysCatalogFile = StoreCatalog & {
  retailer?: "sobeys";
  source?: typeof SOBEYS_FLYER_SOURCE;
  flyerId?: string | null;
  flyerName?: string | null;
  flyerValidFrom?: string | null;
  flyerValidTo?: string | null;
  note?: string;
};

const EMPTY: SobeysCatalogFile = {
  retailer: "sobeys",
  storeId: SOBEYS_CLARK_HILDA_STORE,
  source: SOBEYS_FLYER_SOURCE,
  checkedAt: new Date(0).toISOString(),
  note: "Weekly Ontario flyer — location-aware page, regional prices, not shelf.",
  items: [],
};

export async function loadSobeysCatalog(): Promise<SobeysCatalogFile | null> {
  try {
    const raw = await readFile(SOBEYS_CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as SobeysCatalogFile;
    if (!parsed || !Array.isArray(parsed.items)) return { ...EMPTY };
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSobeysCatalog(catalog: SobeysCatalogFile): Promise<void> {
  try {
    await mkdir(path.dirname(SOBEYS_CATALOG_PATH), { recursive: true });
    await writeFile(
      SOBEYS_CATALOG_PATH,
      `${JSON.stringify(catalog, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Serverless read-only FS
  }
}

export async function upsertSobeysCatalogItem(input: {
  id: string;
  label?: string;
  status: OfferStatus;
  offer: CatalogOffer | null;
  notes?: string;
  flyerId?: string | null;
  flyerName?: string | null;
  flyerValidFrom?: string | null;
  flyerValidTo?: string | null;
}): Promise<void> {
  const existing =
    (await loadSobeysCatalog()) ??
    ({
      ...EMPTY,
      checkedAt: new Date().toISOString(),
    } as SobeysCatalogFile);

  const idx = existing.items.findIndex((x) => x.id === input.id);
  const row = {
    id: input.id,
    label: input.label,
    status: input.status,
    offer: input.offer,
    notes: input.notes,
  };
  if (idx >= 0) {
    existing.items[idx] = { ...existing.items[idx], ...row };
  } else {
    existing.items.push(row);
  }

  const now = new Date().toISOString();
  existing.checkedAt = now;
  existing.updatedAt = now;
  existing.retailer = "sobeys";
  existing.storeId = SOBEYS_CLARK_HILDA_STORE;
  existing.source = SOBEYS_FLYER_SOURCE;
  if (input.flyerId !== undefined) existing.flyerId = input.flyerId;
  if (input.flyerName !== undefined) existing.flyerName = input.flyerName;
  if (input.flyerValidFrom !== undefined) existing.flyerValidFrom = input.flyerValidFrom;
  if (input.flyerValidTo !== undefined) existing.flyerValidTo = input.flyerValidTo;
  await saveSobeysCatalog(existing);
}

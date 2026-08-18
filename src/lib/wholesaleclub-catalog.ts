import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OfferStatus } from "@/domain/sanity";
import type { CatalogOffer, StoreCatalog } from "@/lib/staples";
import { WHOLESALECLUB_STORE_ID } from "@/connectors/wholesaleclub";

export const WHOLESALECLUB_CATALOG_PATH = path.join(
  process.cwd(),
  "data",
  "catalog",
  "wholesaleclub_3724_latest.json",
);

export type WholesaleClubCatalogFile = StoreCatalog & {
  retailer?: "wholesale_club";
  source?: "pcx_bff_wholesaleclub_3724";
  note?: string;
};

export async function loadWholesaleClubCatalog(): Promise<WholesaleClubCatalogFile | null> {
  try {
    const raw = await readFile(WHOLESALECLUB_CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw) as WholesaleClubCatalogFile;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveWholesaleClubCatalog(
  catalog: WholesaleClubCatalogFile,
): Promise<void> {
  try {
    await mkdir(path.dirname(WHOLESALECLUB_CATALOG_PATH), { recursive: true });
    await writeFile(
      WHOLESALECLUB_CATALOG_PATH,
      `${JSON.stringify(catalog, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Serverless read-only FS
  }
}

export async function upsertWholesaleClubCatalogItem(input: {
  id: string;
  label?: string;
  status: OfferStatus;
  offer: CatalogOffer | null;
  notes?: string;
  alternates?: CatalogOffer[];
}): Promise<void> {
  const existing =
    (await loadWholesaleClubCatalog()) ??
    ({
      retailer: "wholesale_club",
      storeId: WHOLESALECLUB_STORE_ID,
      source: "pcx_bff_wholesaleclub_3724",
      checkedAt: new Date().toISOString(),
      note: "Wholesale Club Richmond Hill #3724 — PCX BFF shelf, same client as No Frills.",
      items: [],
    } as WholesaleClubCatalogFile);

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
  existing.retailer = "wholesale_club";
  existing.storeId = WHOLESALECLUB_STORE_ID;
  existing.source = "pcx_bff_wholesaleclub_3724";
  await saveWholesaleClubCatalog(existing);
}

/**
 * Rewrite Category B catalog winners: filter suitable SKUs, then cheapest
 * fair unit. Does not call Rapid/PCX. Does not touch category A locks.
 *
 *   npx tsx src/poc/rematch-category-b-catalogs.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  catalogCandidates,
  mappingIsLockedIdentity,
  offerIsOnShelf,
  resolveCatalogOffer,
  type CatalogOfferRef,
} from "@/domain/compare-resolve";
import {
  mergeDistinctPackSizes,
  splitOfferAndAlternates,
} from "@/domain/pack-size-candidates";
import {
  isActualCategoryBOffer,
  preferNonCasePacks,
  usesCategoryBIdentity,
  withTypicalEachMass,
} from "@/domain/same-packed-item";
import { offerFailsStapleOfferFilters } from "@/domain/catalog-normalize";
import { pickCheapestByFairUnit } from "@/domain/matching";
import { loadRetailerMappings } from "@/lib/retailer-mappings";
import {
  isShownStaple,
  loadStaplesConfig,
  resolveMatchMode,
  type CatalogOffer,
  type StapleItem,
} from "@/lib/staples";

const ROOT = path.join(process.cwd(), "data", "catalog");

const FILES: Array<{
  file: string;
  retailer: "walmart_ca" | "nofrills" | "wholesaleclub" | "mvr";
}> = [
  { file: "walmart_5831_latest.json", retailer: "walmart_ca" },
  { file: "nofrills_3660_latest.json", retailer: "nofrills" },
  { file: "wholesaleclub_3724_latest.json", retailer: "wholesaleclub" },
  { file: "mvr_weston_latest.json", retailer: "mvr" },
];

type CatalogFile = {
  checkedAt?: string;
  items: Array<{
    id: string;
    status?: string;
    offer: CatalogOffer | null;
    alternates?: CatalogOffer[] | null;
    notes?: string;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
};

function passingOffers(
  item: StapleItem,
  row: { offer: CatalogOffer | null; alternates?: CatalogOffer[] | null },
): CatalogOffer[] {
  const out: CatalogOffer[] = [];
  for (const offer of catalogCandidates(row) as CatalogOffer[]) {
    if (!offerIsOnShelf(offer)) continue;
    if (usesCategoryBIdentity(item)) {
      if (!isActualCategoryBOffer(item, offer)) continue;
    } else if (offerFailsStapleOfferFilters(item, offer)) {
      continue;
    }
    out.push(withTypicalEachMass(item, offer));
  }
  return preferNonCasePacks(out);
}

async function main() {
  const cfg = await loadStaplesConfig();
  const mappings = await loadRetailerMappings();
  const byId = new Map(cfg.items.filter(isShownStaple).map((i) => [i.id, i]));
  const changes: string[] = [];

  for (const spec of FILES) {
    const full = path.join(ROOT, spec.file);
    const catalog = JSON.parse(await readFile(full, "utf8")) as CatalogFile;
    let fileChanged = false;

    for (const row of catalog.items) {
      const item = byId.get(row.id);
      if (!item || resolveMatchMode(item) !== "cheapest") continue;
      const link = mappings.products[item.id]?.retailers[spec.retailer];
      const before = row.offer
        ? `${row.offer.name} $${row.offer.price}`
        : "(none)";
      const pool = passingOffers(item, row);
      let winner: CatalogOffer | CatalogOfferRef | null = null;
      if (mappingIsLockedIdentity(link)) {
        winner = resolveCatalogOffer({
          item,
          row,
          link,
          matchMode: "cheapest",
        }).offer;
      } else {
        winner = pickCheapestByFairUnit(pool);
      }
      if (!winner) {
        if (row.offer && !mappingIsLockedIdentity(link)) {
          const previous = catalogCandidates(row) as CatalogOffer[];
          row.status = "no_match";
          row.offer = null;
          row.alternates = previous.filter((o) => o.productId);
          row.notes = "Rematched: no suitable SKU after Category B filters";
          fileChanged = true;
          changes.push(
            `${spec.retailer} ${item.id}: ${before} → no_match`,
          );
        }
        continue;
      }
      const sizes = mergeDistinctPackSizes(
        pool.filter((o) => o.price > 0),
      );
      const split = splitOfferAndAlternates(
        sizes.length ? sizes : [winner as CatalogOffer],
        winner.productId,
      );
      const nextOffer = split.offer;
      if (!nextOffer) continue;
      const prevAltIds = (row.alternates ?? []).map((o) => o.productId).join(",");
      const nextAltIds = split.alternates.map((o) => o.productId).join(",");
      const same =
        row.offer?.productId === nextOffer.productId &&
        row.offer?.price === nextOffer.price &&
        prevAltIds === nextAltIds;
      row.offer = nextOffer;
      row.alternates = split.alternates;
      row.status = "ok";
      if (!same) {
        fileChanged = true;
        changes.push(
          `${spec.retailer} ${item.id}: ${before} → ${nextOffer.name} $${nextOffer.price}`,
        );
      }
    }

    if (fileChanged) {
      catalog.checkedAt = new Date().toISOString();
      await writeFile(full, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    }
  }

  if (!changes.length) {
    console.log("No Category B catalog winners changed.");
    return;
  }
  console.log(`Updated ${changes.length} Category B rows:`);
  for (const line of changes) console.log(`  ${line}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

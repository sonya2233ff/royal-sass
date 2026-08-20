/**
 * Re-fetch shelf prices for pinned staple SKUs (no rematch).
 *
 *   npm run cache:prices
 *   npm run cache:prices -- tomatoes_grape ziploc_sandwich
 *   npm run cache:prices -- --stores=walmart
 *   npm run cache:prices -- --stores=walmart --fill-missing
 */
import { collectPriceRefreshIds, isShownStaple, loadStaplesConfig, refreshWalmartSelected } from "@/lib/staples";
import {
  refreshCatalogPrices,
  type CatalogPriceRefreshOptions,
  type CatalogPriceRefreshResult,
  type PriceRefreshFailure,
  type PriceRefreshHit,
  type PriceRefreshStore,
} from "@/lib/refresh-catalog-prices";

const STORE_FLAGS: PriceRefreshStore[] = [
  "walmart",
  "nofrills",
  "wholesaleclub",
  "mvr",
];

function printRetailer(
  title: string,
  block: {
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
    blocked?: string;
  },
) {
  console.error(`\n${title}`);
  if (block.blocked) {
    console.error(`  blocked: ${block.blocked}`);
  }
  for (const hit of block.updated) {
    const prev =
      hit.previousPrice != null ? `$${hit.previousPrice.toFixed(2)} → ` : "";
    console.log(
      `  ${hit.id.padEnd(28)} ${prev}$${hit.price.toFixed(2)}  ${hit.name}`,
    );
  }
  const shown = block.failed.slice(0, 8);
  for (const row of shown) {
    console.log(`  ${row.id.padEnd(28)} FAIL  ${row.reason}`);
  }
  if (block.failed.length > shown.length) {
    console.log(`  … ${block.failed.length - shown.length} more failures`);
  }
}

function storeSummary(
  block: {
    updated: PriceRefreshHit[];
    failed: PriceRefreshFailure[];
    skipped: PriceRefreshFailure[];
    blocked?: string;
  },
  extra?: Record<string, unknown>,
) {
  return {
    updated: block.updated.length,
    failed: block.failed.length,
    skipped: block.skipped.length,
    blocked: Boolean(block.blocked),
    ...extra,
  };
}

function parseStores(raw: string): PriceRefreshStore[] {
  const out: PriceRefreshStore[] = [];
  for (const part of raw.split(",").map((s) => s.trim().toLowerCase())) {
    if (!part) continue;
    const alias =
      part === "wm" ? "walmart" : part === "nf" ? "nofrills" : part === "wc" ? "wholesaleclub" : part;
    if (!(STORE_FLAGS as string[]).includes(alias)) {
      throw new Error(`Unknown store "${part}". Use walmart,nofrills,wholesaleclub,mvr`);
    }
    out.push(alias as PriceRefreshStore);
  }
  return [...new Set(out)];
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith("-"));
  const args = argv.filter((a) => !a.startsWith("-"));
  const storeArg = flags.find((a) => a.startsWith("--stores="));
  const stores = storeArg ? parseStores(storeArg.slice("--stores=".length)) : undefined;
  const fillMissing = flags.includes("--fill-missing");
  const opts: CatalogPriceRefreshOptions | undefined = stores?.length
    ? { stores }
    : undefined;

  const cfg = await loadStaplesConfig();
  const all = collectPriceRefreshIds(cfg.items);
  const ids = [...new Set((args.length ? args : all).filter((id) => all.includes(id) || isShownStaple({ id })))];
  if (!ids.length) {
    console.error("No valid staple ids");
    process.exit(1);
  }

  console.error(
    `Refreshing catalog prices for ${ids.length} staples${stores ? ` (${stores.join(",")})` : ""}…`,
  );
  const result: CatalogPriceRefreshResult = await refreshCatalogPrices(ids, opts);

  if (!stores || stores.includes("walmart")) {
    printRetailer("Walmart", result.walmart);
  }
  if (!stores || stores.includes("nofrills")) {
    printRetailer("No Frills", result.noFrills);
  }
  if (!stores || stores.includes("wholesaleclub")) {
    printRetailer("Wholesale Club", result.wholesaleClub);
  }
  if (!stores || stores.includes("mvr")) {
    printRetailer("MVR Weston", result.mvr);
  }

  if (fillMissing && (!stores || stores.includes("walmart"))) {
    const missing = result.walmart.skipped
      .filter((row) => row.reason === "no locked/catalog SKU")
      .map((row) => row.id)
      .filter((id) => isShownStaple({ id }));
    if (missing.length) {
      console.error(`\nFilling ${missing.length} Walmart rows with no SKU (search rematch)…`);
      const filled = await refreshWalmartSelected(missing);
      console.error(
        `  WM fill-missing updated=${filled.updated.length} log=${filled.logId}`,
      );
      for (const e of filled.entries) {
        const a = e.accepted;
        if (!a) continue;
        console.log(
          `  ${e.itemId.padEnd(28)} $${a.price.toFixed(2)}  ${a.name}`,
        );
      }
    }
  }

  const summary = {
    walmart: storeSummary(result.walmart, { source: result.walmart.source }),
    noFrills: storeSummary(result.noFrills),
    wholesaleClub: storeSummary(result.wholesaleClub),
    mvr: storeSummary(result.mvr),
  };
  console.error(
    `\nDone. WM updated=${summary.walmart.updated} failed=${summary.walmart.failed} skip=${summary.walmart.skipped}`,
  );
  console.error(
    `     NF updated=${summary.noFrills.updated} failed=${summary.noFrills.failed} skip=${summary.noFrills.skipped}`,
  );
  console.error(
    `     WC updated=${summary.wholesaleClub.updated} failed=${summary.wholesaleClub.failed} skip=${summary.wholesaleClub.skipped}`,
  );
  console.error(
    `     MVR updated=${summary.mvr.updated} failed=${summary.mvr.failed} skip=${summary.mvr.skipped}`,
  );
  console.error(`SUMMARY ${JSON.stringify(summary)}`);

  const totalUpdated =
    summary.walmart.updated +
    summary.noFrills.updated +
    summary.wholesaleClub.updated +
    summary.mvr.updated;
  if (totalUpdated === 0 && !fillMissing) {
    console.error("No catalog prices updated.");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

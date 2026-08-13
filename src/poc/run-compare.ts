import {
  buildFixtureOffers,
  getConnector,
  type ProductOffer,
  ConnectorError,
} from "@/connectors";
import {
  compareBaskets,
  type BasketLineInput,
  type ComparisonResult,
} from "@/domain/basket";
import { pickBestOffer } from "@/domain/matching";
import { loadProducts, loadStores, type StoreConfig } from "@/lib/config";
import {
  persistComparisonRun,
  persistObservation,
  persistRawResponse,
} from "@/lib/persistence";

export interface OfferFetchMeta {
  storeKey: string;
  itemId: string;
  ok: boolean;
  error?: string;
  offer?: ProductOffer;
}

async function fetchLiveOffer(
  store: StoreConfig,
  itemId: string,
  query: string,
  preferredProductId?: string,
): Promise<OfferFetchMeta> {
  const connector = getConnector(store.retailer, {
    postalCode: store.postalCode,
  });

  try {
    const offers = await connector.searchProducts(
      query,
      store.externalStoreId,
    );

    await persistRawResponse({
      retailer: store.retailer,
      storeId: store.externalStoreId,
      requestMeta: { query, storeKey: store.key },
      body: offers.map((o) => ({
        productId: o.productId,
        name: o.name,
        price: o.price,
        confidence: o.confidence,
        availability: o.availability,
      })),
    });

    const offer = pickBestOffer(offers, query, preferredProductId);
    if (!offer) {
      return {
        storeKey: store.key,
        itemId,
        ok: false,
        error: "No sufficiently relevant product match",
      };
    }

    await persistObservation({ storeKey: store.key, itemId, offer });
    return { storeKey: store.key, itemId, ok: true, offer };
  } catch (e) {
    const message =
      e instanceof ConnectorError
        ? `[${e.code}] ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    return { storeKey: store.key, itemId, ok: false, error: message };
  }
}

export async function runComparison(options: {
  useFixtures: boolean;
}): Promise<{
  comparison: ComparisonResult;
  fetches: OfferFetchMeta[];
  stores: StoreConfig[];
  runId: string;
}> {
  const stores = await loadStores();
  const products = await loadProducts();
  const fetches: OfferFetchMeta[] = [];

  const lines: BasketLineInput[] = [];

  for (const product of products) {
    const offersByStore: Record<string, ProductOffer | null> = {};

    for (const store of stores) {
      if (options.useFixtures) {
        const catalog = buildFixtureOffers(
          store.key,
          store.retailer,
          store.externalStoreId,
        );
        const offer = catalog[product.id] ?? null;
        offersByStore[store.key] = offer;
        if (offer) {
          fetches.push({
            storeKey: store.key,
            itemId: product.id,
            ok: true,
            offer,
          });
          await persistObservation({
            storeKey: store.key,
            itemId: product.id,
            offer,
          });
        } else {
          fetches.push({
            storeKey: store.key,
            itemId: product.id,
            ok: false,
            error: "Missing fixture",
          });
        }
      } else {
        const query =
          product.searchQueries[store.retailer] ?? product.genericName;
        const preferred =
          product.preferredProductIds?.[store.retailer] ??
          product.preferredProductIds?.[store.key];
        const meta = await fetchLiveOffer(
          store,
          product.id,
          query,
          preferred,
        );
        fetches.push(meta);
        offersByStore[store.key] = meta.offer ?? null;
        // Be polite to retailer endpoints
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    lines.push({
      itemId: product.id,
      label: product.genericName,
      quantity: product.quantity,
      offersByStore,
    });
  }

  const comparison = compareBaskets(
    lines,
    stores.map((s) => s.key),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: options.useFixtures ? "fixtures" : "live",
    stores,
    fetches: fetches.map((f) => ({
      storeKey: f.storeKey,
      itemId: f.itemId,
      ok: f.ok,
      error: f.error,
      offer: f.offer
        ? {
            retailer: f.offer.retailer,
            storeId: f.offer.storeId,
            productId: f.offer.productId,
            name: f.offer.name,
            price: f.offer.price,
            promoPrice: f.offer.promoPrice,
            availability: f.offer.availability,
            confidence: f.offer.confidence,
            checkedAt: f.offer.checkedAt,
          }
        : undefined,
    })),
    comparison: {
      oneStore: comparison.oneStore.map((b) => ({
        storeKey: b.storeKey,
        retailer: b.retailer,
        storeId: b.storeId,
        complete: b.complete,
        missingItemIds: b.missingItemIds,
        productTotal: b.productTotal,
        realCost: b.procurement.realCost,
        lines: b.lines.map((l) => ({
          itemId: l.itemId,
          label: l.label,
          quantity: l.quantity,
          productName: l.offer.name,
          unitPrice: l.offer.price,
          lineTotal: l.lineTotal,
          confidence: l.offer.confidence,
          availability: l.offer.availability,
          checkedAt: l.offer.checkedAt,
        })),
      })),
      bestOneStore: comparison.bestOneStore
        ? {
            storeKey: comparison.bestOneStore.storeKey,
            retailer: comparison.bestOneStore.retailer,
            productTotal: comparison.bestOneStore.productTotal,
            realCost: comparison.bestOneStore.procurement.realCost,
          }
        : null,
      mixed: {
        complete: comparison.mixed.complete,
        productTotal: comparison.mixed.productTotal,
        realCost: comparison.mixed.procurement.realCost,
        byStore: comparison.mixed.byStore,
        assignments: comparison.mixed.assignments.map((a) => ({
          itemId: a.itemId,
          label: a.label,
          storeKey: a.storeKey,
          productName: a.offer.name,
          lineTotal: a.lineTotal,
          confidence: a.offer.confidence,
        })),
      },
      savingsVsBestOneStore: comparison.savingsVsBestOneStore,
    },
  };

  const runId = await persistComparisonRun(payload);
  return { comparison, fetches, stores, runId };
}

export function formatComparisonReport(input: {
  comparison: ComparisonResult;
  stores: StoreConfig[];
  fetches: OfferFetchMeta[];
  runId: string;
  mode: string;
}): string {
  const { comparison, stores, fetches, runId, mode } = input;
  const lines: string[] = [];
  lines.push(`=== Royal SASS Price POC (${mode}) ===`);
  lines.push(`Run: ${runId}`);
  lines.push("");

  lines.push("PER-PRODUCT OFFERS:");
  for (const productId of [...new Set(fetches.map((f) => f.itemId))]) {
    lines.push(`  Product: ${productId}`);
    for (const store of stores) {
      const f = fetches.find(
        (x) => x.itemId === productId && x.storeKey === store.key,
      );
      if (!f?.offer) {
        lines.push(
          `    ${store.name}: NO MATCH (${f?.error ?? "n/a"})`,
        );
      } else {
        const o = f.offer;
        lines.push(
          `    ${store.name}: ${o.name} | $${o.price.toFixed(2)} | unit=${o.unitPrice ?? "n/a"} | avail=${o.availability} | conf=${o.confidence} | checked=${o.checkedAt}`,
        );
      }
    }
    lines.push("");
  }

  for (const store of stores) {
    const basket = comparison.oneStore.find((b) => b.storeKey === store.key);
    lines.push(`${store.name}`);
    if (!basket) {
      lines.push("  (no basket)");
    } else if (!basket.complete) {
      lines.push(
        `  INCOMPLETE — missing: ${basket.missingItemIds.join(", ") || "n/a"}`,
      );
      lines.push(`  Partial total: $${basket.productTotal.toFixed(2)}`);
    } else {
      lines.push(`  Total: $${basket.productTotal.toFixed(2)}`);
    }
    lines.push("");
  }

  if (comparison.bestOneStore) {
    lines.push("BEST ONE-STORE OPTION:");
    lines.push(
      `  ${comparison.bestOneStore.storeKey} — $${comparison.bestOneStore.productTotal.toFixed(2)}`,
    );
  } else {
    lines.push("BEST ONE-STORE OPTION: none (no complete baskets)");
  }
  lines.push("");

  lines.push("BEST MIXED BASKET:");
  for (const [storeKey, group] of Object.entries(comparison.mixed.byStore)) {
    lines.push(`  ${storeKey}:`);
    for (const item of group.items) {
      lines.push(`    - ${item}`);
    }
  }
  lines.push(`  Total: $${comparison.mixed.productTotal.toFixed(2)}`);
  if (comparison.savingsVsBestOneStore != null) {
    lines.push(
      `  Savings vs cheapest one-store: $${comparison.savingsVsBestOneStore.toFixed(2)}`,
    );
  }
  lines.push("");

  const failures = fetches.filter((f) => !f.ok);
  if (failures.length) {
    lines.push("Fetch issues:");
    for (const f of failures) {
      lines.push(`  - ${f.storeKey} / ${f.itemId}: ${f.error}`);
    }
  }

  return lines.join("\n");
}

async function main() {
  const useFixtures = process.argv.includes("--fixtures");
  const result = await runComparison({ useFixtures });
  const report = formatComparisonReport({
    ...result,
    mode: useFixtures ? "fixtures" : "live",
  });
  console.log(report);
  console.log(`\nFull JSON: data/runs/${result.runId}.json`);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  process.argv[1].replace(/\\/g, "/").endsWith("src/poc/run-compare.ts");

if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

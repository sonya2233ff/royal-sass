/**
 * Pull cafe staples from Walmart #5831 and save a local catalog snapshot.
 *
 * Usage: npm run cache:walmart
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import type { ProductOffer } from "@/connectors/types";
import { pickBestOffer, pickCheapestOffer } from "@/domain/matching";
import {
  formatMass,
  parseMassFromText,
  scoreMassMatch,
} from "@/domain/units";

interface StapleItem {
  id: string;
  label: string;
  queries: string[];
  targetMassKg?: number;
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  mustNotInclude?: string[];
  preferNameIncludes?: string[];
  preferredProductId?: string;
  unavailableAtWalmart?: boolean;
  image?: string;
  notes?: string;
  matchMode?: "preferred" | "cheapest";
  category?: string;
}

interface StaplesConfig {
  store: {
    key: string;
    retailer: string;
    externalStoreId: string;
    name: string;
    address: string;
  };
  items: StapleItem[];
}

function slimOffer(o: ProductOffer) {
  const mass =
    parseMassFromText(o.packageSize ?? "") ?? parseMassFromText(o.name);
  return {
    productId: o.productId,
    name: o.name,
    brand: o.brand,
    packageSize: o.packageSize ?? (mass ? formatMass(mass.kg) : undefined),
    parsedMassKg: mass?.kg,
    upc: o.upc,
    price: o.price,
    unitPrice: o.unitPrice,
    wasPrice: o.wasPrice,
    onSale: o.onSale || undefined,
    availability: o.availability,
    confidence: o.confidence,
    checkedAt: o.checkedAt,
    sourceUrl: o.sourceUrl,
    image: o.image,
  };
}

function hayIncludes(hay: string, needle: string): boolean {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  if (n.includes(" ")) return hay.includes(n);
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}(?:es|s)?([^a-z0-9]|$)`).test(hay);
}

function passesFilters(o: ProductOffer, item: StapleItem): boolean {
  const n = `${o.name} ${o.packageSize ?? ""}`.toLowerCase();
  if (item.mustIncludeAny?.length) {
    if (!item.mustIncludeAny.some((t) => hayIncludes(n, t))) return false;
  }
  if (item.mustIncludeAll?.length) {
    if (!item.mustIncludeAll.every((t) => hayIncludes(n, t))) return false;
  }
  if (item.mustNotInclude?.length) {
    for (const bad of item.mustNotInclude) {
      if (n.includes(bad.toLowerCase())) return false;
    }
  }
  return true;
}

function scoreStaple(o: ProductOffer, item: StapleItem): number {
  let score = 0;
  const match = pickBestOffer([o], item.label);
  if (match) score += 10;
  else {
    const n = o.name.toLowerCase();
    for (const t of item.label.toLowerCase().split(/\s+/)) {
      if (t.length > 3 && n.includes(t)) score += 2;
    }
  }
  if (item.targetMassKg != null) score += scoreMassMatch(o, item.targetMassKg);
  if (item.preferNameIncludes?.length) {
    const n = o.name.toLowerCase();
    for (const p of item.preferNameIncludes) {
      if (n.includes(p.toLowerCase())) score += 3;
    }
  }
  if (o.confidence === "exact") score += 1;
  // Prefer cheaper reasonable grocery (not $38 protein bars)
  if (o.price > 25) score -= 2;
  // Mehadrin / dairy jugs: reject absurdly low shelf prices (e.g. $1.27 for 2L)
  if (
    (item.id === "milk_2pct" ||
      item.id === "homo_milk" ||
      item.id === "milk_2pct_2l" ||
      item.id === "milk_1pct_2l" ||
      item.id === "homo_milk_2l") &&
    o.price > 0 &&
    o.price < 3.5
  ) {
    score -= 20;
  }
  return score;
}

function pickForStaple(
  offers: ProductOffer[],
  item: StapleItem,
): ProductOffer | null {
  const exact = offers.filter((o) => o.confidence === "exact");
  const pool = (exact.length ? exact : offers).filter((o) =>
    passesFilters(o, item),
  );
  if (!pool.length) return null;

  const cheapest =
    item.matchMode === "cheapest" ||
    item.category === "produce" ||
    item.category === "frozen" ||
    item.category === "eggs";

  const pickQuery =
    cheapest
      ? (item.mustIncludeAny?.[0] ??
        item.queries.find((q) => q && !/^\d+$/.test(q)) ??
        item.label)
      : (item.queries.find((q) => q && !/^\d+$/.test(q)) ?? item.label);

  if (cheapest) {
    return (
      pickCheapestOffer(pool, pickQuery, {
        targetMassKg: item.targetMassKg,
        preferNameIncludes: item.preferNameIncludes,
        byEach: item.id === "grayridge_eggs" || item.id === "large_eggs_dozen",
        preferLargerPack: item.id === "grayridge_eggs" || item.id === "large_eggs_dozen",
        requireQueryMatch: false,
      }) ?? null
    );
  }

  if (item.preferredProductId) {
    const locked = offers.find((o) => o.productId === item.preferredProductId);
    if (locked) return locked;
  }

  return (
    pickBestOffer(pool, item.label, item.preferredProductId, {
      targetMassKg: item.targetMassKg,
    }) ?? null
  );
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (args.length) {
    const { refreshWalmartSelected, PINNED_IDS } = await import("@/lib/staples");
    const ids = args.filter((id) =>
      (PINNED_IDS as readonly string[]).includes(id),
    );
    if (!ids.length) {
      console.error("No valid staple ids");
      process.exit(1);
    }
    console.error(`Refreshing WM for ${ids.length} items…`);
    const result = await refreshWalmartSelected(ids);
    for (const e of result.entries) {
      const a = e.accepted;
      console.log(
        [
          e.itemId.padEnd(28),
          e.status.padEnd(12),
          a ? `$${a.price.toFixed(2)}` : "—",
          a?.name ?? e.rejected.at(-1)?.reason ?? "",
        ].join("  "),
      );
    }
    console.error(`\nDone. log=${result.logId} updated=${result.updated.length}`);
    return;
  }

  const cfgPath = path.join(process.cwd(), "config", "cafe-staples.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as StaplesConfig;
  const storeId = cfg.store.externalStoreId;
  const wm = createWalmartConnector("L4J0A7");

  console.log(`Caching staples @ ${cfg.store.name} (#${storeId})\n`);

  const rows: Array<{
    id: string;
    label: string;
    status: "ok" | "no_match" | "unavailable";
    queriesTried: string[];
    offer: ReturnType<typeof slimOffer> | null;
    alternates: ReturnType<typeof slimOffer>[];
    notes?: string;
    image?: string;
  }> = [];

  for (const item of cfg.items) {
    if (item.unavailableAtWalmart) {
      rows.push({
        id: item.id,
        label: item.label,
        status: "unavailable",
        queriesTried: [],
        offer: null,
        alternates: [],
        notes: item.notes ?? "Not available at this Walmart",
        image: item.image,
      });
      console.log(`○ ${item.label} — UNAVAILABLE at Walmart #${storeId}`);
      continue;
    }

    const seen = new Map<string, ProductOffer>();
    const queries =
      item.matchMode === "cheapest" || item.category === "produce"
        ? item.queries
        : item.preferredProductId
          ? [item.preferredProductId, ...item.queries]
          : item.queries;
    for (const q of queries) {
      try {
        const hits = await wm.searchProducts(q, storeId);
        for (const h of hits) {
          if (!seen.has(h.productId)) seen.set(h.productId, h);
        }
        // Early stop if we already have a strong filtered hit
        const filtered = [...seen.values()].filter((o) =>
          passesFilters(o, item),
        );
        if (filtered.length >= 5) break;
      } catch (e) {
        console.log(
          `  ! ${item.id} query "${q}":`,
          e instanceof Error ? e.message.slice(0, 120) : e,
        );
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    const all = [...seen.values()];
    const best = pickForStaple(all, item);
    const alternates = all
      .filter((o) => passesFilters(o, item) && o.productId !== best?.productId)
      .slice(0, 4)
      .map(slimOffer);

    const row = {
      id: item.id,
      label: item.label,
      status: (best ? "ok" : "no_match") as "ok" | "no_match",
      queriesTried: item.queries,
      offer: best ? slimOffer(best) : null,
      alternates,
      notes: item.notes,
      image: item.image,
    };
    rows.push(row);

    if (best) {
      const mass =
        parseMassFromText(best.packageSize ?? "") ??
        parseMassFromText(best.name);
      console.log(
        `✓ ${item.label}\n    $${best.price} — ${best.name} (${best.productId})` +
          (mass ? ` [${formatMass(mass.kg)}]` : ""),
      );
    } else {
      console.log(
        `✗ ${item.label} — NO MATCH (${all.length} raw / ${all.filter((o) => passesFilters(o, item)).length} filtered)`,
      );
      for (const a of all.slice(0, 3)) {
        console.log(`    raw: $${a.price} — ${a.name.slice(0, 70)}`);
      }
    }
  }

  const outDir = path.join(process.cwd(), "data", "catalog");
  await mkdir(outDir, { recursive: true });
  const checkedAt = new Date().toISOString();
  const payload = {
    type: "walmart-staples-catalog",
    store: cfg.store,
    checkedAt,
    itemCount: rows.length,
    matched: rows.filter((r) => r.status === "ok").length,
    items: rows,
  };

  const stamp = checkedAt.replace(/[:.]/g, "-");
  const snapshot = path.join(outDir, `walmart_5831_${stamp}.json`);
  const latest = path.join(outDir, "walmart_5831_latest.json");
  await writeFile(snapshot, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(latest, JSON.stringify(payload, null, 2), "utf8");

  const preferred: Record<string, string> = {};
  for (const r of rows) {
    if (r.offer?.productId) preferred[r.id] = r.offer.productId;
  }
  await writeFile(
    path.join(outDir, "walmart_5831_preferred.json"),
    JSON.stringify(
      { storeId, updatedAt: checkedAt, preferredProductIds: preferred },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `\nSaved ${payload.matched}/${payload.itemCount} → data/catalog/walmart_5831_latest.json`,
  );
  await closeWalmartBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});

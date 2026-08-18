/**
 * Honest 5-master MVR probe (no guessed prices).
 *
 *   npx tsx src/poc/probe-mvr-staples.ts
 *
 * Prints raw Shopify suggest hits, then the matched INSTOREPRICE offer
 * (or no_match) using the same filters / pickStapleSearchWinner as production.
 */
import { parseMvrShopifyTags } from "@/connectors/store-connector";
import { MVR_ORIGIN, hydrateMvrOffer, mvrSuggest } from "@/connectors/mvr";
import {
  isShownStaple,
  loadStaplesConfig,
  pickStapleSearchWinner,
  resolveMatchMode,
  type MatchLogEntry,
} from "@/lib/staples";
import { parseMassFromText } from "@/domain/units";
import { searchMvrPool } from "@/lib/mvr-observe";

const PROBE_IDS = [
  "tomatoes_grape",
  "butter_454g",
  "simply_egg_whites",
  "milk_2pct_2l",
  "ziploc_sandwich",
] as const;

async function main() {
  const cfg = await loadStaplesConfig();
  const byId = new Map(cfg.items.filter(isShownStaple).map((i) => [i.id, i]));

  console.log(
    JSON.stringify(
      {
        source: MVR_ORIGIN,
        store: "MVR Cash & Carry, 3655 Weston Rd, North York, ON M9L 1V8",
        locationSpecific:
          "No. Single Shopify warehouse (MVR Plus). INSTOREPRICE tag is the Cash & Carry shelf; variant.price is online markup and is not used.",
        casePacks: "Kept. Compared via unit price / fair-compare, not rejected for pack size.",
      },
      null,
      2,
    ),
  );

  const rows = [];
  for (const id of PROBE_IDS) {
    const item = byId.get(id);
    if (!item) {
      rows.push({ masterId: id, error: "staple not in config" });
      continue;
    }
    const q = item.queries[0] ?? item.label;
    const rawHits = await mvrSuggest(q, 8);
    const rawSource = rawHits.map((p) => {
      const tags = parseMvrShopifyTags(p.tags);
      return {
        handle: p.handle,
        title: p.title,
        vendor: p.vendor,
        available: p.available,
        onlineSuggestPrice: p.price,
        inStorePrice: tags.inStorePrice ?? null,
        markup: tags.markup ?? null,
        url: p.handle ? `${MVR_ORIGIN}/products/${p.handle}` : null,
      };
    });

    const log: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "mvr",
      queries: [],
      rejected: [],
      status: "no_match",
    };
    const pool = await searchMvrPool(item, log);
    const picked = pickStapleSearchWinner(item, pool, log);
    const matched = picked ? await hydrateMvrOffer(picked) : null;
    const mode = resolveMatchMode(item);
    rows.push({
      masterId: id,
      label: item.label,
      matchMode: mode,
      queries: item.queries,
      rawSource,
      matchedMvr: matched
        ? {
            productId: matched.productId,
            name: matched.name,
            upc: matched.upc ?? null,
            packageSize: matched.packageSize ?? null,
            parsedMassKg:
              parseMassFromText(matched.packageSize ?? "")?.kg ??
              parseMassFromText(matched.name)?.kg ??
              null,
            price: matched.price,
            unitPrice: matched.unitPrice ?? null,
            availability: matched.availability,
            sourceUrl: matched.sourceUrl ?? null,
          }
        : null,
      matchConfidence: matched
        ? mode === "cheapest"
          ? 0.85
          : 0.9
        : null,
      matchKind: matched
        ? mode === "cheapest"
          ? "staple_winner"
          : "identity"
        : null,
      status: matched ? log.status : "no_match",
      rejectedSample: log.rejected.slice(0, 6),
    });
  }

  console.log(JSON.stringify({ probe: rows }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

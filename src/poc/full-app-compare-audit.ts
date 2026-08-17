/**
 * Full-app catalog/compare audit: prices, packs, illogical deals.
 *   npx tsx src/poc/full-app-compare-audit.ts
 *
 * Uses cached JSON catalogs + mappings. Does not call Rapid or PCX.
 */
import {
  resolveCatalogOffer,
  retailerSkusEquivalent,
} from "@/domain/compare-resolve";
import { nameMatchesFilterToken } from "@/domain/catalog-normalize";
import { parseEmbeddedWeightRates } from "@/domain/units";
import { buildStapleCompareRow } from "@/lib/staple-compare-row";
import {
  evaluateOfferStatus,
  isShownStaple,
  loadConfirmed,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  resolveMatchMode,
  type CatalogOffer,
} from "@/lib/staples";
import {
  isPreferredIdentityRejected,
  loadRetailerMappings,
  lookupConfirmed,
} from "@/lib/retailer-mappings";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function usableStatus(status: string): boolean {
  return status === "ok" || status === "stale";
}

async function main() {
  const cfg = await loadStaplesConfig();
  const wmCat = await loadWalmartCatalog();
  const nfCat = await loadNoFrillsCatalog();
  const mappings = await loadRetailerMappings();
  const confirmed = await loadConfirmed();

  assert(wmCat, "walmart catalog");
  assert(nfCat, "nofrills catalog");

  const wmById = new Map(wmCat!.items.map((r) => [r.id, r]));
  const nfById = new Map(nfCat!.items.map((r) => [r.id, r]));
  const items = cfg.items.filter(isShownStaple);

  assert(
    retailerSkusEquivalent(
      "6000195369896",
      "6000195369895",
    ),
    "Ziploc Rapid off-by-one",
  );
  assert(
    nameMatchesFilterToken("grape tomato seeds", "seed"),
    "seed token matches seeds",
  );
  assert(
    !nameMatchesFilterToken("seedless grape tomatoes", "seed"),
    "seed must not match seedless",
  );

  const rows = [];
  const issues: string[] = [];

  for (const item of items) {
    const mode = resolveMatchMode(item);
    const conf = lookupConfirmed(confirmed, item.id);
    if (conf?.productId) item.preferredProductId = conf.productId;
    const wmLink = mappings.products[item.id]?.retailers.walmart_ca;
    const nfLink = mappings.products[item.id]?.retailers.nofrills;
    const wmRow = wmById.get(item.id);
    const nfRow = nfById.get(item.id);

    const wmResolved = resolveCatalogOffer({
      item,
      row: wmRow,
      link: wmLink,
      matchMode: mode,
    });
    const nfResolved = resolveCatalogOffer({
      item,
      row: nfRow,
      link: nfLink,
      matchMode: mode,
    });

    const wmOffer = (wmResolved.offer as CatalogOffer | null) ?? null;
    const nfOffer = (nfResolved.offer as CatalogOffer | null) ?? null;
    const wmEval = evaluateOfferStatus(item, wmOffer, {
      catalogStatus: wmRow?.status,
    });
    const nfEval = evaluateOfferStatus(item, nfOffer, {
      catalogStatus: nfRow?.status,
    });
    if (wmResolved.reason === "mapped_sku_missing") {
      wmEval.status = "no_match";
      wmEval.reason = wmResolved.detail;
    }
    if (wmResolved.reason === "rejected_filter") {
      wmEval.status = "rejected";
      wmEval.reason = wmResolved.detail;
    }
    if (nfResolved.reason === "rejected_filter") {
      nfEval.status = "rejected";
      nfEval.reason = nfResolved.detail;
    }

    const wmUsable = Boolean(wmOffer && usableStatus(wmEval.status));
    const nfUsable = Boolean(nfOffer && usableStatus(nfEval.status));
    const grams = item.id.endsWith("_kg") || item.id.includes("kg") ? 1000 : null;

    const row = buildStapleCompareRow({
      item,
      wmOffer: wmUsable ? wmOffer : null,
      nfOffer: nfUsable ? nfOffer : null,
      wmEval,
      nfEval,
      wmUsable,
      nfUsable,
      grams,
      confirmed: Boolean(conf),
      mappingDecision: wmLink?.decision,
      resolveReason: {
        walmart: wmResolved.reason,
        noFrills: nfResolved.reason,
      },
    });
    rows.push(row);

    const wmName = String((row.walmart as { name?: string }).name ?? "");
    if (/seed/i.test(wmName) && item.id === "tomatoes_grape") {
      issues.push(`${item.id}: tomato seeds used as grape tomatoes`);
    }
    if (
      row.cheaper !== "incomplete" &&
      isPreferredIdentityRejected(mode, wmLink)
    ) {
      issues.push(`${item.id}: preferred identity rejected but still a deal`);
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));

  const grape = byId.get("tomatoes_grape");
  assert(grape, "grape row");
  assert(grape!.cheaper === "incomplete", `grape cheaper ${grape!.cheaper}`);
  assert(
    grape!.resolveReason?.walmart === "mapped_sku_missing",
    `grape wm reason ${grape!.resolveReason?.walmart}`,
  );
  assert(
    !/seed/i.test(String((grape!.walmart as { name?: string }).name ?? "")),
    "grape must not show seeds",
  );

  const ziploc = byId.get("ziploc_sandwich");
  assert(ziploc, "ziploc row");
  assert(
    ziploc!.resolveReason?.walmart === "mapped_sku_rapid_alias" ||
      ziploc!.resolveReason?.walmart === "mapped_sku",
    `ziploc reason ${ziploc!.resolveReason?.walmart}`,
  );
  assert(ziploc!.cheaper === "walmart", `ziploc cheaper ${ziploc!.cheaper}`);
  const zWm = ziploc!.walmart as { shelfPrice?: number; name?: string };
  assert(
    zWm.shelfPrice === 9.97,
    `ziploc wm price ${zWm.shelfPrice}`,
  );
  assert(/ziploc/i.test(zWm.name ?? ""), "ziploc name");

  const folgers = byId.get("folgers_coffee");
  assert(folgers, "folgers row");
  assert(
    folgers!.cheaper === "incomplete",
    `folgers must not be a deal (${folgers!.cheaper})`,
  );
  assert(
    folgers!.fairBasis === "incomparable" ||
      folgers!.resolveReason?.noFrills === "rejected_filter",
    `folgers basis ${folgers!.fairBasis} nf ${folgers!.resolveReason?.noFrills}`,
  );

  const eggs = byId.get("eggs_30ct");
  assert(eggs, "eggs row");
  assert(eggs!.fairBasis === "per_egg", `eggs basis ${eggs!.fairBasis}`);
  assert(eggs!.cheaper === "tie" || eggs!.cheaper === "walmart" || eggs!.cheaper === "nofrills", "eggs comparable");

  const whites = byId.get("simply_egg_whites");
  assert(whites, "egg whites");
  assert(
    whites!.fairBasis === "per_kg" || whites!.fairBasis === "per_pack",
    `egg whites basis ${whites!.fairBasis}`,
  );
  const wWm = whites!.walmart as { pricePerKg?: number; shelfPrice?: number; name?: string };
  const wNf = whites!.noFrills as { pricePerKg?: number; shelfPrice?: number };
  if (whites!.fairBasis === "per_kg") {
    assert(
      (wWm.pricePerKg ?? 0) < 11 && (wNf.pricePerKg ?? 0) > 10,
      `egg whites $/kg wm=${wWm.pricePerKg} nf=${wNf.pricePerKg}`,
    );
  }
  assert(
    Math.abs((wWm.shelfPrice ?? 0) - 9.47) < 0.01,
    `egg whites wm shelf ${wWm.shelfPrice}`,
  );

  const butter = byId.get("butter_454g");
  assert(butter, "butter");
  assert(butter!.fairBasis === "per_pack", `butter ${butter!.fairBasis}`);
  assert(butter!.cheaper === "walmart", `butter cheaper ${butter!.cheaper}`);

  const milk = byId.get("milk_2pct_2l");
  assert(milk, "milk");
  assert(
    milk!.fairBasis === "per_pack" || milk!.fairBasis === "per_kg",
    `milk basis ${milk!.fairBasis}`,
  );

  const bananas = byId.get("bananas_kg");
  assert(bananas, "bananas");
  const bNf = nfById.get("bananas_kg")?.offer;
  const embedded = parseEmbeddedWeightRates(bNf?.packageSize ?? "");
  assert(embedded.perKg === 1.52, `nf banana embedded ${embedded.perKg}`);
  const bRowWm = bananas!.walmart as { pricePerKg?: number };
  const bRowNf = bananas!.noFrills as { pricePerKg?: number };
  assert(
    bRowNf.pricePerKg != null && Math.abs(bRowNf.pricePerKg - 1.52) < 0.05,
    `banana nf $/kg ${bRowNf.pricePerKg} (not shelf $1.75 as kg)`,
  );
  assert(
    bRowWm.pricePerKg != null && bRowWm.pricePerKg < 3,
    `banana wm $/kg ${bRowWm.pricePerKg}`,
  );

  const pears = byId.get("pear_bosc_kg");
  assert(pears, "pears");
  const pNf = pears!.noFrills as { pricePerKg?: number; shelfPrice?: number };
  assert(
    (pNf.pricePerKg ?? 0) > 5,
    `pear nf must use $6.59/kg not shelf $0.92 (got ${pNf.pricePerKg})`,
  );
  assert(pears!.fairBasis === "per_kg", `pears ${pears!.fairBasis}`);

  const oat = byId.get("oat_beverage_original");
  assert(oat, "oat");
  assert(oat!.cheaper !== "incomplete", `oat should compare (${oat!.cheaper})`);

  const almond = byId.get("almond_original");
  assert(almond, "almond");
  assert(almond!.cheaper !== "incomplete", `almond should compare (${almond!.cheaper})`);

  const complete = rows.filter((r) => r.cheaper !== "incomplete");
  assert(
    !complete.some((r) => r.id === "folgers_coffee"),
    "folgers excluded from basket",
  );
  assert(
    !complete.some((r) => r.id === "tomatoes_grape"),
    "grape without mapped price excluded from basket",
  );

  const wmSum = complete.reduce((s, r) => s + (r.basketWalmart ?? 0), 0);
  const nfSum = complete.reduce((s, r) => s + (r.basketNoFrills ?? 0), 0);
  assert(wmSum > 0 && nfSum > 0, "basket totals");
  assert(issues.length === 0, issues.join("; "));

  const incompleteRows = rows.filter((r) => r.cheaper === "incomplete");
  const summary = {
    rows: rows.length,
    complete: complete.length,
    incomplete: incompleteRows.length,
    incompleteIds: incompleteRows.map((r) => r.id),
    wmBasket: Math.round(wmSum * 100) / 100,
    nfBasket: Math.round(nfSum * 100) / 100,
    grape: grape!.resolveReason,
    ziploc: { cheaper: ziploc!.cheaper, reason: ziploc!.resolveReason?.walmart },
    folgers: { cheaper: folgers!.cheaper, basis: folgers!.fairBasis },
    eggWhites: { cheaper: whites!.cheaper, basis: whites!.fairBasis },
    pears: { cheaper: pears!.cheaper, nfPerKg: pNf.pricePerKg },
    bananas: { cheaper: bananas!.cheaper, nfPerKg: bRowNf.pricePerKg },
  };
  console.log("full-app-compare-audit", summary);
  console.log("full-app-compare-audit ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

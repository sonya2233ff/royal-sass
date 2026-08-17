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
  defaultNeededGrams,
  isSoldByWeightItem,
  resolveMatchMode,
  usesNeededWeightPick,
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

    const packPickGrams =
      usesNeededWeightPick(item) && !isSoldByWeightItem(item)
        ? defaultNeededGrams(item)
        : undefined;
    const wmResolved = resolveCatalogOffer({
      item,
      row: wmRow,
      link: wmLink,
      matchMode: mode,
      neededGrams: packPickGrams,
    });
    const nfResolved = resolveCatalogOffer({
      item,
      row: nfRow,
      link: nfLink,
      matchMode: mode,
      neededGrams: packPickGrams,
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
    const grams = usesNeededWeightPick(item)
      ? defaultNeededGrams(item)
      : null;

    const row = buildStapleCompareRow({
      item,
      wmOffer: wmUsable ? wmOffer : null,
      nfOffer: nfUsable ? nfOffer : null,
      wmEval,
      nfEval,
      wmUsable,
      nfUsable,
      grams,
      qty: 1,
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
  assert(
    grape!.fairBasis === "needed_weight",
    `grape basis ${grape!.fairBasis}`,
  );
  assert(
    grape!.cheaper === "walmart" || grape!.cheaper === "nofrills" || grape!.cheaper === "tie",
    `grape cheaper ${grape!.cheaper}`,
  );
  assert(
    grape!.resolveReason?.walmart === "mapped_sku_rapid_alias" ||
      grape!.resolveReason?.walmart === "mapped_sku",
    `grape wm reason ${grape!.resolveReason?.walmart}`,
  );
  const gWm = grape!.walmart as { shelfPrice?: number; name?: string };
  assert(
    !/seed/i.test(gWm.name ?? ""),
    "grape must not show seeds",
  );
  assert(
    Math.abs((gWm.shelfPrice ?? 0) - 2.97) < 0.01,
    `grape wm shelf ${gWm.shelfPrice}`,
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
    zWm.shelfPrice != null && zWm.shelfPrice >= 7 && zWm.shelfPrice <= 13,
    `ziploc wm price ${zWm.shelfPrice}`,
  );
  assert(/ziploc/i.test(zWm.name ?? ""), "ziploc name");

  const whites = byId.get("simply_egg_whites");
  assert(whites, "egg whites");
  const wWm = whites!.walmart as {
    pricePerKg?: number;
    shelfPrice?: number;
    name?: string;
    productId?: string;
  };
  const wNf = whites!.noFrills as {
    pricePerKg?: number;
    shelfPrice?: number;
    name?: string;
  };
  assert(
    /simply egg whites/i.test(wWm.name ?? ""),
    `egg whites WM must be Simply Egg Whites, got ${wWm.name}`,
  );
  assert(
    Math.abs((wWm.shelfPrice ?? 0) - 9.47) < 0.01,
    `egg whites wm shelf ${wWm.shelfPrice}`,
  );
  assert(
    whites!.matchKind === "preferred_sku" || whites!.matchKind === "upc",
    `egg whites matchKind ${whites!.matchKind}`,
  );
  // Category A: Free Run 500g is a different product — not a deal vs 1kg Simply.
  if (/free run/i.test(wNf.name ?? "")) {
    assert(
      whites!.cheaper === "incomplete",
      `egg whites Free Run analogue must not be a deal (${whites!.cheaper})`,
    );
  } else if (whites!.fairBasis === "per_100g" || whites!.fairBasis === "per_pack") {
    assert(whites!.cheaper !== "incomplete", "egg whites same-product compare");
  } else {
    assert(
      whites!.cheaper === "incomplete",
      `egg whites expected incomplete until NF has Simply 1kg, got ${whites!.fairBasis}`,
    );
  }

  const butter = byId.get("butter_454g");
  assert(butter, "butter");
  assert(butter!.fairBasis === "per_pack", `butter ${butter!.fairBasis}`);
  assert(butter!.cheaper === "walmart", `butter cheaper ${butter!.cheaper}`);

  const milk = byId.get("milk_2pct_2l");
  assert(milk, "milk");
  assert(
    milk!.fairBasis === "per_pack" || milk!.fairBasis === "per_100g",
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
  assert(pears!.fairBasis === "per_100g", `pears ${pears!.fairBasis}`);

  const oat = byId.get("oat_beverage_original");
  assert(oat, "oat");
  assert(oat!.cheaper !== "incomplete", `oat should compare (${oat!.cheaper})`);

  const almond = byId.get("almond_original");
  assert(almond, "almond");
  assert(almond!.cheaper !== "incomplete", `almond should compare (${almond!.cheaper})`);

  const oj = byId.get("orange_juice_pulp");
  assert(oj, "orange juice");
  assert(oj!.cheaper !== "incomplete", `OJ should compare (${oj!.cheaper})`);
  assert(
    oj!.fairBasis === "per_100g" || oj!.fairBasis === "per_pack",
    `OJ basis ${oj!.fairBasis}`,
  );
  const ojNf = oj!.noFrills as { shelfPrice?: number; name?: string };
  assert((ojNf.shelfPrice ?? 0) > 0, `OJ missing NF shelf ${ojNf.shelfPrice}`);
  assert(/tropicana/i.test(ojNf.name ?? ""), `OJ NF name ${ojNf.name}`);

  const complete = rows.filter((r) => r.cheaper !== "incomplete");

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

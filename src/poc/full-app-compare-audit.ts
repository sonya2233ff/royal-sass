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
  explicitNeededGrams,
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

    const packPickGrams = explicitNeededGrams(item);
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
    const grams = isSoldByWeightItem(item)
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
  const gWm = grape!.walmart as { shelfPrice?: number; name?: string };
  assert(!/seed/i.test(gWm.name ?? ""), "grape must not show seeds");
  assert(
    grape!.basketWalmart != null,
    "WM grape must be a priced pack, not N/A from the OOS 10 oz lock",
  );
  assert(
    /grape tomato/i.test(gWm.name ?? ""),
    `WM grape pack name ${gWm.name}`,
  );
  assert(
    grape!.fairBasis === "per_100g" ||
      grape!.fairBasis === "per_pack" ||
      grape!.fairBasis === "needed_weight",
    `grape packed basis ${grape!.fairBasis}`,
  );
  assert(
    Math.abs((gWm.shelfPrice ?? 0) - 2.97) > 0.05,
    `OOS 10 oz must not win WM grape compare (shelf=${gWm.shelfPrice})`,
  );
  const gNf = grape!.noFrills as { name?: string };
  assert(
    !/pickled|blue grapes|398\s*ml/i.test(gNf.name ?? ""),
    `grape NF must not be pickled/grapes/canned, got ${gNf.name}`,
  );
  assert(
    /grape tomato/i.test(gNf.name ?? ""),
    `grape NF must be a grape tomato pack, got ${gNf.name}`,
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
    productId?: string;
    packsNeeded?: number | null;
    lineTotal?: number | null;
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
  assert(
    !/free run/i.test(wNf.name ?? ""),
    `NF egg whites must not be Free Run, got ${wNf.name}`,
  );
  assert(
    /simply egg whites/i.test(wNf.name ?? ""),
    `NF egg whites must be Simply, got ${wNf.name}`,
  );
  assert(
    wNf.productId === "20820355001_EA",
    `NF Simply SKU ${wNf.productId}`,
  );
  assert(
    Math.abs((wNf.shelfPrice ?? 0) - 5.49) < 0.01,
    `NF Simply 500 ml shelf ${wNf.shelfPrice}`,
  );
  assert(
    wNf.packsNeeded === 2,
    `NF 500 ml composes to 2 packs, got ${wNf.packsNeeded}`,
  );
  assert(
    Math.abs((wNf.lineTotal ?? 0) - 10.98) < 0.01,
    `NF 2 × $5.49 = $10.98, got ${wNf.lineTotal}`,
  );
  assert(
    Math.abs((whites!.basketNoFrills ?? 0) - 10.98) < 0.01,
    `NF basket line ${whites!.basketNoFrills}`,
  );
  assert(
    whites!.cheaper !== "incomplete",
    "WM 1kg Simply and NF 2×500 ml Simply are the same product",
  );

  const butter = byId.get("butter_454g");
  assert(butter, "butter");
  assert(butter!.fairBasis === "per_pack", `butter ${butter!.fairBasis}`);
  assert(butter!.cheaper === "walmart", `butter cheaper ${butter!.cheaper}`);

  const milk = byId.get("milk_2pct_2l");
  assert(milk, "milk");
  assert(
    milk!.fairBasis === "per_pack" ||
      milk!.fairBasis === "per_100g" ||
      milk!.fairBasis === "incomparable",
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
  const oatWm = oat!.walmart as { name?: string };
  assert(
    /zero sugar/i.test(oatWm.name ?? ""),
    `oat WM stays the Zero Sugar exception, got ${oatWm.name}`,
  );

  const almond = byId.get("almond_original");
  assert(almond, "almond");
  assert(almond!.cheaper !== "incomplete", `almond should compare (${almond!.cheaper})`);

  const oj = byId.get("orange_juice_pulp");
  assert(oj, "orange juice");
  assert(oj!.cheaper !== "incomplete", `OJ should compare (${oj!.cheaper})`);
  assert(
    oj!.fairBasis === "per_100g" ||
      oj!.fairBasis === "per_pack" ||
      oj!.fairBasis === "needed_weight",
    `OJ basis ${oj!.fairBasis}`,
  );
  const ojNf = oj!.noFrills as { shelfPrice?: number; name?: string };
  assert((ojNf.shelfPrice ?? 0) > 0, `OJ missing NF shelf ${ojNf.shelfPrice}`);
  assert(/tropicana/i.test(ojNf.name ?? ""), `OJ NF name ${ojNf.name}`);

  const tomato = byId.get("tomato");
  assert(tomato, "tomato");
  assert(
    !/unico/i.test(String((tomato!.noFrills as { name?: string }).name ?? "")),
    `fresh tomato NF must not be Unico canned, got ${(tomato!.noFrills as { name?: string }).name}`,
  );
  const wraps = byId.get("wraps_plain_6in");
  assert(wraps, "wraps");
  assert(
    !/pumpkin|foam/i.test(String((wraps!.noFrills as { name?: string }).name ?? "")),
    `6in wraps NF must not be a foam pumpkin, got ${(wraps!.noFrills as { name?: string }).name}`,
  );

  const wmNameOf = (id: string) =>
    String((byId.get(id)?.walmart as { name?: string } | undefined)?.name ?? "");
  assert(
    !/portion cup|2000\/case|4oz/i.test(wmNameOf("lids_bagasse_bowl")),
    `bagasse lids must not be a 4oz portion-cup case, got ${wmNameOf("lids_bagasse_bowl")}`,
  );
  assert(
    !/per case|12 oz bowl/i.test(wmNameOf("lids_dome_12_24oz")),
    `12-24oz dome lids must not be a bowl warehouse case, got ${wmNameOf("lids_dome_12_24oz")}`,
  );
  assert(
    !/1000 unit/i.test(wmNameOf("lids_dome_no_hole")),
    `no-hole dome lids must not be a 1000-unit pack, got ${wmNameOf("lids_dome_no_hole")}`,
  );
  assert(
    !/7\.7/i.test(wmNameOf("party_tray_12x12")),
    `12x12 tray must not be 7.7 inch, got ${wmNameOf("party_tray_12x12")}`,
  );
  assert(
    !/mint/i.test(wmNameOf("oreo_sandwich_cookies")),
    `oreo must not be mint crème, got ${wmNameOf("oreo_sandwich_cookies")}`,
  );
  assert(
    !/baking/i.test(wmNameOf("pam_cookware_coating")),
    `pam must not be baking spray, got ${wmNameOf("pam_cookware_coating")}`,
  );
  assert(
    !/2oz|shot cup/i.test(wmNameOf("cups_16oz_pet")),
    `16oz PET must not be 2oz shot cups, got ${wmNameOf("cups_16oz_pet")}`,
  );
  const cream = byId.get("cream_cheese_bars");
  assert(cream, "cream cheese bars");
  assert(
    !/mozzarella/i.test(
      String((cream!.wholesaleClub as { name?: string } | undefined)?.name ?? ""),
    ),
    `cream cheese bars WC must not be mozzarella, got ${(cream!.wholesaleClub as { name?: string } | undefined)?.name}`,
  );
  assert(
    !/light brown|golden yellow/i.test(wmNameOf("brown_sugar")),
    `dark brown sugar must not be light brown, got ${wmNameOf("brown_sugar")}`,
  );
  assert(
    !/11\.02|mini mitt/i.test(wmNameOf("oven_mitts")),
    `oven mitt must not be 11in consumer, got ${wmNameOf("oven_mitts")}`,
  );
  assert(
    !/284\s*ml/i.test(
      String((byId.get("mushrooms_sliced")?.noFrills as { name?: string } | undefined)?.name ?? "") +
        String((byId.get("mushrooms_sliced")?.noFrills as { packageSize?: string } | undefined)?.packageSize ?? ""),
    ),
    "sliced mushrooms NF must not be canned 284 ml",
  );

  const cottageRow = byId.get("cottage_cheese");
  assert(cottageRow, "cottage cheese");
  assert(
    !/great value|nordica|no name/i.test(wmNameOf("cottage_cheese")),
    `cottage WM must not be Great Value, got ${wmNameOf("cottage_cheese")}`,
  );
  assert(
    /mehadrin/i.test(
      String((cottageRow!.noFrills as { name?: string } | undefined)?.name ?? ""),
    ),
    `cottage NF must be Mehadrin, got ${(cottageRow!.noFrills as { name?: string } | undefined)?.name}`,
  );
  assert(
    !/nordica|no name|great value/i.test(
      String((cottageRow!.wholesaleClub as { name?: string } | undefined)?.name ?? ""),
    ),
    `cottage WC must not be No Name, got ${(cottageRow!.wholesaleClub as { name?: string } | undefined)?.name}`,
  );

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

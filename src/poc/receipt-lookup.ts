/**
 * Look up receipt items at Walmart #5831 + No Frills #3660.
 * Old receipt prices are reference only — we fetch CURRENT API prices.
 * Compares like-for-like pack size (eggs 1 kg) and weight (pepper kg vs lb).
 */
import { WalmartConnector } from "@/connectors/walmart";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import { NoFrillsConnector } from "@/connectors/nofrills";
import type { ProductOffer } from "@/connectors/types";
import { pickBestOffer } from "@/domain/matching";
import {
  formatMass,
  parseMassFromText,
  pickBestSizedOffer,
  priceByPackCount,
  priceForMassKg,
  round2,
} from "@/domain/units";
import { persistComparisonRun } from "@/lib/persistence";

interface ReceiptLine {
  label: string;
  upc: string;
  /** Line total on old receipt (CAD) */
  receiptPrice: number;
  qty?: number;
  skip?: boolean;
  note?: string;
  /** Expected pack mass for packaged goods (eggs = 1 kg carton) */
  targetPackKg?: number;
  /** Purchase weight for variable-weight produce (receipt weighed amount) */
  purchaseKg?: number;
  /** Receipt $/kg when sold by weight */
  receiptPerKg?: number;
  queries?: string[];
}

const RECEIPT: ReceiptLine[] = [
  {
    label: "Simply Egg Whites",
    upc: "065651002470",
    receiptPrice: 9.47,
    qty: 4,
    // UPC 065651002470 / 6565100247 = Naturegg Simply Egg Whites **1 kg** carton
    targetPackKg: 1,
    note: "receipt UPC = 1 kg carton (not 500 g)",
    queries: [
      "065651002470",
      "6565100247",
      "naturegg simply egg whites 1kg",
      "simply egg whites 1 kg",
      "simply egg whites 1000g",
      "simply egg whites 1 l",
    ],
  },
  {
    label: "Red Pepper",
    upc: "46880",
    receiptPrice: 4.52,
    qty: 1,
    purchaseKg: 0.84,
    receiptPerKg: 5.38,
    note: "receipt: 0.840 kg @ $5.38/kg — compare $/kg (normalize lb→kg); prefer bulk sold-by-kg",
    queries: ["red peppers", "red pepper", "red bell pepper kg", "46830", "46880"],
  },
  {
    label: "PAPER BAG",
    upc: "000000012340",
    receiptPrice: 0.25,
    skip: true,
    note: "bag fee",
  },
];

function describePack(offer: ProductOffer): string {
  const mass =
    parseMassFromText(offer.packageSize ?? "") ??
    parseMassFromText(offer.name);
  if (mass) return `${mass.value} ${mass.unit}`;
  if (offer.packageSize) return offer.packageSize;
  if (offer.productId.endsWith("_KG")) return "sold by kg";
  return "size unknown";
}

function pickOffer(
  offers: ProductOffer[],
  line: ReceiptLine,
): ProductOffer | null {
  return pickBestSizedOffer(offers, line.label, {
    preferredUpc: line.upc,
    targetMassKg: line.targetPackKg,
    pickBestOffer,
  });
}

function compareLine(
  line: ReceiptLine,
  offer: ProductOffer | null,
  qty: number,
): {
  name?: string;
  productId?: string;
  shelfPrice?: number;
  pack?: string;
  confidence?: string;
  lineTotal: number | null;
  pricePerKg?: number;
  packsNeeded?: number;
  coveredKg?: number;
  basis?: string;
  comparable: boolean;
  note?: string;
} {
  if (!offer) {
    return { lineTotal: null, comparable: false };
  }

  if (line.purchaseKg != null) {
    const priced = priceForMassKg(offer, line.purchaseKg);
    if (!priced) {
      return {
        name: offer.name,
        productId: offer.productId,
        shelfPrice: offer.price,
        pack: describePack(offer),
        confidence: offer.confidence,
        lineTotal: null,
        comparable: false,
        note: "cannot convert to $/kg (single unit, mass unknown) — skip fair compare",
      };
    }
    return {
      name: offer.name,
      productId: offer.productId,
      shelfPrice: offer.price,
      pack: describePack(offer),
      confidence: offer.confidence,
      lineTotal: priced.lineTotal,
      pricePerKg: round2(priced.pricePerKg),
      basis: priced.basis,
      comparable: true,
    };
  }

  // Packaged goods: match same pack if possible; else buy enough smaller packs for same total kg
  const needKg =
    line.targetPackKg != null ? line.targetPackKg * qty : null;
  if (needKg != null) {
    const byPacks = priceByPackCount(offer, needKg);
    if (byPacks) {
      const sameSize =
        Math.abs(byPacks.packKg - (line.targetPackKg ?? byPacks.packKg)) /
          (line.targetPackKg ?? byPacks.packKg) <=
        0.2;
      return {
        name: offer.name,
        productId: offer.productId,
        shelfPrice: offer.price,
        pack: describePack(offer),
        confidence: offer.confidence,
        lineTotal: byPacks.lineTotal,
        pricePerKg: byPacks.pricePerKg,
        packsNeeded: byPacks.packsNeeded,
        coveredKg: byPacks.coveredKg,
        basis: byPacks.basis,
        comparable: true,
        note: sameSize
          ? undefined
          : `composed: ${byPacks.basis} covers ${formatMass(byPacks.coveredKg)} (need ${formatMass(needKg)})`,
      };
    }
  }

  return {
    name: offer.name,
    productId: offer.productId,
    shelfPrice: offer.price,
    pack: describePack(offer),
    confidence: offer.confidence,
    lineTotal: round2(offer.price * qty),
    comparable: line.targetPackKg == null,
    note:
      line.targetPackKg != null
        ? "pack size unknown — cannot compose to target mass"
        : undefined,
  };
}

async function main() {
  const wm = new WalmartConnector("L4J0A7");
  const nf = new NoFrillsConnector();

  console.log("Receipt store: Walmart #5831 — OLD prices (Jan 2024-ish)");
  console.log("Compare CURRENT: Walmart #5831 + No Frills #3660");
  console.log("Rules: eggs → 1 kg or compose smaller packs to same kg; pepper → 0.84 kg ($/kg)\n");

  const rows: unknown[] = [];

  for (const line of RECEIPT) {
    if (line.skip) {
      console.log(`SKIP ${line.label} (${line.note})`);
      continue;
    }

    const qty = line.qty ?? 1;
    const queries = line.queries ?? [line.upc, line.label];

    let wmOffer: ProductOffer | null = null;
    let wmNote = "";
    let wmRaw = 0;
    for (const q of queries) {
      try {
        const offers = await wm.searchProducts(q, "5831");
        wmRaw = Math.max(wmRaw, offers.length);
        const best = pickOffer(offers, line);
        if (best?.confidence === "exact") {
          // Prefer better mass match if we already have something
          if (!wmOffer) wmOffer = best;
          else {
            const cur =
              (line.targetPackKg
                ? Math.abs(
                    (parseMassFromText(wmOffer.name)?.kg ?? 0) -
                      line.targetPackKg,
                  )
                : 0) -
              (line.targetPackKg
                ? Math.abs(
                    (parseMassFromText(best.name)?.kg ?? 99) - line.targetPackKg,
                  )
                : 0);
            if (cur > 0) wmOffer = best;
          }
          const mass = parseMassFromText(best.packageSize ?? "") ?? parseMassFromText(best.name);
          if (line.targetPackKg && mass && Math.abs(mass.kg - line.targetPackKg) / line.targetPackKg <= 0.12) {
            wmOffer = best;
            break;
          }
          if (line.purchaseKg && (best.productId.endsWith("_KG") || best.unitPrice != null)) {
            wmOffer = best;
            break;
          }
        } else if (!wmOffer && best) wmOffer = best;
      } catch (e) {
        wmNote = e instanceof Error ? e.message.slice(0, 160) : String(e);
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    let nfOffer: ProductOffer | null = null;
    for (const q of queries) {
      try {
        const offers = await nf.searchProducts(q, "3660");
        const best = pickOffer(offers, line);
        if (best) {
          nfOffer = best;
          const mass =
            parseMassFromText(best.packageSize ?? "") ??
            parseMassFromText(best.name);
          if (
            line.targetPackKg &&
            mass &&
            Math.abs(mass.kg - line.targetPackKg) / line.targetPackKg <= 0.12
          ) {
            break;
          }
          if (line.purchaseKg && best.productId.endsWith("_KG")) break;
        }
      } catch (e) {
        console.log(
          `  No Frills error:`,
          e instanceof Error ? e.message.slice(0, 120) : e,
        );
      }
    }

    const receiptLineTotal =
      line.purchaseKg != null
        ? round2((line.receiptPerKg ?? line.receiptPrice / line.purchaseKg) * line.purchaseKg)
        : round2(line.receiptPrice * qty);

    const wmCmp = compareLine(line, wmOffer, qty);
    const nfCmp = compareLine(line, nfOffer, qty);

    rows.push({
      label: line.label,
      upc: line.upc,
      qty,
      targetPackKg: line.targetPackKg,
      purchaseKg: line.purchaseKg,
      receiptUnitPrice: line.receiptPrice,
      receiptPerKg: line.receiptPerKg,
      receiptLineTotal,
      note: line.note,
      walmart: wmCmp,
      noFrills: nfCmp,
      wmRawHits: wmRaw,
    });

    console.log(`\n=== ${line.label} × ${qty}${line.purchaseKg ? ` (${formatMass(line.purchaseKg)})` : ""}`);
    if (line.targetPackKg) {
      console.log(`  Target pack: ${formatMass(line.targetPackKg)} (UPC ${line.upc})`);
    }
    if (line.receiptPerKg != null && line.purchaseKg != null) {
      console.log(
        `  Receipt (old): $${line.receiptPerKg}/kg × ${formatMass(line.purchaseKg)} = $${receiptLineTotal}`,
      );
    } else {
      console.log(`  Receipt (old): $${line.receiptPrice} each × ${qty} = $${receiptLineTotal}`);
    }

    if (wmCmp.lineTotal != null && wmCmp.comparable) {
      console.log(
        `  Walmart #5831 NOW: $${wmCmp.lineTotal}` +
          (wmCmp.pricePerKg != null ? ` ($${wmCmp.pricePerKg}/kg)` : "") +
          (wmCmp.packsNeeded != null ? ` [${wmCmp.basis}]` : "") +
          ` — ${wmCmp.name} [${wmCmp.pack}] [${wmCmp.confidence}]`,
      );
      if (wmCmp.note) console.log(`    ${wmCmp.note}`);
    } else {
      console.log(`  Walmart #5831 NOW: NO COMPARABLE MATCH`);
      if (wmCmp.name) {
        console.log(
          `    saw: $${wmCmp.shelfPrice} — ${wmCmp.name} [${wmCmp.pack}]` +
            (wmCmp.note ? ` — ${wmCmp.note}` : ""),
        );
      } else if (wmNote) console.log(`  Walmart note: ${wmNote}`);
    }

    if (nfCmp.lineTotal != null && nfCmp.comparable) {
      console.log(
        `  No Frills #3660 NOW: $${nfCmp.lineTotal}` +
          (nfCmp.pricePerKg != null ? ` ($${nfCmp.pricePerKg}/kg)` : "") +
          (nfCmp.packsNeeded != null ? ` [${nfCmp.basis}]` : "") +
          ` — ${nfCmp.name} [${nfCmp.pack}] [${nfCmp.confidence}]`,
      );
      if (nfCmp.note) console.log(`    ${nfCmp.note}`);
    } else {
      console.log(`  No Frills #3660 NOW: NO COMPARABLE MATCH`);
      if (nfCmp.name) {
        console.log(
          `    saw: $${nfCmp.shelfPrice} — ${nfCmp.name} [${nfCmp.pack}]` +
            (nfCmp.note ? ` — ${nfCmp.note}` : ""),
        );
      }
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  const groceryRows = rows as Array<{
    receiptLineTotal: number;
    walmart: { lineTotal: number | null; comparable: boolean };
    noFrills: { lineTotal: number | null; comparable: boolean };
  }>;

  const receiptGrocery = groceryRows.reduce((s, r) => s + r.receiptLineTotal, 0);
  const wmOk = groceryRows.every((r) => r.walmart.lineTotal != null && r.walmart.comparable);
  const nfOk = groceryRows.every((r) => r.noFrills.lineTotal != null && r.noFrills.comparable);
  const wmTotal = wmOk
    ? round2(groceryRows.reduce((s, r) => s + (r.walmart.lineTotal ?? 0), 0))
    : null;
  const nfTotal = nfOk
    ? round2(groceryRows.reduce((s, r) => s + (r.noFrills.lineTotal ?? 0), 0))
    : null;

  console.log("\n=== FAIR TOTALS (same size / same kg) ===");
  console.log(`Receipt old grocery: $${receiptGrocery.toFixed(2)}`);
  console.log(
    `Walmart #5831 current: ${wmTotal != null ? "$" + wmTotal.toFixed(2) : "INCOMPLETE (size/weight mismatch)"}`,
  );
  console.log(
    `No Frills #3660 current: ${nfTotal != null ? "$" + nfTotal.toFixed(2) : "INCOMPLETE (size/weight mismatch)"}`,
  );
  if (wmTotal != null && nfTotal != null) {
    const better = wmTotal <= nfTotal ? "Walmart" : "No Frills";
    console.log(
      `Cheaper now: ${better} by $${Math.abs(wmTotal - nfTotal).toFixed(2)}`,
    );
  }

  const runId = await persistComparisonRun({
    type: "receipt-lookup-fair",
    store: "walmart_5831",
    generatedAt: new Date().toISOString(),
    rows,
    totals: { receiptGrocery, walmart: wmTotal, noFrills: nfTotal },
  });
  console.log(`\nSaved: data/runs/${runId}.json`);
  await closeWalmartBrowser();
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});

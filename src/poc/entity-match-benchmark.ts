/**
 * 100-pair product identity benchmark + pipeline self-check.
 *   npx tsx src/poc/entity-match-benchmark.ts
 *
 * Does not call Walmart / No Frills connectors or rewrite compare.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AUTO_LINK_THRESHOLD,
  matchProducts,
  type EntityMatchResult,
  type MatchMethod,
  type SavedProductMapping,
} from "@/domain/entity-match";
import { upsertProductMatch } from "@/lib/product-matches";
import {
  buildBenchmarkPairs,
  pairCounts,
  type PairKind,
} from "./entity-match-pairs";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

type Outcome = "tp" | "fp" | "tn" | "fn";

function outcome(shouldMatch: boolean, autoLinked: boolean): Outcome {
  if (shouldMatch && autoLinked) return "tp";
  if (!shouldMatch && autoLinked) return "fp";
  if (!shouldMatch && !autoLinked) return "tn";
  return "fn";
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function selfCheck() {
  const upc = matchProducts(
    {
      retailer: "walmart_ca",
      retailerProductId: "a",
      name: "Simply Egg Whites 1kg",
      upc: "065651002470",
    },
    {
      retailer: "receipt",
      retailerProductId: "b",
      name: "Egg Whites",
      upc: "65651002470",
    },
  );
  assert(upc.matchMethod === "upc", "upc method");
  assert(upc.decision === "auto_linked", "upc auto");
  assert(upc.matchConfidence === 1, "upc conf");

  const size = matchProducts(
    {
      retailer: "walmart_ca",
      retailerProductId: "c",
      name: "Gay Lea Unsalted Butter 454g",
      brand: "Gay Lea",
      sizeValue: 454,
      sizeUnit: "g",
      category: "dairy",
    },
    {
      retailer: "nofrills",
      retailerProductId: "d",
      name: "Gay Lea Unsalted Butter 1kg",
      brand: "Gay Lea",
      sizeValue: 1,
      sizeUnit: "kg",
      category: "dairy",
    },
  );
  assert(size.decision !== "auto_linked", "size mismatch must not auto-link");

  const subst = matchProducts(
    {
      retailer: "walmart_ca",
      retailerProductId: "e",
      name: "Earth's Own Original Oat Milk 1.75L",
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    },
    {
      retailer: "nofrills",
      retailerProductId: "f",
      name: "Earth's Own Original Almond Milk 1.75L",
      brand: "Earth's Own",
      sizeValue: 1.75,
      sizeUnit: "l",
      category: "beverage",
    },
  );
  assert(subst.decision !== "auto_linked", "oat vs almond must not auto-link");

  const mapping = matchProducts(
    { retailer: "receipt", retailerProductId: "r1", name: "Foil Green 4.27" },
    {
      retailer: "walmart_ca",
      retailerProductId: "w1",
      name: "Reynolds Wrap Heavy Duty Aluminum Foil",
    },
    {
      mappings: [
        {
          leftRetailer: "receipt",
          leftProductId: "r1",
          rightRetailer: "walmart_ca",
          rightProductId: "w1",
          verified: true,
        },
      ],
    },
  );
  assert(mapping.matchMethod === "manual_mapping", "manual method");
  assert(mapping.verified === true, "verified flag");
  assert(mapping.decision === "auto_linked", "manual auto");

  const low = matchProducts(
    { retailer: "walmart_ca", retailerProductId: "g", name: "Bananas" },
    { retailer: "nofrills", retailerProductId: "h", name: "Lemons 2 lb" },
  );
  assert(low.decision !== "auto_linked", "bananas vs lemons");
}

async function main() {
  selfCheck();

  const pairs = buildBenchmarkPairs();
  const counts = pairCounts(pairs);
  assert(pairs.length === 100, "100 pairs");
  assert(counts.exact === 20, "20 exact");
  assert(counts.alias === 25, "25 alias");
  assert(counts.size_mismatch === 20, "20 size");
  assert(counts.substitute === 15, "15 subst");
  assert(counts.different === 20, "20 different");

  const mappings: SavedProductMapping[] = pairs
    .map((p) => p.mapping)
    .filter((m): m is SavedProductMapping => Boolean(m));

  const started = performance.now();
  const rows = pairs.map((p) => {
    const result: EntityMatchResult = matchProducts(p.left, p.right, {
      mappings,
      threshold: AUTO_LINK_THRESHOLD,
    });
    const auto = result.decision === "auto_linked";
    return {
      id: p.id,
      kind: p.kind,
      shouldMatch: p.shouldMatch,
      autoLinked: auto,
      outcome: outcome(p.shouldMatch, auto),
      matchMethod: result.matchMethod,
      matchConfidence: result.matchConfidence,
      verified: result.verified,
      decision: result.decision,
      explain: result.explain.map((e) => `${e.stage}: ${e.reason}`),
    };
  });
  const elapsedMs = performance.now() - started;

  const tp = rows.filter((r) => r.outcome === "tp").length;
  const fp = rows.filter((r) => r.outcome === "fp").length;
  const tn = rows.filter((r) => r.outcome === "tn").length;
  const fn = rows.filter((r) => r.outcome === "fn").length;
  const positives = tp + fn;
  const negatives = tn + fp;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = positives === 0 ? 1 : tp / positives;
  const fpr = negatives === 0 ? 0 : fp / negatives;
  const explainable = rows.filter((r) => r.explain.length > 0).length / rows.length;

  const byKind: Record<PairKind, { n: number; auto: number; correct: number }> = {
    exact: { n: 0, auto: 0, correct: 0 },
    alias: { n: 0, auto: 0, correct: 0 },
    size_mismatch: { n: 0, auto: 0, correct: 0 },
    substitute: { n: 0, auto: 0, correct: 0 },
    different: { n: 0, auto: 0, correct: 0 },
  };
  for (const r of rows) {
    byKind[r.kind].n += 1;
    if (r.autoLinked) byKind[r.kind].auto += 1;
    const wantAuto = r.shouldMatch;
    if (r.autoLinked === wantAuto) byKind[r.kind].correct += 1;
  }

  const methodCounts: Partial<Record<MatchMethod, number>> = {};
  for (const r of rows) {
    methodCounts[r.matchMethod] = (methodCounts[r.matchMethod] ?? 0) + 1;
  }

  const errors = rows.filter((r) => r.outcome === "fp" || r.outcome === "fn");

  const summary = {
    threshold: AUTO_LINK_THRESHOLD,
    n: rows.length,
    counts,
    tp,
    fp,
    tn,
    fn,
    precision: round4(precision),
    recall: round4(recall),
    falsePositiveRate: round4(fpr),
    explainability: round4(explainable),
    elapsedMs: round4(elapsedMs),
    pairsPerMs: round4(rows.length / Math.max(elapsedMs, 0.001)),
    byKind,
    methodCounts,
    errors,
  };

  const outDir = path.join(process.cwd(), "data", "benchmarks");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "product-pairs.json"),
    JSON.stringify(
      pairs.map((p) => ({
        id: p.id,
        kind: p.kind,
        shouldMatch: p.shouldMatch,
        left: p.left,
        right: p.right,
        hasMapping: Boolean(p.mapping),
      })),
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(outDir, "entity-match-results.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  const sampleLinked = rows.find((r) => r.decision === "auto_linked");
  if (sampleLinked) {
    const gold = pairs.find((p) => p.id === sampleLinked.id)!;
    await upsertProductMatch({
      left: gold.left,
      right: gold.right,
      result: matchProducts(gold.left, gold.right, {
        mappings,
        threshold: AUTO_LINK_THRESHOLD,
      }),
      threshold: AUTO_LINK_THRESHOLD,
    });
  }

  console.log("entity-match-benchmark", {
    threshold: summary.threshold,
    precision: summary.precision,
    recall: summary.recall,
    falsePositiveRate: summary.falsePositiveRate,
    explainability: summary.explainability,
    elapsedMs: summary.elapsedMs,
    tp,
    fp,
    tn,
    fn,
    byKind,
    methodCounts,
    errorIds: errors.map((e) => `${e.outcome}:${e.id}`),
  });

  assert(precision >= 0.9, `precision ${precision} < 0.9`);
  assert(recall >= 0.8, `recall ${recall} < 0.8`);
  assert(fpr <= 0.1, `FPR ${fpr} > 0.1`);
  console.log("entity-match-benchmark ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

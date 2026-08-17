# Product entity matching

**Date:** 2026-08-16  
**Scope:** same real-world product across No Frills, Walmart, Sobeys, and receipts.  
**Constraint:** do not rewrite live compare, Rapid, or PCX connectors. Auto-link only at/above threshold.

Related: [store-integration-research.md](./store-integration-research.md). Live staples matching remains `src/domain/matching.ts` + staple filters.

---

## 1. Library evaluation

Evaluated for **grocery SKU identity** (normalized name, brand, size, unit, category, UPC/GTIN, image, retailer product ID). Scores are relative (1–5). Integration is vs this Next.js / TypeScript app.

| | Splink | dedupe | Zingg | Python Record Linkage Toolkit |
|---|---|---|---|---|
| **Model** | Fellegi–Sunter + EM, DuckDB default | Active-learning fuzzy clusters | Spark ML + active learning | Compare vectors + classifiers |
| **Explainability** | **5** — match/unmatch weights, waterfall charts | 3 — labels, less transparent weights | 2 — model scores | 4 — feature vectors |
| **Grocery / UPC fit** | **5** — exact + fuzzy comparisons, term frequency | 3 | 3 | 4 |
| **Speed (laptop, ~10k SKUs)** | **5** — DuckDB; 1M person records ~1 min claimed | 3 — small/medium | 2 — Spark overhead | 3 — pandas |
| **Integration complexity** | 3 — Python sidecar, not request-path | 3 — Python + labeling UI | **1** — Spark 3.5 | 3 — unmaintained since 0.16 (Jul 2023) |
| **Ops fit here** | Batch / training | Labeling sessions | Too heavy | Avoid as runtime dep |

**Splink** (UK MoJ, v4, DuckDB) is the best open-source library of the four: probabilistic, explainable, no labels required, laptop-scale. It is still **Python**, so it must not sit in the Next.js request path.

**dedupe** needs active learning and is aimed at messy address/name corpora, not barcode-first grocery.

**Zingg** is MDM-scale Spark. Wrong size for three GTA stores + receipts.

**Record Linkage Toolkit** is a clean teaching API (index → compare → classify) but last release 0.16 (2023-07). Do not add it as a production dependency.

### Recommendation

**Library:** Splink, as an **optional offline trainer** (export pairs → estimate m/u weights → copy weights into TypeScript).

**Runtime in this repo:** a TypeScript **hybrid pipeline** in `src/domain/entity-match.ts` that uses the same stage order as Splink-style linkage, without importing Python:

1. UPC/GTIN exact (`upcsMatch`)
2. Saved / manual retailer mapping
3. Structured attributes (brand, size/unit, category, name tokens)
4. In-process Fellegi–Sunter score (grocery priors; retune from Splink later)
5. Semantic / image **stub only** — never auto-links
6. If confidence &lt; `ENTITY_MATCH_AUTO_LINK_THRESHOLD` (default **0.85**) → `needs_review`, do not auto-link

---

## 2. Proposed schema

Keep existing `Product` / `RetailerProduct` / `ProductMapping` (SKU lock for a canonical product). Add pairwise identity:

```prisma
model ProductMatch {
  id               String   @id @default(cuid())
  leftRetailer     String
  leftProductId    String
  rightRetailer    String
  rightProductId   String
  matchMethod      String   // upc | manual_mapping | structured | fellegi_sunter | semantic_fallback | image_fallback | none
  matchConfidence  Float    // 0–1
  verified         Boolean  @default(false)
  verifiedAt       DateTime?
  decision         String   // auto_linked | needs_review | rejected
  explainJson      String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([leftRetailer, leftProductId, rightRetailer, rightProductId])
}
```

Until Prisma is on the live staples path, the same fields are stored in `data/catalog/product-matches.json` via `src/lib/product-matches.ts`.

`ProductRecord` inputs: `retailer`, `retailerProductId`, `name`, `brand`, `sizeValue`, `sizeUnit`, `category`, `upc` / `gtin`, `imageUrl`.

---

## 3. Benchmark plan

Gold set: **100 labeled pairs** in `src/poc/entity-match-pairs.ts` (dumped to `data/benchmarks/product-pairs.json`).

| Kind | N | Gold `shouldMatch` | Intent |
|---|---|---|---|
| exact | 20 | yes | Same UPC / identical SKU |
| alias | 25 | yes | Same pack, different naming (incl. 2 receipt maps) |
| size_mismatch | 20 | no | Same brand, different size — not the same pack entity |
| substitute | 15 | no | Oat vs almond, salted vs unsalted, grape vs cherry, … |
| different | 20 | no | Unrelated items (eggs vs lemons, seeds vs tomatoes) |

Positive class = exact + alias (45). Negative = the rest (55).

**Metrics** (auto-link vs gold):

- precision = TP / (TP + FP)
- recall = TP / (TP + FN)
- false-positive rate = FP / (FP + TN)
- explainability = share of pairs with a non-empty `explain[]`
- speed = wall time for 100 pair comparisons
- integration complexity = qualitative (table in §1); runtime is TS-only

Gates for `npm run poc:entity-match`: precision ≥ 0.9, recall ≥ 0.8, FPR ≤ 0.1.

Measured on this gold set (2026-08-16, threshold 0.85): **precision 1.00, recall 1.00, FPR 0.00, explainability 1.00, ~25ms / 100 pairs**. This set is constructed from cafe-staple names; replace it with labeled live catalog/receipt pairs before trusting production auto-link.

---

## 4. Minimal implementation (this change)

| File | Role |
|---|---|
| `src/domain/entity-match.ts` | Hybrid matcher |
| `src/lib/product-matches.ts` | JSON persist (`matchMethod`, `matchConfidence`, `verified`) |
| `prisma/schema.prisma` | `ProductMatch` model |
| `src/poc/entity-match-pairs.ts` | 100 gold pairs |
| `src/poc/entity-match-benchmark.ts` | Metrics + self-check |
| `data/catalog/product-matches.json` | Written on benchmark run (sample upsert) |

Compare (`/api/staples/compare` and `/api/staples`) **reads** `retailer-mappings.json` for locked/verified SKUs and staple filters. It does **not** rewrite Rapid or PCX. `matchProducts()` still does not run on the request path.

```bash
npm run poc:entity-match
npm run poc:seed-match
npm run poc:compare-audit
```

---

## 6. Seed + retailer mapping (existing staples)

Master id = cafe staple id (`simply_egg_whites`). No Frills PCX ids (`20820130001_EA`) are retailer SKUs only.

`npm run poc:seed-match` reads cached `nofrills_3660_latest.json` + `walmart_5831_latest.json` (no live Rapid/PCX):

1. Seed `Master → nofrills` as `seed_catalog`
2. If `confirmed.json` / `preferredProductId` / receipt lock exists → `locked_sku`, **do not rematch**
3. Else score NF vs WM with `matchProducts`; cheapest staples stay `staple_winner` unless UPC
4. Attach catalog prices with `LIVE_VERIFIED` / `RECEIPT_VERIFIED` / `MULTI_SOURCE_CONFIRMED` / `ESTIMATED` / `UNKNOWN`
5. Instacart/Uber helper `deliveryValidation()` is never usable as shelf

Output: `data/catalog/retailer-mappings.json`.


---

## 7. Live compare wiring

`src/domain/compare-resolve.ts` chooses the catalog offer:

1. **Locked identity** (`verified`, receipt, confirmed, preferred SKU) → that Walmart id only. Rapid off-by-one vs the walmart.ca URL is treated as the same SKU (Ziploc `…896` vs `…895`).
2. If the locked SKU is missing (grape tomatoes catalog currently has garden seeds) → **no Walmart price**, not the wrong winner.
3. **Cheapest** produce/eggs → catalog winner if `mustNotInclude` passes (word-boundary so `seed` ≠ `seedless`), else an alternate.
4. **Preferred** identity `rejected` (Folgers vs Gourmet West Coast) → both shelves may still display, but fair compare is **incomparable** and the row is excluded from the basket.

`confirmed.json` key `tomatoes` aliases to staple `tomatoes_grape`.

---

## 8. Later (not in this slice)

- Confirm UI for `needs_review` pairs (reuse `/api/staples/confirm` pattern)
- Optional `scripts/splink_train.py` to emit weights JSON
- Image embeddings / CLIP only after UPC + structured miss
- Wire `matchProducts` scoring into live search only behind a flag, after the 100-pair set is replaced with real catalog/receipt labels

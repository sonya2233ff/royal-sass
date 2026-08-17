# Royal SASS — agent instructions

Read this before any change. Follow the repo as it exists; do not invent services, stores, or tests.

## Project overview

Cafe staples price POC for GTA procurement: **Walmart Supercentre #5831** (Thornhill L4J 0A7) vs **No Frills Anthony’s #3660**. UI is Next.js 15 / React 19 (`src/app/page.tsx` → `StaplesCompare`). Live compare uses **JSON catalogs**, not Prisma.

Stack: Next.js App Router, TypeScript, Zod, Playwright (Walmart browser path), tsx POCs. Prisma/SQLite schema exists (`prisma/schema.prisma`) but **no `PrismaClient` usage in `src/`** — planned store, not the live path.

Shown staples = `PINNED_IDS` in `src/lib/staples.ts` plus `custom: true` items (`config/custom-staples.json`). Master product id is the cafe staple id (`simply_egg_whites`), never a PCX/Walmart SKU.

## Architecture

| Path | Role |
| --- | --- |
| `config/cafe-staples.json` | Staple definitions (queries, filters, `matchMode`, preferred ids) |
| `config/stores.json` | Locked stores; Sobeys `#659` is `active: false` |
| `data/catalog/walmart_5831_latest.json` | WM shelf snapshot |
| `data/catalog/nofrills_3660_latest.json` | NF shelf snapshot |
| `data/catalog/retailer-mappings.json` | Master id → retailer SKU locks |
| `data/catalog/confirmed.json` | 👍 preferred WM `productId` |
| `src/connectors/` | Retailer I/O (`RetailerConnector` in `types.ts`) |
| `src/domain/` | Units, matching, fair compare, offer resolve |
| `src/lib/staples.ts` | Catalog I/O, refresh, `summarizeOffer` |
| `src/lib/staple-compare-row.ts` | One compare row + basket amounts |
| `src/app/StaplesCompare.tsx` | Main UI |

**Live staples data flow**

1. Offers land in catalog JSON (refresh APIs / `npm run cache:*` / `cache:prices`).
2. `resolveCatalogOffer` (`src/domain/compare-resolve.ts`) picks the row offer from mapping + filters. **No Rapid/PCX in this step.**
3. `buildStapleCompareRow` → `summarizeOffer` + `fairCompareSides` + `scaleBasketAmount`.
4. UI: `GET /api/staples`, `POST /api/staples/compare`.

**Live API (App Router, `nodejs`)**

- `GET /api/staples` — card payload from catalogs + mappings
- `POST /api/staples/compare` — fair compare; body `{ ids, grams?, qty? }`; NF cache unless `refreshNoFrills` or missing row
- `POST /api/staples/refresh` — rematch selected WM SKUs (search)
- `POST /api/staples/refresh-nf` — live NF search, writes NF catalog
- `POST /api/staples/refresh-prices` — price-only `getProduct` on locked/catalog SKUs (no rematch)
- `POST /api/staples/search` | `adopt` | `confirm` — find/add staple; 👍/👎 lock
- `GET/POST /api/staples/nofrills-probe` — PCX debug
- `/dev/match-inspector` + `POST /api/dev/match-inspector` — developer match inspector (404 in production unless `ALLOW_MATCH_INSPECTOR=1`). Does not change customer UI.
- `GET /api/compare` — **legacy** `runComparison` (`config/products.json` + `src/domain/basket.ts`), not the staples UI

Refresh routes set `maxDuration = 60`.

## Retailer integrations

- **Walmart #5831:** `createWalmartConnector` (`create-walmart-connector.ts`). Source flags live in `walmart-source.ts` (no Playwright import — homepage catalog load stays light). `WALMART_SOURCE=rapid` uses OpenWeb Ninja/RapidAPI when `OPENWEBNINJA_API_KEY` or `RAPIDAPI_KEY` is set. If Rapid is requested and both keys are blank, **do not** scrape walmart.ca (PerimeterX); fail with `missing_key` and keep the last catalog price. Unset `WALMART_SOURCE` still means Rapid when a key is present, else browser. Playwright if `WALMART_USE_BROWSER` is not `0`. Postal `WALMART_POSTAL_CODE` (default L4J0A7). Rapid ids may be **±1** vs PDP; compare treats that as the same SKU (`offerMatchesRetailerSku`). Rapid live calls use `domain=ca`, `store_id=5831`, `zip=L4J0A7`, and `product_id` on `/product-details`.
- **No Frills #3660:** `NoFrillsConnector` / PCX BFF (`NOFRILLS_SEARCH_URL`, `NOFRILLS_API_KEY`). Blank `NOFRILLS_API_KEY` uses the public web fallback in the connector; sending a blank `X-Apikey` is 401 `invalid_client`. Akamai may still 403 some IPs. Flipp only if `NOFRILLS_ALLOW_FLIPP_FALLBACK=1` (not shelf).
- **Sobeys / FreshCo / MVR / Wholesale Club:** connectors or `src/poc/probe-*.ts` only. Not in the staples UI. Sobeys store is disabled in `config/stores.json`.
- **Mappings:** `data/catalog/retailer-mappings.json` via `src/lib/retailer-mappings.ts`. Pairwise `product-matches.json` and Prisma `ProductMatch` are **not** read by live compare.

**Do not** rewrite or casually edit connectors, API hosts, store IDs (`5831` / `3660`), credentials, or matching (`compare-resolve`, `matching.ts`, `entity-match.ts`) unless the task explicitly says to.

## Core business rules

**SKU / offer pick** (`resolveCatalogOffer`):

- Locked identity (`verified`, or `decision=auto_linked` with `kind=identity` or `skippedRematch`) → mapped SKU only (Rapid ±1 / URL contains lock). Missing SKU → no WM/NF price (`mapped_sku_missing`), not a different winner.
- Else cheapest-produce winner if `mustInclude*` / `mustNotInclude` pass (word-boundary; `seed` ≠ `seedless`); else an alternate.
- Locked SKUs skip staple name filters. `matchMode: preferred` + mapping `decision: rejected` → `fairBasis: incomparable` (e.g. Folgers vs Gourmet); **excluded from basket**.
- `matchMode` default: produce/frozen/eggs → `cheapest`; else `preferred` (`resolveMatchMode`).

**Price / size / qty**

- Line math: `summarizeOffer` in `src/lib/staples.ts`. Pack items: `shelf × qty` (UI pack stepper, default 1). Weight items (`isSoldByWeightItem`): grams (default 1000 in compare). Eggs (`isEggPackItem`): fair **per egg**; basket line is **30 eggs × pack qty**.
- Different pack masses → fair **$/100g** (same ranking as $/kg; Canadian shelf unit). Similar packs → **per pack**; eggs → **per egg** (`fair-compare.ts`).
- `wasPrice` / `onSale` are display-only on staples cards. Staples totals use `offer.price`, not `promoPrice`. (`promoPrice` is used in legacy `basket.ts` only.)
- `availability` exists on `ProductOffer` but staples compare does **not** filter `in_stock`. Verify before adding stock gates.
- Ignore absurd WM `unitPrice` (orders of magnitude above pack math) in `resolveUnitPrices`.

**Basket / “recommended store”**

- Row `cheaper` + `delta` are unit-fair (per pack / 100 g / egg), not “who has the smaller pack”.
- Totals: `scaleBasketAmount` then sum `basketWalmart` / `basketNoFrills` for non-incomparable rows. `totals.cheaper` is the lower comparable basket. There is no separate savings engine.

**Planned / not live:** Prisma persistence, `StoreConnector` (`store-connector.ts` says do not wire into `getConnector` yet), Splink/Python, semantic/image entity-match (stub, never auto-links), Uber/Instacart as shelf (explicitly not `LIVE_VERIFIED`).

## Development workflow

- Read this file; touch only files the task needs.
- One task → one small diff. No drive-by refactors, no overwriting user edits, no API contract changes unless asked.
- Do not commit `.env`, keys, cookies, or tokens. Do not edit `.env*` unless asked. Document **variable names only**.
- After code changes run the scripts below that apply. There is **no** `typecheck` or Jest/Vitest script. `src/poc` is excluded from `tsconfig.json` `include` (run POCs via `tsx` / npm scripts).

## Validation

Exact `package.json` scripts for checks:

```bash
npm run lint
npm run build
npm run poc:fair-compare
npm run poc:compare-audit
npm run poc:self-check
npm run poc:entity-match
npm run poc:store-connector
```

Price/matching diffs: also `npm run cache:prices` only when live keys work. Manually check several real staples (grape tomatoes ≠ seeds, mixed pack sizes, `qty > 1`, missing WM offer). UI: select + qty/grams → Compare → row `fairLabel` and basket.

If a script is not run, say so. Do not claim tests passed.

## Environment and security

Names only (see `.env.example`): `DATABASE_URL`, `WALMART_SOURCE`, `WALMART_USE_BROWSER`, `WALMART_ALLOW_FLIPP_FALLBACK`, `WALMART_POSTAL_CODE`, `OPENWEBNINJA_API_KEY`, `RAPIDAPI_KEY`, `WALMART_RAPID_HOST`, `NOFRILLS_API_KEY`, `NOFRILLS_SEARCH_URL`, `NOFRILLS_ALLOW_FLIPP_FALLBACK`, `WHOLESALECLUB_BANNER`, `WHOLESALECLUB_STORE_ID`, `SOBEYS_POSTAL_CODE`, `FRESHCO_POSTAL_CODE`, `MVR_SHOPIFY_BASE`, `STAPLES_CACHE_STALE_HOURS`, `ENTITY_MATCH_AUTO_LINK_THRESHOLD`, `ALLOW_MATCH_INSPECTOR`.

Serverless catalog writes may no-op (read-only FS). Verify before assuming refresh persisted.

## Agent response format

After a task, report: what changed; which files; which commands ran; pass/fail output; what was not verified and why.

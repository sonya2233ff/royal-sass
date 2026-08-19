# Royal SASS — agent instructions

Read this before any change. Follow the repo as it exists; do not invent services, stores, or tests. The operator writes in **Ukrainian**; code, identifiers, commits, and this file stay **English**.

This file is the live product context (stores, staple set, Category A/B, compare math, persistence, Vercel). Keep it accurate when those rules change.

## Project overview

Cafe staples price compare for GTA procurement. Homepage is Next.js 15 / React 19 (`src/app/page.tsx` → `StaplesCompare`). Live compare uses **JSON catalogs**, not Prisma.

**Live production:** https://royal-sass.vercel.app (GitHub `master` auto-deploys). Repo: https://github.com/sonya2233ff/royal-sass

**Compare columns (four):**

| Store | Id | Connector | Price meaning |
| --- | --- | --- | --- |
| Walmart Supercentre | `#5831` Thornhill `L4J0A7` | RapidAPI / OpenWeb Ninja (`WALMART_SOURCE=rapid`) | Shelf at this store |
| Anthony’s No Frills | `#3660` | PCX BFF | Shelf |
| Wholesale Club | `#3724` 10909 Yonge | Same PCX client, `Site-Banner: wholesaleclub` | Consumer packs (skip `*_C##` cases) |
| MVR Cash & Carry Weston | `3655 Weston Rd` `plus.mvrwholesale.com` | Shopify JSON | **INSTOREPRICE tag only** (in-store shelf). Never `variant.price` (online markup) |

**Sobeys Clark & Hilda `#659`:** flyer adapter only, `active: false` in `config/stores.json`. May show as a flyer estimate on cards. **Not a compare column. Do not enable it.**

Stack: Next.js App Router, TypeScript, Zod, Playwright (Walmart browser path, unused when Rapid is configured), tsx POCs. Prisma/SQLite schema exists (`prisma/schema.prisma`) but **no `PrismaClient` in `src/`** — planned store, not the live path.

Master product id = cafe staple id (`simply_egg_whites`, `grayridge_eggs`), **never** a PCX/Walmart/MVR SKU.

## Hard rules (do not drift)

- **Do not rewrite** Walmart, No Frills, or Wholesale Club connectors, API hosts, or store IDs (`5831` / `3660` / `3724`). Do not casually edit `compare-resolve.ts`, `matching.ts`, or `entity-match.ts` unless the task says to.
- **Do not guess missing prices.** No match → `no_match` / empty cell. Never pick an impostor SKU to fill a hole (Ice Breakers for ice, Sterilite bin for ice, vinegar for marshmallow, watermelon for honeydew, 4 oz cups for 12 oz, gym “Smith machine” for PET cups, etc.).
- **Do not restore deleted staples** unless they appear in `data/catalog/new-from-receipts.json` (or the operator names them).
- **Do not delete staples from the product.** UI delete and `POST /api/staples/delete` are disabled (405). `deleteStaplesCompletely` may still exist in `src/lib/staples.ts` for scripts; do not wire it back to the app.
- **Do not commit** `.env`, secrets, `config/custom-staples.json`, `tsconfig.tsbuildinfo`, `data/runs/`, `data/stats/`, receipt photos, `docs/royal-sass-overview.pdf`, or probe dumps. Do not commit leftover catalog edits unless the task is a rematch/price refresh.
- Code comments and docs: English. UI: mixed Ukrainian + English (operator-facing copy is often Ukrainian).

## What is on the homepage

Shown cards = `PINNED_IDS` **or** `RECEIPT_STAPLE_IDS` **or** `custom: true` (`isShownStaple` in `src/lib/staples.ts`).

- `PINNED_IDS`: 32 original cafe staples (dairy, produce, frozen bags, ice, Ziploc, Jello, ReaLemon, …) including `grayridge_eggs`, `large_eggs_dozen`, `ice_cubes`.
- `RECEIPT_STAPLE_IDS`: 94 ids from `data/catalog/new-from-receipts.json` (supplies, kosher dairy, branded grocery, more produce/frozen). `ice_cubes` overlaps pinned.
- **Committed catalog on `master`:** 125 items in `config/cafe-staples.json` (32 + 94 − 1 overlap). If a working tree drops ids, restore from git unless the operator asked to remove them.

Search/adopt can still add `custom: true` rows (`config/custom-staples.json`, usually untracked). Those show up locally; do not commit that file unless asked.

## Category A vs Category B

Match rules and purchase quantity are **independent**. Canonical fields:

- `matchMode`: `"exact"` (A) or `"cheapest_equivalent"` (B)
- `purchaseStrategy`: `"exact_need"` (close to requested ± `tolerancePercent`, default 15%) or `"stock_up"` (buy more only up to explicit `maximumAmount` — never invented)

Legacy JSON still accepted: `preferred` → `exact`, `cheapest` → `cheapest_equivalent`. Missing strategy → `exact_need`. `resolveMatchMode()` still returns the legacy pair for connectors.

| | Category A | Category B |
| --- | --- | --- |
| Intent | Exact branded / preferred SKU | Cheapest suitable equivalent (brand optional) |
| `matchMode` | `"exact"` (legacy `"preferred"`) | `"cheapest_equivalent"` (legacy `"cheapest"`) |
| Typical fields | `preferredProductId`, `preferNameIncludes` | `matchRules` / `mustInclude*` / `mustNotInclude` |
| Identity gate | Confirmed store product ID, then UPC/SKU, brand, type/form/variant, allowed size. No analog if exact is missing. | Type/form/variant + include/exclude. Fresh ≠ canned/sauce; white quinoa ≠ red; pack purpose must match. |
| Quantity | Usually `exact_need` | Either strategy (tomato = exact_need 2 kg; OJ pulp = stock_up 1–2 L) |
| UI badge | **А** — точний продукт | **Б** — найдешевший відповідний |

`resolveMatchMode`: explicit `item.matchMode` (canonicalized), else produce/frozen/eggs/`PRODUCE_IDS`/`FROZEN_BAG_IDS`/`EGG_PACK_IDS` → cheapest, else preferred.

**Category B identity** (`usesCategoryBIdentity` / `isCategoryBStaple`) is **only** `category === "produce" | "frozen"`. Eggs can be cheapest via `EGG_PACK_IDS` without produce-identity filters.

**Frozen vs produce:** bags such as `frozen_pineapple` (Alasko 5×1) are **frozen**, not fresh produce, even if an old receipt dump listed `produce`. Frozen skips the “fresh pack shape” checks; fresh must look like produce (warehouse titles like `Fruits - Grape Tomato` are OK via `warehouseTitleView`).

**MVR cases:** skip warehouse cases for consumer staples, **unless** the staple wants a case (`_24x`, `_30s`, `_case` in id, or `5x1` / `N x M` in the label). Weight produce prefers an MVR `per kg` hit when present.

## Eggs, ice, weight, packs

- `large_eggs_dozen` — **12 only** (`eggCartonCountOk`). `parsePackCount` understands `1DOZ` / dozen.
- `grayridge_eggs` — **18-count lock** (`preferredProductId` `6000191268613` when set). Not the dozen.
- Egg fair unit is **$/egg**; basket line is **30 eggs × pack qty**.
- `ice_cubes` — bag of ice (Arctic Glacier ~2.3 kg class). Not gum, not storage bins.
- Cart is one map `id → { requestedAmount, unit, isCustom }`. Selected = key exists. Search filter never mutates cart. Clear cart removes hidden-by-search items too.
- Adding to cart uses `defaultAmount`. Custom amount is cart-only unless the operator saves it as the new default (`localStorage` key `royal-sass-product-overrides-v1`).
- Sold-by-weight ids (`SOLD_BY_WEIGHT_IDS`) still exist for catalog matching. Checkout uses `saleMode`: `loose_weight` | `fixed_pack` | `case`. A `$/kg` label is **not** enough to treat a 15 lb case / bag / box / pack as loose.
- Basket money is **checkout cost** (full packs, 2 decimal line totals). `$/100 g` is display-only for value. Missing item = `N/A`, not `$0`. Overall winner only when a store can price the **same complete** set.
- Packed produce (`PACK_COMPARE_IDS` / `isPackedProduceItem`): cheapest suitable pack, then quantity rules.
- Frozen bags: cheapest equivalent, then quantity rules.

Do not compare different pack masses as raw shelf prices (`src/domain/fair-compare.ts`). Checkout overlays that with `src/domain/checkout.ts`.

## Architecture

| Path | Role |
| --- | --- |
| `config/cafe-staples.json` | Master staple definitions |
| `config/stores.json` | Locked stores (Sobeys `active: false`) |
| `src/lib/receipt-staple-ids.ts` | Receipt ids that are shown |
| `data/catalog/new-from-receipts.json` | Source list of 94 receipt staples |
| `data/catalog/walmart_5831_latest.json` | WM shelf snapshot |
| `data/catalog/nofrills_3660_latest.json` | NF shelf snapshot |
| `data/catalog/wholesaleclub_3724_latest.json` | WC shelf snapshot |
| `data/catalog/mvr_weston_latest.json` | MVR INSTOREPRICE snapshot |
| `data/catalog/sobeys_659_latest.json` | Flyer only |
| `data/catalog/retailer-mappings.json` | Master id → retailer SKU locks |
| `data/catalog/confirmed.json` | 👍 locked WM `productId` |
| `data/stats/compare-history.json` | Server compare history (gitignored; local/writable FS only) |
| `src/connectors/` | Retailer I/O |
| `src/domain/` | Units, identity, sale mode, checkout, fair compare, Category B identity |
| `src/lib/staples.ts` | Catalog I/O, `summarizeOffer`, egg/weight sets |
| `src/lib/staple-compare-row.ts` | One compare row: identity → pack fit → checkout |
| `src/lib/product-config.ts` | Effective `RestaurantProduct` + localStorage override keys (temporary adapter; not Vercel FS) |
| `src/lib/compare-stats.ts` | Compact compare-run persist + summaries |
| `src/app/StaplesCompare.tsx` | Main UI (cart, settings, compare, stats) |
| `src/app/ProductSettings.tsx` | Per-card match/quantity settings modal |

**Live data flow**

1. Offers land in catalog JSON (refresh APIs / `npm run cache:*` / `cache:prices`).
2. `resolveCatalogOffer` picks the catalog row from mapping + filters. Mapping `decision: needs_review` is **not** a lock. **No Rapid/PCX in this step.**
3. `buildStapleCompareRow` → identity, then `evaluatePurchase` checkout (not proportional case split).
4. UI: `GET /api/staples` (base config), `POST /api/staples/compare` with `{ cart, productOverrides }`. Client localStorage is the live override store on Vercel.

## Live API (`nodejs`)

- `GET /api/staples` — card payload from catalogs + mappings (`restaurantProduct` on each item)
- `POST /api/staples/compare` — `{ cart, productOverrides, ids?, grams?, qty? }`; checkout coverage (`N із M`); missing ≠ `$0`; writes match log when FS allows; **always returns a stats snapshot**
- `GET/POST /api/staples/product-config` — best-effort JSON on disk; `persisted: false` on Vercel. Client localStorage is source of truth for the single-cafe test. Changing `matchMode` marks mappings `needs_review` without deleting them.
- `GET /api/staples/compare-stats` — last runs + win-rate summary from disk (empty on Vercel)
- `POST /api/staples/refresh` — rematch selected WM SKUs
- `POST /api/staples/refresh-nf` | `refresh-wc` | `refresh-mvr` | `refresh-sobeys` — live search for that retailer
- `POST /api/staples/refresh-prices` — price-only `getProduct` on locked/catalog SKUs (no rematch)
- `POST /api/staples/search` | `adopt` | `confirm` — find/add staple; 👍/👎 lock
- `GET|POST /api/staples/delete` — **405**, deletion disabled
- `GET/POST /api/staples/nofrills-probe` — PCX debug
- `/dev/match-inspector` — developer Match inspector (site nav). Live retailer query scoring. Off only if `ALLOW_MATCH_INSPECTOR=0`. Linked NF probe at `/nf-probe`.
- `GET /api/compare` — **legacy** basket POC, not the staples UI

Refresh/compare routes use `maxDuration = 60`.

## Retailer integrations

- **Walmart #5831:** `createWalmartConnector`. Flags in `walmart-source.ts` (no Playwright import on homepage load). `WALMART_SOURCE=rapid` needs `OPENWEBNINJA_API_KEY` or `RAPIDAPI_KEY`. Blank keys → `missing_key`, **do not** scrape walmart.ca (PerimeterX). Rapid `domain=ca`, `store_id=5831`, `zip=L4J0A7`. Rapid ids may be **±1** vs PDP (`offerMatchesRetailerSku`). Rapid “In stock” is a listing flag, not proof of #5831 shelf.
- **No Frills #3660:** `NoFrillsConnector` / `pcx-bff.ts`. Blank `NOFRILLS_API_KEY` uses public web fallback; do not send empty `X-Apikey`. Akamai may 403 some IPs. Flipp only if `NOFRILLS_ALLOW_FLIPP_FALLBACK=1` (not shelf).
- **Wholesale Club #3724:** reuse the same PCX client. Skip `*_C##` case packs for consumer compare. Not Flipp. Do not copy the BFF client.
- **MVR Weston:** `src/connectors/mvr.ts`. Offer is dropped if INSTOREPRICE is missing. Case packs kept when the staple wants a case. Warehouse produce titles (`Fruits - …`) are valid Category B names.
- **Mappings:** `src/lib/retailer-mappings.ts`. Pairwise `product-matches.json` and Prisma `ProductMatch` are **not** read by live compare.

## Core business rules

**SKU pick** (`resolveCatalogOffer`):

- Locked identity (`verified`, or `auto_linked` + `kind=identity` / `skippedRematch`) → mapped SKU only. Missing SKU → `mapped_sku_missing`, not a different winner.
- Else cheapest in-filter offer (Category B must pass `isActualCategoryBOffer`); else alternate; else no price.
- Locked SKUs skip staple name filters. `matchMode: preferred` + mapping `decision: rejected` → `fairBasis: incomparable`, **excluded from basket**.

**Price / size / qty**

- Pack items: shelf × qty. Weight items: grams. Eggs: $/egg; basket 30 eggs × qty.
- Different pack masses → fair **$/100 g**. Similar packs → per pack.
- `wasPrice` / `onSale` are display-only. Staples totals use `offer.price`, not `promoPrice`.
- Staples compare does **not** filter `availability === in_stock`.
- Ignore absurd WM `unitPrice` in `resolveUnitPrices`.

**Basket winner**

- Row `cheaper` / `delta` are unit-fair, not “who has the smaller pack”.
- Totals: intersection by store count. WM vs NF = rows with both baskets. 3-store = WM+NF+WC. 4-store = all four. A missing MVR/WC price is not $0. `totals.cheaper` is the 4-store winner when `quadCount > 0`, else 3-store, else 2-store.

## Compare statistics

Every successful Compare builds a compact run (ids, labels, qty/grams, per-store line $, row winner, basket totals) via `recordCompareResult`.

- **Writable disk** (local / long-lived VM): append `data/stats/compare-history.json` (max 200 runs, gitignored).
- **Vercel serverless:** disk write fails (`statsPersisted: false`). The JSON response still includes the run. The page **merges into `localStorage`** key `royal-sass-compare-history-v1` so history survives refresh **on that phone/browser**, not across devices.

UI block **«Статистика порівнянь»**: run count, who wins the basket most often, most-compared items, expandable past runs. There is no delete-history control.

Match logs (`data/runs/match-*.json`) are search/audit only, gitignored, not the stats feature.

## UI (current)

- Cards: select for compare; grams on weight items; pack qty otherwise; 👍/👎 confirm on WM when present.
- **No per-card × and no «Видалити вибрані».** Selection is only for compare / refresh / copy.
- Actions: select all, refresh all prices, Compare, Refresh WM / NF / WC / MVR / Sobeys flyer.
- Results: four columns, then baskets, then stats.
- Nav: Cafe staples + Match inspector (`src/app/SiteNav.tsx`).

## Deploy

- **Production** = `master` → Vercel project `royal-sass` (team `noir-detailing`), alias https://royal-sass.vercel.app
- PR branches get **Preview** deployments. Putting “these changes on Vercel” for the live phone demo means **fast-forward `master`**, not only a preview URL.
- Serverless catalog/stats writes may no-op. Refresh on Vercel does not persist JSON into git. Local `npm start` on a VM can write catalogs.

## Development workflow

- One task → one small diff. No drive-by refactors, no overwriting operator catalog edits, no API contract changes unless asked.
- Do not edit `.env*` unless asked. Document **variable names only**.
- After code changes run the scripts below that apply. There is **no** `typecheck` or Jest/Vitest script. `src/poc` is excluded from `tsconfig.json` `include` (run via `tsx` / npm scripts).
- If you rematch catalogs, keep impostors out; prefer `no_match` over a wrong SKU.

## Validation

```bash
npm run lint
npm run build
npm run poc:fair-compare
npm run poc:compare-stats
npm run poc:compare-audit
npm run poc:self-check
npm run poc:staple-filter
npm run poc:entity-match
npm run poc:store-connector
```

Price/matching diffs: `npm run cache:prices` (and `cache:walmart` / `cache:nofrills` / `cache:wholesaleclub` / `cache:mvr`) only when live keys work and the task is a refresh. Spot-check: grape tomatoes ≠ seeds, ice ≠ gum, dozen ≠ 18-pack, `qty > 1`, missing offer stays empty. UI: select + grams/qty → Compare → `fairLabel` + baskets + stats row.

If a script is not run, say so.

## Environment (names only)

See `.env.example`: `DATABASE_URL`, `WALMART_SOURCE`, `WALMART_USE_BROWSER`, `WALMART_ALLOW_FLIPP_FALLBACK`, `WALMART_POSTAL_CODE`, `OPENWEBNINJA_API_KEY`, `RAPIDAPI_KEY`, `WALMART_RAPID_HOST`, `NOFRILLS_API_KEY`, `NOFRILLS_SEARCH_URL`, `NOFRILLS_ALLOW_FLIPP_FALLBACK`, `WHOLESALECLUB_BANNER`, `WHOLESALECLUB_STORE_ID`, `SOBEYS_POSTAL_CODE`, `FRESHCO_POSTAL_CODE`, `MVR_SHOPIFY_BASE`, `STAPLES_CACHE_STALE_HOURS`, `ENTITY_MATCH_AUTO_LINK_THRESHOLD`, `ALLOW_MATCH_INSPECTOR`.

## Planned / not live

Prisma persistence, `StoreConnector` (do not wire into `getConnector` yet), Splink/Python, semantic/image entity-match (stub, never auto-link), Uber/Instacart as shelf (not `LIVE_VERIFIED`).

## Agent response format

After a task, report: what changed; which files; which commands ran; pass/fail; what was not verified and why. Speak to the operator in Ukrainian when they wrote in Ukrainian.

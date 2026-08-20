# Royal SASS — agent instructions

Read this before any change. Follow the repo as it exists; do not invent services, stores, or tests. The operator writes in **Ukrainian**; code, identifiers, commits, and this file stay **English**. Speak to the operator in Ukrainian when they wrote in Ukrainian.

This file is the live product context (stores, staple set, Category A/B, matching, compare math, rematch vs prices, persistence, Vercel). Keep it accurate when those rules change.

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

Master product id = cafe staple id (`simply_egg_whites`, `large_eggs_dozen`), **never** a PCX/Walmart/MVR SKU.

## Hard rules (do not drift)

- **Do not rewrite** Walmart, No Frills, or Wholesale Club connectors, API hosts, or store IDs (`5831` / `3660` / `3724`). Do not casually edit `compare-resolve.ts`, `matching.ts`, or `entity-match.ts` unless the task says to.
- **Do not guess missing prices.** No match → `no_match` / empty cell. Never pick an impostor SKU to fill a hole (Ice Breakers for ice, Sterilite bin for ice, vinegar for marshmallow, watermelon for honeydew, 4 oz cups for 12 oz, gym “Smith machine” for PET cups, etc.).
- **Do not restore deleted staples** unless they appear in `data/catalog/new-from-receipts.json` (or the operator names them).
- **Do not delete staples from the product.** UI delete and `POST /api/staples/delete` are disabled (405). `deleteStaplesCompletely` may still exist in `src/lib/staples.ts` for scripts; do not wire it back to the app.
- **Do not commit** `.env`, secrets, `config/custom-staples.json`, `tsconfig.tsbuildinfo`, `data/runs/`, `data/stats/`, receipt photos, `docs/royal-sass-overview.pdf`, leftover catalog dumps, or probe dumps. Do not commit leftover catalog edits unless the task is a rematch/price refresh.
- **Do not re-enable Sobeys** as a compare column.
- **Do not show two shell-egg cards.** Homepage eggs = one `large_eggs_dozen` line. `grayridge_eggs` stays in JSON as a catalog source row only.
- **Do not invent `maximumAmount` for eggs.** Quantity is eggs (`ea`) via chips; checkout buys whole cartons to cover the count.
- **Do not treat «Оновити ціни» as rematch.** That path is price-only on locked/catalog SKUs.
- **Do not rematch all visible staples by default** (Rapid/PCX cost). Rematch only the card, the selected cart ids, or settings **Зберегти і оновити**.
- **Do not rank hits with the cafe card label.** Size and abbreviations on the card (`OJ`, `2.63L`, `12oz`, `3.25%`) are not identity.
- **Do not require pack size as an Include keyword.** WM Rapid titles often omit litres. Compare different cafe bottles as `$/L` or `$/kg`. Reject **mini** packs only (`MIN_COMPARABLE_PACK_RATIO` 0.35 in `src/domain/sanity.ts`).
- **Do not let settings Include replace catalog brand/type filters.** Merge (union). Pack-size Include tokens are ignored (`src/domain/pack-tokens.ts`).
- **Do not stem `sliced`/`slices`** unless a later task asks.
- Code comments and docs: English. UI: mixed Ukrainian + English (operator-facing copy is often Ukrainian).

## Current product truth (operator decisions — do not regress)

These are live on **production** `master` (`7d405de` and descendants). Phone demo = https://royal-sass.vercel.app

**Eggs**

- One homepage card: `large_eggs_dozen` (Large eggs only — not Extra Large / Jumbo / Medium / egg whites / eggplant).
- Quantity chips: **12 / 18 / 30 / 180** (`EGG_COUNT_PRESETS`). 180 = typical MVR case (15×12 or 10×18). Unit is **eggs (`ea`)**, not “1 pack”.
- Search «яйця» / `eggs` → that one staple (`queryLooksLikeShellEggs`). Do not also surface `grayridge_eggs`.
- `grayridge_eggs` / `eggs_30ct` catalog rows still feed `large_eggs_dozen` via `eggCatalogSourceIds`. Fair unit **$/egg**. Checkout buys whole cartons to cover the requested egg count.
- Do not bring back a second Grayridge card.

**Oat Original (`oat_beverage_original`)** — operator exception. WM #5831 stays identity-locked on Earth's Own **Zero Sugar** 1.75L `2ADJVX8MAQ1Q` `$4.47` (same shelf price as Original `54TFZVS2LHS3`). Catalog `mustNotInclude` still has `zero sugar` so search/rematch will not pick a new Zero Sugar hit. Do **not** rematch this card onto Original. Other identity-locked SKUs must still pass `mustNotInclude` (`identityLockAllowsFilterMismatch`).

**Rematch vs prices**

- After changing Include / match mode in **Налаштування**, the operator must rematch. **Оновити ціни** does not re-search.
- UI: per-card **Оновити**, toolbar **Оновити вибрані** (cart ids), settings **Зберегти і оновити**.
- `POST /api/staples/rematch` → WM then NF then WC then MVR; `productOverrides` from localStorage; `maxDuration = 60`; `skipIdentityLock` so settings apply.
- WM Rapid key missing → skip WM, still rematch the other three.
- Exact rematch still prefers confirmed / preferred SKUs when the hit is that product **and it passes `mustNotInclude`**. Exception: `oat_beverage_original` (below). Cheapest may skip identity lock to pick a new equivalent.

**Tropicana (`orange_juice_pulp`) — worked example of a class of bugs**

- Card label: `Tropicana OJ No Pulp 2.63L`. WM locked SKU **205804** is the 2.63 L jug; Rapid often **omits size in the title**. NF/MVR usually stock Tropicana **1.36 L**, not 2.63. Compare as `$/L`, not “out of stock”.
- `matchMode: "exact"`; `purchaseStrategy: "stock_up"` 1–3 L (covers the WM **2.63 L** jug). Catalog `mustIncludeAny` includes tropicana + no-pulp / pulp free. Do **not** put `concentrate` in include (matches “not from concentrate”). Do **not** require `2.63` as a must-include token.
- Operator UX: **Точний продукт**; Include `tropicana, no pulp, pulp free`; **Зберегти і оновити**. WM can show 2.63 L; other stores show the Tropicana no-pulp they actually sell.

**Matching for every staple (generalized after Tropicana)**

- Rank with `staplePickQuery` (`src/domain/matching.ts`): first non-barcode search query, never the card label. Cheapest produce uses a non-numeric `mustIncludeAny` fruit token (not `blueberries fresh`).
- `isSoftQueryToken`: units, leading digits, 1–2 letter abbreviations (`OJ` is also a stop word).
- `stripPackNoise` / `isPackSizeKeyword` / `identityKeywords` in `src/domain/pack-tokens.ts`. Category B label-derived search queries strip `2lb` / `5x1` / `12oz`.
- `stapleWithClientOverride` / `applyProductOverride` **union** include/exclude with catalog filters (case-insensitive). Old localStorage `orange juice` must not wipe tropicana/no-pulp.
- Product settings: pack size is not a required keyword; Include **adds** to catalog filters.
- Exact identity (`src/domain/product-identity.ts`): mini packs fail; a smaller cafe bottle of the same branded product (1.36 L vs 2.63 L) stays valid.
- Locked WM SKU with empty Rapid `packageSize` may copy `expectedPackKg` onto that SKU only (`withExpectedPackSize`) — do not stamp typical pack onto a different product.
- Adopt-from-search include tokens skip pack sizes.
- Match inspector ranks with `staplePickQuery`, not the card label.

**Photos / inspector**

- MVR cup photos: protocol-relative Shopify URLs (`//cdn.shopify.com/…`) must become `https://` (`src/lib/product-image.ts`).
- Match inspector is on in site nav (`/dev/match-inspector`). Linked NF probe at `/nf-probe`. Off only if `ALLOW_MATCH_INSPECTOR=0`.

**Deploy**

- “Put this on Vercel / run prod” = **fast-forward `master`**, not only a PR preview. Production project `royal-sass`, team `noir-detailing`, alias https://royal-sass.vercel.app

## What is on the homepage

Shown cards = `PINNED_IDS` **or** `RECEIPT_STAPLE_IDS` **or** `custom: true` (`isShownStaple` in `src/lib/staples.ts`).

- `PINNED_IDS`: **31** original cafe staples (dairy, produce, frozen bags, ice, Ziploc, Jello, ReaLemon, `large_eggs_dozen`, `ice_cubes`). **Not** `grayridge_eggs`.
- `RECEIPT_STAPLE_IDS`: **94** ids from `data/catalog/new-from-receipts.json` (supplies, kosher dairy, branded grocery, more produce/frozen). `ice_cubes` overlaps pinned.
- **Shown unique ids:** 124 (31 + 94 − 1 overlap). `config/cafe-staples.json` still contains hidden rows such as `grayridge_eggs` for catalog merge.

Homepage search is **shown-catalog only** (`src/domain/staple-search.ts`): card label, id, queries, and include tokens — never retailer offer names, handles, or live WM/NF/WC/MVR hits. Searching `pumpkin` must not surface wraps because an NF foam pumpkin sat on that SKU. `яйця` / `eggs` hits only `large_eggs_dozen`. The homepage typeahead does **not** adopt a new product; `POST /api/staples/adopt` remains for the match inspector. Custom `custom: true` rows (`config/custom-staples.json`, usually untracked) still show if present; do not commit that file unless asked.

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
| Identity gate | Confirmed store product ID, then UPC/SKU, brand, type/form/variant. Pack size on the **card** is not a hard 8% match — mini packs only. No analog if exact is missing. | Type/form/variant + include/exclude. Fresh ≠ canned/sauce; white quinoa ≠ red; pack purpose must match. |
| Quantity | Usually `exact_need` (Tropicana OJ is exact brand + `stock_up` 1–3 L so the WM 2.63 L jug is allowed) | Either strategy (tomato = exact_need 2 kg) |
| UI badge | **А** — точний продукт | **Б** — найдешевший відповідний |

`resolveMatchMode`: explicit `item.matchMode` (canonicalized), else produce/frozen/eggs/`PRODUCE_IDS`/`FROZEN_BAG_IDS`/`EGG_PACK_IDS` → cheapest, else preferred.

**Category B identity** (`usesCategoryBIdentity` / `isActualCategoryBOffer`) is **only** `category === "produce" | "frozen"`. Eggs can be cheapest via `EGG_PACK_IDS` without produce-identity filters. Filters also read the Shopify handle / `productId` / URL slug (`offerHandleHay`), so a relabeled `vegetables-grape-tomatoes-case` cannot win the round `tomato` card.

**Category B cheapest rematch** — a verified / mapped SKU must not hide a cheaper equivalent pack (`cheapestMatchSkipsIdentityLock`). Rapid text search often omits a known WM pack (grape Devours). Before search, **every cheapest staple** `getProduct`s known WM ids into the pool: mapping SKU, catalog offer + alternates, `preferredProductId`, and SKU-like `queries`. That is a **candidate**, not an identity lock — a cheaper filter-passing hit still wins. The same mapped-SKU candidate fetch runs for NF / WC / MVR cheapest rematch. SKU-like `queries` are skipped in shared NF/MVR `categoryBSearchQueries` (`looksLikeWalmartProductId`). Grower-branded clamshell titles with a real pack weight (e.g. Nature Fresh Devours 283 g) still count as produce.

**Grape / cherry tomatoes (`tomatoes_grape`)** — worked example of the rule above, not a locked 10 oz brand. A 👍 on Your Fresh Market Grape 10 oz `6000194960084` (Rapid alias `6000194960083`, `$2.97`) must not hide a cheaper grape/cherry clamshell. Thornhill `#5831` shelf overlay marks that 10 oz **OOS**; do not persist the overlay into `walmart_5831_latest.json`. Live cheaper pack (2026-08-20): Nature Fresh Farms Devours Premium Red Grape Tomato 283 g Rapid id `72CDS4R4V81X` `$2.44`. Allow cherry clamshells on this card. Reject garden seeds, Campari, Roma, vine, canned, and SUNSET Sprinkles (title is not grape/cherry).

**Frozen vs produce:** bags such as `frozen_pineapple` (Alasko 5×1) are **frozen**, not fresh produce, even if an old receipt dump listed `produce`. Frozen skips the “fresh pack shape” checks; fresh must look like produce (warehouse titles like `Fruits - Grape Tomato` are OK via `warehouseTitleView`).

**MVR cases:** skip warehouse cases for consumer staples, **unless** the staple wants a case (`_24x`, `_30s`, `_case` in id, or `5x1` / `N x M` in the label). Weight produce prefers an MVR `per kg` hit when present.

## Eggs, ice, weight, packs

- `large_eggs_dozen` — **the** shell-egg card. Accepts Large cartons of **12 / 18 / 30** (`eggCartonCountOk`). `parsePackCount` understands `1DOZ` / dozen. MVR cases OK when they are N× those counts.
- `grayridge_eggs` — **not shown**. 18-count catalog source only (`preferredProductId` `6000191268613` when set on that hidden row).
- Egg fair unit is **$/egg**; basket line is **requested eggs × carton math**, not “1 pack”.
- Category A branded packs (egg whites, milk, juice): a **smaller same-product pack** may cover the cafe size — e.g. 2×500 ml Simply Egg Whites ≈ 1 kg. Checkout is `N × shelf`. Free Run / other brands stay rejected. Mini bottles (200 ml vs 1 kg) stay rejected. Do not auto-link 500 ml and 1 kg as one SKU.
- No Frills `#3660` stocks Naturegg Simply Egg Whites as **500 ml** `20820355001_EA` (`$5.49`, two packs cover the 1 kg card). It does not appear to stock the 1 kg carton. Do **not** persist Free Run `20820130001_EA` onto `simply_egg_whites` — Category A rejects it, so the NF cell was N/A. The mapping is identity-locked so nightly price refresh keeps the Simply SKU.
- `ice_cubes` — bag of ice (Arctic Glacier ~2.3 kg class). Not gum, not storage bins.
- Cart is one map `id → { requestedAmount, unit, isCustom }`. Selected = key exists. Search filter never mutates cart. Clear cart removes hidden-by-search items too.
- Adding to cart uses `defaultAmount`. Custom amount is cart-only unless the operator saves it as the new default (`localStorage` key `royal-sass-product-overrides-v1`).
- Sold-by-weight ids (`SOLD_BY_WEIGHT_IDS`) still exist for catalog matching (cafe wants kg). Checkout `saleMode` comes from the **offer**, not that id: `loose_weight` (scale `$/kg` or `$/lb` rate), `fixed_pack` (whole pack with content weight), `case` (crate / `N × unit` / `15 lb case`). `g`/`kg`/`lb` in the title is **content**, not loose sale. `1 ea` is a purchase unit — if the name or structured pack has 5 lb / 800 g, that is content weight. MVR `2.5LB REPACK` is a pack, not a warehouse case. A `$/kg` label is **not** enough to treat a bag, basket, or 15 lb case as loose.
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
| `src/domain/pack-tokens.ts` | Pack size is not identity (`stripPackNoise`, `identityKeywords`) |
| `src/domain/egg-pack.ts` | Egg chips, Ukrainian search, catalog source merge |
| `src/domain/staple-search.ts` | Homepage catalog-only search hay / scoring |
| `src/domain/matching.ts` | `staplePickQuery`, `scoreOfferMatch` (soft size tokens) |
| `src/domain/restaurant-product.ts` | Settings merge (`stapleWithClientOverride`) |
| `src/lib/staples.ts` | Catalog I/O, `summarizeOffer`, egg/weight sets |
| `src/lib/staple-compare-row.ts` | One compare row: identity → pack fit → checkout |
| `src/lib/rematch-staples.ts` | Live rematch WM+NF+WC+MVR from client overrides |
| `src/lib/product-config.ts` | Effective `RestaurantProduct` + localStorage override keys (temporary adapter; not Vercel FS) |
| `src/lib/product-image.ts` | Protocol-relative Shopify → `https:` |
| `src/lib/compare-stats.ts` | Compact compare-run persist + summaries |
| `src/app/StaplesCompare.tsx` | Main UI (cart, settings, compare, rematch, stats) |
| `src/app/ProductSearch.tsx` | Homepage typeahead over shown staples only |
| `src/app/waiter/WaiterPortal.tsx` | Waiter list for the driver (visual send only) |
| `src/app/driver/DriverPortal.tsx` | Driver inbox of waiter lists (visual only, no accept) |
| `src/app/ProductSettings.tsx` | Per-card match/quantity settings modal |

**Live data flow**

1. Offers land in catalog JSON (refresh APIs / `npm run cache:*` / `cache:prices`).
2. `resolveCatalogOffer` picks the catalog row from mapping + filters. Mapping `decision: needs_review` is **not** a lock. **No Rapid/PCX in this step.**
3. `buildStapleCompareRow` → identity, then `evaluatePurchase` checkout (not proportional case split).
4. UI: `GET /api/staples` (base config), `POST /api/staples/compare` with `{ cart, productOverrides }`. Client applies `stapleWithClientOverride` on the server from that body. Client localStorage is the live override store on Vercel.

## Live API (`nodejs`)

- `GET /api/staples` — card payload from catalogs + mappings (`restaurantProduct` on each item)
- `POST /api/staples/compare` — `{ cart, productOverrides, ids?, grams?, qty? }`; checkout coverage (`N із M`); missing ≠ `$0`; writes match log when FS allows; **always returns a stats snapshot**
- `GET/POST /api/staples/product-config` — best-effort JSON on disk; `persisted: false` on Vercel. Client localStorage is source of truth for the single-cafe test. Changing `matchMode` marks mappings `needs_review` without deleting them.
- `GET /api/staples/compare-stats` — last runs + win-rate summary from disk (empty on Vercel)
- `POST /api/staples/refresh` — rematch selected WM SKUs (older WM-only path)
- `POST /api/staples/refresh-nf` | `refresh-wc` | `refresh-mvr` | `refresh-sobeys` — live search for that retailer
- `POST /api/staples/rematch` — live rematch **selected ids** across WM+NF+WC+MVR using client `productOverrides`. Not price-only. Not “all visible cards”.
- `POST /api/staples/refresh-prices` — price-only SKU refresh (no rematch). Walmart Rapid looks up the locked SKU via store search first; `/product-details` often 456/503 on walmart.ca.
- `GET /api/staples/search` — shown cafe staples only (no live store hits, empty `walmart`/`noFrills`/`wholesaleClub`/`mvr` arrays)
- `POST /api/staples/adopt` | `confirm` — adopt remains for the match inspector; homepage search does not call it; 👍/👎 lock
- `GET|POST /api/staples/delete` — **405**, deletion disabled
- `GET/POST /api/staples/nofrills-probe` — PCX debug
- `/dev/match-inspector` — developer Match inspector (site nav). Live retailer query scoring. Off only if `ALLOW_MATCH_INSPECTOR=0`. Linked NF probe at `/nf-probe`.
- `/waiter` — waiter portal: shown catalog search + local list; send-to-driver is visual only (no API)
- `/driver` — driver portal: mock waiter lists + combined pick list; accept/message is visual only
- `GET /api/compare` — **legacy** basket POC, not the staples UI

Refresh/compare/rematch routes use `maxDuration = 60`.

## Retailer integrations

- **Walmart #5831:** `createWalmartConnector`. Flags in `walmart-source.ts` (no Playwright import on homepage load). `WALMART_SOURCE=rapid` needs `OPENWEBNINJA_API_KEY` or `RAPIDAPI_KEY`. Blank keys → `missing_key`, **do not** scrape walmart.ca (PerimeterX). Rapid `domain=ca`, `store_id=5831`, `zip=L4J0A7`. Rapid ids may be **±1** vs PDP (`offerMatchesRetailerSku`). Rapid “In stock” is a listing flag, not proof of #5831 shelf. Rapid titles often omit pack size.
- **No Frills #3660:** `NoFrillsConnector` / `pcx-bff.ts`. Blank `NOFRILLS_API_KEY` uses public web fallback; do not send empty `X-Apikey`. Each search mints a new `cartId` / `sessionId` and a Toronto `fulfillmentInfo.date`. On HTTP 401/403 the client harvests banner `Set-Cookie` (optional `PCX_COOKIE`) and retries; `PCX_BOOTSTRAP_BROWSER=1` then tries Playwright. Akamai may still 403 some IPs. Flipp only if `NOFRILLS_ALLOW_FLIPP_FALLBACK=1` (not shelf).
- **Wholesale Club #3724:** reuse the same PCX client (same cookie rewrite). Skip `*_C##` case packs for consumer compare. Not Flipp. Do not copy the BFF client.
- **MVR Weston:** `src/connectors/mvr.ts`. Offer is dropped if INSTOREPRICE is missing. Case packs kept when the staple wants a case. Warehouse produce titles (`Fruits - …`) are valid Category B names. Image URLs may be protocol-relative.
- **Mappings:** `src/lib/retailer-mappings.ts`. Pairwise `product-matches.json` and Prisma `ProductMatch` are **not** read by live compare.

## Core business rules

**SKU pick** (`resolveCatalogOffer`):

- Locked identity (`verified`, or `auto_linked` + `kind=identity` / `skippedRematch`) → mapped SKU only. Missing SKU → `mapped_sku_missing`, not a different winner.
- Else cheapest in-filter offer (Category B must pass `isActualCategoryBOffer`); else alternate; else no price.
- Locked SKUs skip staple name filters. `matchMode: preferred` + mapping `decision: rejected` → `fairBasis: incomparable`, **excluded from basket**.

**Price / size / qty**

- Pack items: shelf × qty. Weight items: grams. Eggs: $/egg; line is requested egg count.
- Different pack masses → fair **$/100 g**. Similar packs → per pack. Different OJ litres → `$/L` via that fair path (not `no_match`).
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

- Cards: select for compare; grams on weight items; egg chips / pack qty otherwise; 👍/👎 confirm on WM when present.
- **No per-card × and no «Видалити вибрані».** Selection is only for compare / refresh / rematch / copy.
- Actions: select all, **Оновити ціни** (price-only), **Оновити вибрані** (rematch selected), Compare, Refresh WM / NF / WC / MVR / Sobeys flyer.
- Per card: **Оновити** = rematch that id. Settings: **Зберегти** vs **Зберегти і оновити**.
- Nav: Cafe staples + **Офіціант** (`/waiter`) + **Водій** (`/driver`) + Match inspector (`src/app/SiteNav.tsx`). Homepage nav has a second row of store chips (**Порівнювати**: WM / NF / WC / MVR) to show or hide compare columns. At least one store stays on. Choice is `localStorage` `royal-sass-compare-stores-v1`. Hidden stores are omitted from cards, results, and basket winner — they are not $0. Sobeys flyer is not a compare column.
- **Waiter portal** (`/waiter`): shown cafe catalog only (same search as the homepage). Waiter builds a local list (`royal-sass-waiter-list-v1`) and sees a send-to-driver mock. **No send API** yet.
- **Driver portal** (`/driver`): visual inbox of waiter product lists (mock tickets; local waiter draft may appear as a this-phone mock). **No accept / in-transit / message-waiter API.**
- Results: columns for the selected stores, then baskets, then stats.
- Product settings hint: exact keeps brand/SKU; pack size is not a required Include word; Include merges with catalog; cheapest ignores brand.

## Deploy

- **Production** = `master` → Vercel project `royal-sass` (team `noir-detailing`), alias https://royal-sass.vercel.app
- PR branches get **Preview** deployments. Putting “these changes on Vercel” / “run prod” for the live phone demo means **fast-forward `master`**, not only a preview URL.
- Serverless catalog/stats writes may no-op. Refresh on Vercel does not persist JSON into git. Local `npm start` on a VM can write catalogs.
- **Nightly shelf prices (all four stores):** GitHub Action `.github/workflows/refresh-catalog-prices.yml` runs `npm run cache:prices` (locked SKUs only — **not** rematch) at **00:00 America/Toronto**, then commits `data/catalog/{walmart_5831,nofrills_3660,wholesaleclub_3724,mvr_weston}_latest.json` so Vercel redeploys `master`. Manual: `npm run cache:prices -- --stores=walmart` (WM only); `--fill-missing` rematches shown rows that still have no WM SKU. Repo secrets: `RAPIDAPI_KEY` or `OPENWEBNINJA_API_KEY`; optional `NOFRILLS_API_KEY`, `PCX_COOKIE`. Scheduled workflows only fire after this file is on **master**.

## Development workflow

- One task → one small diff. No drive-by refactors, no overwriting operator catalog edits, no API contract changes unless asked.
- Do not edit `.env*` unless asked. Document **variable names only**.
- After code changes run the scripts below that apply. There is **no** `typecheck` or Jest/Vitest script. `src/poc` is excluded from `tsconfig.json` `include` (run via `tsx` / npm scripts).
- If you rematch catalogs, keep impostors out; prefer `no_match` over a wrong SKU.
- Price refresh must load WM catalog with `applyShelf: false` before saving, or in-store `shelf-overrides.json` (grape tomatoes OOS) gets written into `walmart_5831_latest.json`.

## Validation

```bash
npm run lint
npm run build
npm run poc:fair-compare
npm run poc:compare-stats
npm run poc:compare-audit
npm run poc:self-check
npm run poc:staple-filter
npm run poc:pilot-logic
npm run poc:entity-match
npm run poc:store-connector
npm run poc:pcx-session
```

Price/matching diffs: `npm run cache:prices` (and `cache:walmart` / `cache:nofrills` / `cache:wholesaleclub` / `cache:mvr`) only when live keys work and the task is a refresh. Nightly CI is price-only (`cache:prices`), never a full rematch of all 124. Spot-check: grape tomatoes ≠ seeds, ice ≠ gum, dozen card still compares 12 vs 18 vs 30 as $/egg, `qty > 1`, missing offer stays empty, Tropicana label/`2.63` does not `no_match` a Pulp Free title, settings Include does not wipe catalog tropicana. UI: select + grams/qty → Compare → `fairLabel` + baskets + stats row.

If a script is not run, say so.

## Environment (names only)

See `.env.example`: `DATABASE_URL`, `WALMART_SOURCE`, `WALMART_USE_BROWSER`, `WALMART_ALLOW_FLIPP_FALLBACK`, `WALMART_POSTAL_CODE`, `OPENWEBNINJA_API_KEY`, `RAPIDAPI_KEY`, `WALMART_RAPID_HOST`, `NOFRILLS_API_KEY`, `NOFRILLS_SEARCH_URL`, `NOFRILLS_ALLOW_FLIPP_FALLBACK`, `PCX_COOKIE`, `PCX_BOOTSTRAP_BROWSER`, `PCX_PREWARM_COOKIES`, `WHOLESALECLUB_BANNER`, `WHOLESALECLUB_STORE_ID`, `SOBEYS_POSTAL_CODE`, `FRESHCO_POSTAL_CODE`, `MVR_SHOPIFY_BASE`, `STAPLES_CACHE_STALE_HOURS`, `ENTITY_MATCH_AUTO_LINK_THRESHOLD`, `ALLOW_MATCH_INSPECTOR`.

## Planned / not live

Prisma persistence, `StoreConnector` (do not wire into `getConnector` yet), Splink/Python, semantic/image entity-match (stub, never auto-link), Uber/Instacart as shelf (not `LIVE_VERIFIED`).

## Shipped on this line (context for the next agent)

Merged to `master` / production via PR https://github.com/sonya2233ff/royal-sass/pull/7 (fast-forward). Commits:

| Commit | What |
| --- | --- |
| `762de88` | Egg quantity in eggs, not packs (chips 12 / 18 / 30 / largest case) |
| `0cd4e44` | Search «яйця» finds shell eggs (not eggplant / whites) |
| `0408408` | One Large Eggs staple; Grayridge hidden; merge 12/18/30 catalog rows |
| `042b9be` | Match inspector back in site nav |
| `32baca5` | MVR photos for cafe cup staples; `https:` on protocol-relative URLs |
| `61b92db` | Rematch button so product settings actually re-search |
| `048a0b8` | Pin Tropicana 2.63; do not score the card label (`OJ` / `2.63L`) |
| `7d405de` | Pack size + settings Include are not identity for **every** staple |

Operator follow-ups that produced those commits: egg chips; one egg card; inspector on; MVR cup photos; “after I change orange juice in settings, add a button”; “why doesn’t it pull Tropicana 2.63?”; “make sure this class of error cannot happen to other products”; “run prod / put all changes on Vercel”.

## Agent response format

After a task, report: what changed; which files; which commands ran; pass/fail; what was not verified and why. Speak to the operator in Ukrainian when they wrote in Ukrainian.

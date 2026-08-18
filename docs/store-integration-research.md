# Store integration research (GTA restaurant procurement)

**Date:** 2026-08-16  
**Scope:** shelf / pickup prices for locked GTA stores. No production connector rewrites.  
**Constraint:** do not bypass CAPTCHA, PerimeterX, Akamai, logins, or rate limits. No stolen keys. Only public pages, documented APIs, and the same JSON a normal browser already loads.

Related existing docs: [walmart-pricing.md](./walmart-pricing.md), [retailer-findings.md](./retailer-findings.md). Those are dated 2026-08-12 and predate the live RapidAPI Walmart path.

---

## 0. Current project audit

### Locked stores already in code

| Retailer | Location | IDs | Connector |
|---|---|---|---|
| Walmart Canada | Supercentre **#5831**, 700 Centre St, Thornhill **L4J 0A7** | `storeId=5831`, zip `L4J0A7` | `src/connectors/walmart-rapid.ts` when `WALMART_SOURCE=rapid`; else Playwright `walmart.ts` |
| No Frills | Anthony’s **#3660**, 1054 Centre St, Vaughan **L4J 3M8** | `fulfillmentInfo.storeId=3660`, `Site-Banner: nofrills` | `src/connectors/nofrills.ts` |
| Sobeys | Clark & Hilda, 441 Clark Ave W, Thornhill **L4J 6W7** | Flipp `merchant_store_code` **659**, merchant_id **2072** | `src/connectors/sobeys.ts` (Flipp, estimated) |
| FreshCo | not in `getConnector()` | Flipp postal default `M1P2L8` | `src/connectors/freshco.ts` throws if selected via factory |

Factory: `src/connectors/index.ts` `getConnector()`. FreshCo explicitly throws: not part of the locked 3-store POC.

### Normalized product today (`ProductOffer`)

`src/connectors/types.ts`:

- `retailer`, `storeId`, `productId`, `name`, `brand`, `packageSize`, `upc`
- `price`, `unitPrice`, `promoPrice`, `wasPrice`, `onSale`
- `availability`: `in_stock | out_of_stock | unknown` (no `low_stock`)
- `confidence`: `exact | estimated | stale`
- `checkedAt`, `sourceUrl`, `raw`

Target contract for new adapters (not wired into production): `src/connectors/store-connector.ts` (`StoreConnector`, `StorePrice`). Extra fields vs today: `banner`, `fulfillmentType`, `seller`, `pricingPolicy`, `priceKind`, `low_stock`.

### Walmart — do not rewrite

Live path (`WALMART_SOURCE=rapid`):

```text
GET {base}/search?query=&domain=ca&store_id=5831&zip=L4J0A7&page=1
GET {base}/product-details?product_id=&domain=ca&store_id=5831&zip=L4J0A7
```

- Direct: `https://api.openwebninja.com/real-time-walmart-data` + header `x-api-key`
- RapidAPI: `https://real-time-walmart-data1.p.rapidapi.com` + `X-RapidAPI-Key` / `X-RapidAPI-Host`
- Maps `list_price`, `savings_amount`, `badge_flags` ROLLBACK, URL `athbdg=L1300` → `wasPrice` / `onSale`
- Alphanumeric SKUs often miss in `/search`; `getProduct` works
- Rapid sometimes returns id off-by-one vs walmart.ca URL (example: Ziploc `6000195369896` vs `...895`)

Browser path (fallback): cookies `deliveryCatchment`, `defaultNearestStoreId`, `assortmentStoreId` = `5831`. Plain Node fetch of Orchestra GraphQL `getPreso` is **HTTP 412 PerimeterX**. `GET /en/store/5831` SSR works for store metadata only. Profile: `data/walmart-profile/` (`npm run walmart:warm`).

Flipp for Walmart only if `WALMART_ALLOW_FLIPP_FALLBACK=1` — flyer, not shelf.

### No Frills

```http
POST https://api.pcexpress.ca/pcx-bff/api/v2/products/search
X-Apikey: <public web client key, overridable via NOFRILLS_API_KEY>
Site-Banner: nofrills
X-Loblaw-Tenant-Id: ONLINE_GROCERIES
X-Application-Type: Web
```

Body: `fulfillmentInfo.storeId`, `pickupType: STORE`, `offerType: OG`, `listingInfo.filters["search-bar"]`, `banner: nofrills`.  
Fields used: `pricing.price`, `wasPrice`, `deal`, `promotions`, `packageSizing`, `brand`. Confidence **exact** when BFF succeeds. Akamai may block datacenter IPs. Flipp fallback if `NOFRILLS_ALLOW_FLIPP_FALLBACK=1`.

### Matching, cache, API, DB

- Matching: `src/domain/matching.ts` (`pickBestOffer`) + staple filters in `src/lib/staples.ts` (`mustIncludeAny/All/Not`, `preferredProductId`, cheapest produce/eggs).
- Cache: JSON catalogs `data/catalog/walmart_5831_latest.json`, `nofrills_3660_latest.json`. TTL `STAPLES_CACHE_STALE_HOURS` default **72**.
- Persistence: `src/lib/persistence.ts` → `data/raw`, `data/observations`, `data/runs` (gitignored). Prisma is **not** the live staples path.
- Prisma (`prisma/schema.prisma`, SQLite): `Retailer`, `Store`, `Product`, `RetailerProduct`, `ProductMapping`, `PriceObservation`, `RawRetailerResponse`, `ShoppingList`.
- API routes: `/api/staples`, `/compare`, `/staples/refresh`, `/staples/refresh-nf`, `/staples/search`, `/staples/adopt`, `/staples/confirm`, `/staples/nofrills-probe`.

### Env (names only)

See `.env.example`. Secrets live in `.env.local` (gitignored). Do not commit keys, cookies, or tokens.

---

## 1. Target `StoreConnector` / `StorePrice`

Implemented as types only in `src/connectors/store-connector.ts`. Production still uses `RetailerConnector`.

Always set:

| Field | Meaning |
|---|---|
| `priceKind` | `shelf` / `online` / `delivery` / `marketplace_seller` / `loyalty` / `promotional` / `estimated` |
| `pricingPolicy` | `same_as_in_store` / `possible_markup` / `online_only` / `loyalty` / `promotional` / `estimated` / `unknown` |
| `fulfillmentType` | `in_store` / `pickup` / `delivery` / `shipping` / `unknown` |
| `seller` | Walmart vs marketplace 3P; leave empty for banner-owned grocers |
| `confidence` | `high` only when store-scoped and same-day vs a receipt or confirmed shelf policy |

---

## 2. Cross-cutting sources (apply to every banner)

### Instacart Developer Platform

- Docs: https://docs.instacart.com/developer_platform_api/
- Endpoint: `POST https://connect.instacart.com/idp/v1/products/products_link`
- Auth: Bearer API key after signup. Dev: `https://connect.dev.instacart.tools`
- **Returns a shopping-list URL, not prices, not availability, not a catalog.**
- Connect APIs (https://docs.instacart.com/connect) are **retailer-only**.
- Status: `not_recommended` as a price source. Usable later only to deep-link a cart.
- Pricing policy is **per retailer**. CBC Marketplace: Walmart on Instacart matched in-store; Loblaws had markups. Do not treat Instacart as shelf without a receipt for that banner.

### Uber Eats / DoorDash

- No public grocery catalog API.
- Uber Canada: merchants set app prices; may differ from in-store. “In-store pricing” badge exists for some banners (Metro, Food Basics, LCBO, Giant Tiger) — **not Sobeys**.
- National Post (Toronto Sobeys vs Uber Eats): item prices ~16% higher; full order **45%** higher after fees. Sobeys: “in-store promotions and promotions featured on Voilà may not be applicable on Uber Eats and/or Instacart.”
- Status: `not_recommended` for shelf optimization.

### Flipp / Wishabi

```http
GET https://backflipp.wishabi.com/flipp/items/search?locale=en-ca&postal_code=L4J6W7&q=Sobeys%20milk
```

- No auth. Returns flyer items: `current_price`, `name`, `merchant_id`, `valid_from`/`valid_to`. No UPC, no availability, not full catalog.
- Live 2026-08-16 L4J6W7 “Sobeys milk”: condensed milk $3.28, organic oat milk $5.49 — **flyer SKUs, not 2% milk 2L**.
- Status: `fallback` for promo discovery only. `estimated`.

### Third-party scrapers (commercial ToS risk)

| Provider | Canada grocers | Store-specific | Cost (public list) | Status |
|---|---|---|---|---|
| OpenWeb Ninja / RapidAPI Real-Time Walmart Data | Walmart.ca `domain=ca` + `store_id` | Yes | Free 100/mo; Pro $25 / 10k; Ultra $75 / 50k; Mega $150 / 200k | `usable_for_mvp` (already in prod) |
| Apify `sunny_eternity/loblaws-grocery-scraper` | `superstore`, `nofrills`, `loblaw` only — **not Wholesale Club** | `locationId` or `postal_code` | Apify compute units | `fallback` (ToS) |
| Apify `aitorsm/pcexpress-store-locations` | banners include nofrills, **omit wholesaleclub** | store IDs | compute units | `usable_for_mvp` for ID discovery |
| Apify `aitorsm/pcexpress-product-scraper` | same banner enum, no wholesaleclub | address dropdown | compute units | `fallback` |
| Bright Data / Oxylabs Walmart datasets | US-heavy; CA grocery unproven here | varies | enterprise | `not_recommended` until a paid trial on #5831 |
| SerpApi Walmart | walmart.com US | zip | paid | `not_recommended` for CA grocery |
| SavviPrices | marketing site; no public Canada grocery API found this session | unknown | unknown | untested |

Scraping Loblaw/Empire/Walmart HTML from a third-party server likely violates ToS even if technically possible. Prefer partnership feeds for anything beyond MVP.

---

## 3. Walmart Canada (#5831)

### 3.1 Sources found

1. OpenWeb Ninja / RapidAPI Real-Time Walmart Data — **primary, live**
2. walmart.ca Orchestra GraphQL `getPreso` — blocked 412 from Node
3. Playwright persistent profile — local fallback
4. `GET https://www.walmart.ca/en/store/5831` SSR — store metadata only
5. walmart.io Affiliate / Content Provider — US walmart.com, approval, not GTA shelf feed
6. Marketplace APIs — sellers, not consumer grocery
7. Instacart (CBC: Walmart matched in-store historically) — no price API
8. Uber Eats Walmart — possible markup; not used
9. Flipp — flyer only
10. Apify Walmart actors — untested for CA store 5831

### 3.2 Documentation

- OpenWeb Ninja: https://www.openwebninja.com/api/real-time-walmart-data
- Key: https://app.openwebninja.com/api/realtime-walmart-data
- RapidAPI: https://rapidapi.com/letscrape-6bRBa3QguO5/api/real-time-walmart-data1
- OpenAPI: https://openwebninja.s3.us-east-1.amazonaws.com/portal/openapi/realtime_walmart_data.yaml
- walmart.io affiliates: https://walmart.io/apidocs/affiliates/introduction (US)
- robots.txt walmart.ca: fetch returned **418** this session (bot wall)

### 3.3 Official API?

No public consumer shelf API for walmart.ca grocery. Affiliate API is US, approval-gated, for referral links.

### 3.4 Auth

Rapid: paid API key. Browser: cookies + PerimeterX. Affiliate: consumer-id + signed headers after walmart.io approval.

### 3.5 Store / location parameters

`store_id=5831`, `zip=L4J0A7`, `domain=ca`. Cookies on site: `deliveryCatchment`, `defaultNearestStoreId`, `assortmentStoreId`.

### 3.6 Fields

Search/details typically: product id, title, brand, price, list_price, savings, package size, UPC/GTIN (sometimes), availability/out_of_stock, URL, badges. Seller/marketplace not always mapped in our connector today — treat missing seller as unknown, not “Walmart sold”.

### 3.7 Example request

```http
GET https://api.openwebninja.com/real-time-walmart-data/search?query=Mehadrin%202%25%20milk&domain=ca&store_id=5831&zip=L4J0A7&page=1
x-api-key: <OPENWEBNINJA_API_KEY>
```

### 3.8 Example response (shape used by `mapRapidProduct`)

```json
{
  "data": {
    "products": [
      {
        "product_id": "6000198384699",
        "product_title": "Mehadrin 2% 2LT milk",
        "brand": "Mehadrin",
        "price": 6.47,
        "list_price": 6.47,
        "upc": "066181001557",
        "package_size": "2L",
        "out_of_stock": true,
        "url": "https://www.walmart.ca/en/ip/Mehadrin-2-2LT-milk/6000198384699"
      }
    ]
  }
}
```

### 3.9 Accuracy vs shelf / receipts

**Gold label — in-store walk #5831, 2026-08-16 (operator):** Rapid/catalog prices matched the shelf on the staples list except **2 products**. Catalog that morning had **22 matched** WM lines (`walmart_5831_latest.json` `checkedAt` 2026-08-16T00:51Z). That is ~90%+ same-day shelf hit rate if the walk covered the matched list. The two misses are **not yet named** (price vs wrong SKU vs pack vs availability). Until named, do not treat Rapid as 100% shelf.

| Item | Receipt | Source (catalog 2026-08-16) | abs | % | Note |
|---|---|---|---|---|---|
| Simply Egg Whites 1kg | WM 2026-02-10 **$9.47** | Rapid **$9.47** | 0.00 | 0.0 | Same SKU `6000196635381` |
| YFM Grape Tomatoes 10oz | WM 2026-03-01 **$2.97** | Rapid **$2.97** | 0.00 | 0.0 | Same family; Rapid id sometimes ±1 vs URL |
| Mehadrin 2% 2L | WM 2026-05-05 **$5.49** | Rapid **$6.47** OOS | 0.98 | 17.9 | **Date gap + price move**, not a scrape miss |

Fulfillment: Rapid with `store_id` is **pickup/store-node price**, not 3P shipping. Confirm `seller` when mapping marketplace SKUs. Availability is returned (`out_of_stock` on Mehadrin 2026-08-16).

### 3.10 Legal / technical

Rapid is a third-party scrape of Walmart. Commercial use is per OpenWeb Ninja/Rapid ToS, **not** a Walmart license. walmart.ca blocks datacenter GraphQL (412). Do not scrape HTML from Vercel.

### 3.11 Cost

Rapid Pro **$25 / 10k req**. Staples refresh of ~30 SKUs × 2 stores/day ≈ 60–200 req/day if naive; cache 72h keeps this cheap. Playwright: $0 but not Vercel-safe.

### 3.12 Stability

Rapid: medium-high (provider can change fields / IDs). Browser: medium (PX). Official affiliate: N/A for CA grocery.

### 3.13 Primary

**Keep RapidAPI / OpenWeb Ninja** `domain=ca` + `store_id=5831`. Do not rewrite `walmart-rapid.ts`.

### 3.14 Backup

Playwright profile locally. Do not enable Flipp for shelf.

### 3.15 To implement (later, non-breaking)

- Map `seller` / `fulfillmentType` / `priceKind=shelf`
- Prefer `getProduct` for alphanumeric IDs
- Fill flour / sugar / oil staples (currently `no_match` in WM catalog — matcher gap, not a missing source)
- Optional: `/product-offers` to drop marketplace sellers

**Scores (Rapid):** shelf 4, store-specific 4, availability 3, catalog 4, stability 3, speed 5, legality 2, cost 4, integration 5, block-risk 3 → **`usable_for_mvp`** (already production).

---

## 4. No Frills (#3660) — Loblaw / PC Express

### 4.1 Sources

1. PCX BFF `api.pcexpress.ca` — **primary, live**
2. nofrills.ca (same BFF; browser cookies not required for the public search body)
3. PC Express app (same backend)
4. PC Optimum offers (loyalty; not shelf)
5. Flipp weekly flyer
6. Instacart (historical markups on Loblaw banners — CBC)
7. Apify Loblaw scrapers (wrap the same BFF; ToS)
8. Partnership / catalog feed from Loblaw (not obtained)

### 4.2 Docs / robots

- Site: https://www.nofrills.ca/
- robots.txt allows most paths; disallows `/cart/`, `/checkout/`, `/account/`
- No public developer portal for PCX grocery search
- PC Express: https://www.pcexpress.ca/

### 4.3 API?

Unofficial **web BFF**. Same key the website sends as `X-Apikey`. Not a licensed partner API.

### 4.4 Auth

`X-Apikey` public client key (rotatable via `NOFRILLS_API_KEY`). No user login for search. Akamai/WAF may 403 datacenter IPs. CSRF not required for this POST in current connector.

### 4.5 Location

`fulfillmentInfo.storeId = "3660"`, `pickupType: STORE`, `offerType: OG`, `Site-Banner: nofrills`, `banner: nofrills`. Postal is implicit via store id.

### 4.6 Fields

`productId` (e.g. `20094120003_EA`), title, brand, `packageSizing` with unit price text, `pricing.price`, `wasPrice`, deal/promotions, stock-ish flags.

### 4.7 Example request

```http
POST https://api.pcexpress.ca/pcx-bff/api/v2/products/search
Content-Type: application/json
X-Apikey: <NOFRILLS_API_KEY>
Site-Banner: nofrills
X-Loblaw-Tenant-Id: ONLINE_GROCERIES
Origin: https://www.nofrills.ca
```

```json
{
  "fulfillmentInfo": {
    "storeId": "3660",
    "pickupType": "STORE",
    "offerType": "OG",
    "date": "16082026",
    "timeSlot": null
  },
  "listingInfo": {
    "filters": { "search-bar": ["kosher 2% milk"] },
    "pagination": { "from": 1 }
  },
  "banner": "nofrills"
}
```

### 4.8 Example mapped offer (live catalog 2026-08-16)

```json
{
  "productId": "20094120003_EA",
  "name": "Kosher 2% Milk",
  "price": 5.67,
  "packageSize": "2 l, $0.28/100ml",
  "sourceUrl": "https://www.nofrills.ca/en/kosher-2-milk/p/20094120003_EA"
}
```

Canola oil 3L: `price` 7.99, `wasPrice` 9.00, `onSale` true — **promotional** vs regular.

### 4.9 Accuracy

| Item | Receipt NF #3660 | PCX catalog 2026-08-16 | abs | % |
|---|---|---|---|---|
| Simply Egg Whites 500ml | 2026-03-15 **$5.49** | Free Run Egg Whites 500g **$5.50** | 0.01 | 0.2 |
| Mehadrin 2% 2L | 2026-05-05 **$5.29** | Kosher 2% Milk 2L **$5.67** | 0.38 | 7.2 |

Small errors are **time**, not a different store. PCX is pickup-catalog for that store node; treat as `same_as_in_store` with `fulfillmentType=pickup` until a same-day shelf photo proves otherwise.

### 4.10 Legal

Using the website’s client API key from a server likely **violates Loblaw ToS**. Akamai can block Vercel. Long-term: commercial feed / PC Express business program.

### 4.11 Cost

$0 (key is public). Operational cost = WAF blocks + key rotation.

### 4.12 Stability

High when unblocked. Key and payload shape have changed before (product-facade → pcx-bff v2).

### 4.13 Primary

Keep PCX BFF store **3660**. Do not rewrite.

### 4.14 Backup

Flipp (`NOFRILLS_ALLOW_FLIPP_FALLBACK`). Apify only as last resort.

### 4.15 Later

Generalize banner + storeId (needed for Wholesale Club). Map `pricingPolicy=promotional` when `wasPrice` present. Capture UPC if tiles include it.

**Scores (PCX):** shelf 4, store-specific 5, availability 3, catalog 5, stability 3, speed 4, legality 2, cost 5, integration 4, block-risk 2 → **`usable_for_mvp`**.

---

## 5. Wholesale Club Canada (Loblaw)

### 5.1 Sources

1. Same PCX BFF as No Frills with a different `Site-Banner` — **expected primary** (not wired)
2. https://www.wholesaleclub.ca/ and pickup https://www.wholesaleclub.ca/en/pickup
3. PC Express business: https://go.wholesaleclub.ca/CAPOnline (demo / membership)
4. Store locator: https://www.wholesaleclub.ca/store-locator — Richmond Hill details path `/store-locator/details/3724`
5. Club Savings flyer / Flipp
6. Instacart (some provinces; not a price API)
7. Apify PCX scrapers — **Wholesale Club banner omitted** from published enums

Closest GTA club found: **Wholesale Club Richmond Hill, 10909 Yonge St, L4C 3E3, locator id `3724`**. No Vaughan/Thornhill club in public listings this session. Restaurants near Promenade would drive ~10–15 min.

### 5.2 Docs

No public grocery API. Business PC Express: request a demo on CAPOnline. Loblaw Terms of Use apply.

### 5.3 API?

Same unofficial BFF. Banner **`wholesaleclub`** confirmed (needs `Accept-Language: en`). Shared client: `src/connectors/pcx-bff.ts`. Adapter: `src/connectors/wholesaleclub.ts`. Isolated probe: `src/poc/probe-pcx-banner.ts` (needs `NOFRILLS_API_KEY` in `.env.local`, not committed).

### 5.4 Auth

Same `X-Apikey` as other PCX web properties. Membership may be required for **checkout**, not necessarily for catalog browse — verify after banner probe.

### 5.5 Location

`storeId` **`3724`** (locator `/store-locator/details/3724`), `Site-Banner: wholesaleclub`, `pickupType: STORE`. Richmond Hill, 10909 Yonge St, L4C 3E3. Third staples compare store (alongside Walmart #5831 and No Frills #3660). Sobeys remains flyer-only.

### 5.6–5.8 Fields / examples

Expect the same tile shape as No Frills (`pricing.price`, `packageSizing`, productId `*_EA`). Case packs (`*_C##`) are listed on the club site; consumer compare skips them.

Request (candidate):

```http
POST https://api.pcexpress.ca/pcx-bff/api/v2/products/search
Site-Banner: wholesaleclub
```

Body: same as No Frills with `"banner": "wholesaleclub"`, `"storeId": "3724"`.

### 5.9 Accuracy

Not tested against a Wholesale Club receipt this session. Case packs will not match NF/WM consumer SKUs — matching must use UPC + pack size.

### 5.10 Legal

Same as No Frills BFF. Membership portal ToS for CAPOnline.

### 5.11 Cost

$0 unofficial BFF; or sales-assisted PC Express feed (quote unknown).

### 5.12 Stability

If banner works: same as NF. If membership-gated JSON: lower.

### 5.13 Primary

**Clone No Frills connector** with `banner` + `storeId` parameters. Done: `WholesaleClubConnector` + `pcx-bff.ts`. Do not duplicate mapping logic. Catalog `data/catalog/wholesaleclub_3724_latest.json`. Refresh `POST /api/staples/refresh-wc` / `npm run cache:wholesaleclub`.

### 5.14 Backup

Weekly flyer / Flipp; ask Loblaw foodservice for a case-pack feed.

### 5.15 To implement

1. Confirm `Site-Banner` and store id in a residential browser (Network).
2. Run `npm run probe:pcx-banner wholesaleclub 3724 milk`.
3. Add `WholesaleClubConnector` wrapping shared PCX client — **new file**, do not break `NoFrillsConnector`.
4. New staple pack sizes (20kg flour, 18-pack eggs, etc.).

**Scores (PCX clone, pending probe):** shelf 3, store-specific 4, availability 3, catalog 4, stability 3, speed 4, legality 2, cost 5, integration 4, block-risk 2 → **`usable_for_mvp`** after banner confirmation.

---

## 6. Sobeys (Clark & Hilda, store 659)

### 6.1 Sources

1. Flipp / flyers.sobeys.com — **current POC**
2. sobeys.com store page (locator; not a full shelf API in this repo)
3. Voilà by Sobeys — **fulfillment-centre / regional**, not Clark & Hilda shelf
4. Instacart — possible markup; no price API
5. Uber Eats — documented markup vs Toronto Sobeys
6. DoorDash — untested; assume markup
7. Scene+ offers — loyalty, not shelf catalog
8. Official weekly flyer PDF/images
9. Empire partner feed — not public

### 6.2 Docs

- Store: https://www.sobeys.com/en/stores/sobeys-clark-hilda
- Voilà: https://www.sobeys.com/voila-by-sobeys and https://voila.ca/content/about-us--a-propos-de-nous
- Voilà FAQ: “Pricing is similar to our in region banners. **Promotions may differ by service and store.** Sign in and select a time slot to see the most accurate prices.”
- Marketing: “same regular prices you’d find in-store” — **regular**, not guaranteed promo parity, and **not a named store**.
- Ontario Voilà ships from Ocado-style facilities (Vaughan FC), mixing Sobeys + Longo’s + Farm Boy SKUs.

### 6.3 API?

No confirmed store-scoped catalog API like PCX. Voilà uses authenticated session JSON (community SDK `dearlordylord/voila-sdk` — ToS scrape). Flipp is public.

### 6.4 Auth

Flipp: none. Voilà: account + timeslot cookies. sobeys.com: typical web WAF.

### 6.5 Location

Flipp: `postal_code=L4J6W7`. Flyer store code **659**. Voilà: postal / timeslot, **not** merchant 659.

### 6.6 Fields (Flipp)

`name`, `current_price`, `merchant_id` 2072, `valid_from`/`valid_to`, image. No UPC, no stock.

### 6.7 Request

Best reproducible payload (thin adapter in `src/connectors/sobeys.ts`):

```http
GET https://backflipp.wishabi.com/flipp/flyers?locale=en-ca&postal_code=L4J6W7
GET https://flyers.sobeys.com/flyer_data/{ontarioWeeklyFlyerId}
```

Filter `merchant_id=2072`, prefer Ontario weekly (not Urban Fresh / Kosher). `flyer_data` returns ~hundreds of items with `current_price`, pack `description`, brand, photos. Almost no UPC. Prices are **regional flyer**, not store-659 shelf.

Flyer widget location cookies: `postal_code=L4J6W7`, `store_code_2072=659`. Browser Network did not yield a public shelf+price API for store 659 (`/flyer_items/{id}/details` 404 from Node).

Older Flipp item search (subset of the same flyer):

```http
GET https://backflipp.wishabi.com/flipp/items/search?locale=en-ca&postal_code=L4J6W7&q=Sobeys%20eggs
```

### 6.8 Response (live 2026-08-16, milk query)

```json
{
  "items": [
    {
      "merchant_name": "Sobeys",
      "merchant_id": 2072,
      "name": "Sweetened Condensed Milk",
      "current_price": 3.28,
      "valid_from": "2026-08-13T04:00:00+00:00",
      "valid_to": "2026-08-20T03:59:59+00:00",
      "item_type": "flyer"
    }
  ]
}
```

### 6.9 Accuracy

Flipp ≠ shelf for items not on the flyer. No Clark & Hilda receipt in `data/receipts` this session. Voilà must be labelled `pricingPolicy=unknown` or regional, **never** `same_as_in_store` for store 659 without a paired receipt.

### 6.10 Legal

Flipp public search is the flyer widget. Voilà scraping is against typical ToS. Uber/Instacart: platform ToS + wrong price kind.

### 6.11 Cost

Flipp $0. Voilà unofficial: $0 + block risk. Partner feed: sales quote.

### 6.12 Stability

Flipp: high for weekly ads, useless off-flyer. Voilà session JSON: low/medium.

### 6.13 Primary

Keep Flipp as **`estimated` / `promotional`**. Do not claim shelf.

### 6.14 Backup

1. Manual CSV / receipt import for the 20–50 SKUs this restaurant actually buys at Sobeys.
2. Later: Voilà as a **separate banner** `voila_gta` with `fulfillmentType=delivery`, not as Clark & Hilda.

### 6.15 To implement

Do not add Voilà to production yet. Optional isolated session probe only on a local browser, never on Vercel.

**Scores (Flipp):** shelf 1, store-specific 2, availability 0, catalog 1, stability 4, speed 5, legality 3, cost 5, integration 5, block-risk 4 → **`fallback`**.  
**Voilà:** shelf 2, store-specific 1, availability 3, catalog 4, stability 2, speed 3, legality 1, cost 5, integration 2, block-risk 2 → **`not_recommended`** as Clark & Hilda.  
**Uber Eats Sobeys:** **`not_recommended`**.

---

## 7. FreshCo

### 7.1 Sources

1. freshco.com — locator + weekly flyer (Flipp). **No full e-commerce catalog.**
2. Flipp (`src/connectors/freshco.ts`, not in factory)
3. Instacart / Uber Eats — official “shop online” path
4. Scene+ flyers / app
5. Empire partner feed — not public

### 7.2 Docs

- https://freshco.com/instacart-uber-eats/
- FAQ on that page asks: “Will I get the same prices and promotions offered in store on Instacart and Uber Eats?” — the existence of the question plus Empire’s Sobeys statement imply **possible difference**. Do not assume Everyday Store Prices.
- Scene+: loyalty, not a product API.

### 7.3 API?

No PCX-style BFF found. Flipp public. Instacart IDP ≠ prices.

### 7.4 Auth

Flipp none. Instacart/Uber: user session in their apps.

### 7.5 Location

Need the **specific GTA FreshCo** the restaurant uses (not locked in code). Connector default postal `M1P2L8` is Scarborough — **wrong for Thornhill**. Use a Thornhill/Vaughan postal (e.g. `L4J3M8`) once the store is chosen. Discover: `npm run poc:discover-freshco`.

### 7.6–7.8 Flipp

Same Wishabi search with `q=FreshCo eggs`. Flyer only.

### 7.9 Accuracy

No FreshCo receipts in repo. Treat all delivery-app prices as `possible_markup` until a same-day shelf photo.

### 7.10–7.12

Legal: Flipp OK for ads; scraping Instacart/Uber **not recommended**. Cost $0. Stability of Flipp high, completeness low.

### 7.13 Primary

Flipp **`fallback` / `estimated`** after locking a store postal.

### 7.14 Backup

Receipt import + admin CSV. Ask the store for a weekly staples list.

### 7.15 To implement

Do not enable in `getConnector()` until a store is locked. Then copy Sobeys Flipp connector with the correct postal + merchant name.

**Scores (Flipp):** same class as Sobeys Flipp → **`fallback`**.  
**Instacart/Uber:** **`not_recommended`** for shelf.

---

## 8. Olive Branch Thornhill (1 Promenade Circle)

### 8.1 Sources

1. https://olivebranchthornhill.ca/ — WordPress. Weekly flyer as **images**, not a product grid.
2. WhatsApp broadcast (“Join Our WhatsApp Group!” — admin posts, no catalog API)
3. Loyalty app: iOS `id6511245447`, Android `com.hds.olivebranch.loyalty` (charity/offers, not grocery SKUs)
4. HoneyCart catering: https://olivebranchthornhill.gethoneycart.com/ — platters only
5. Newsletter (CAPTCHA)
6. No Shopify Storefront catalog found
7. No Instacart/Uber storefront found this session
8. Practical: OCR flyers, receipt import, CSV from the store

### 8.2 Docs / pages

Homepage flyer CTA; catering via HoneyCart. Address **1 Promenade Circle, Thornhill L4J 4P8**. Email orders@olivebranchthornhill.ca.

Flyer images (week of 13–19 Aug 2026, from site uploads):  
`https://olivebranchthornhill.ca/wp-content/uploads/2026/08/260813-1.jpg` … `-7.jpg` (image OCR, not JSON).

### 8.3 API?

None for grocery. HoneyCart is a catering cart. Loyalty app is closed.

### 8.4 Auth

Public HTML/images. WhatsApp is invite-only. HoneyCart checkout is customer session.

### 8.5 Location

Single store. No store-id parameter.

### 8.6 Fields available

Flyer: product name + promo price in pixels. No UPC, no availability, incomplete catalog.

### 8.7–8.8

No grocery JSON. HoneyCart example is catering (“Chicken Fingers large $250”), useless for milk/eggs.

### 8.9 Accuracy

Flyer prices are promotional and week-bounded. Full shelf is unknown without receipts.

### 8.10 Legal

OCR of their public flyer is reasonable for internal procurement. Do not scrape the loyalty app. Ask the store for a CSV.

### 8.11 Cost

OCR (existing vision / Tesseract) + staff time. Partnership feed: $0 if they email Excel.

### 8.12 Stability

Flyer images change weekly. Manual process is stable if someone updates 20–50 SKUs.

### 8.13 Primary

**`manual_only`**: CSV template + receipt ingest + weekly flyer OCR for advertised SKUs.

### 8.14 Backup

WhatsApp sale posts transcribed by staff.

### 8.15 To implement (no production scrape)

1. Admin CSV: `upc,name,brand,pack,price,sale_price,unit,checked_at`.
2. Reuse `data/receipts/` import.
3. Optional OCR job on `wp-content/uploads` flyer JPGs into `estimated` rows.
4. Email the store asking for a staples price list.

**Scores (flyer OCR):** shelf 2, store-specific 5, availability 0, catalog 1, stability 3, speed 1, legality 4, cost 4, integration 3, block-risk 5 → **`manual_only`**.

---

## 9. MVR Cash & Carry / MVR Wholesale

### 9.1 Sources

1. **Shopify store** https://plus.mvrwholesale.com/ — **~20,783 products**, public JSON — **primary**
2. https://www.mvrwholesale.com/ (same Plus storefront)
3. Public `GET /products.json` and `GET /search/suggest.json` — **no auth**
4. `GET /products/{handle}.json`
5. Agent commerce: `GET /.well-known/ucp`, `POST /api/ucp/mcp` (Shopify UCP; not required)
6. Monthly flyer (image/PDF on the Plus theme)
7. Single warehouse: **3655 Weston Rd, North York M9L 1V8** (only location; FAQ)
8. https://www.getjitto.com/ — **different company** (produce for small communities). Not an MVR API.
9. Restaurant portal = the Shopify Plus store (account for checkout)

### 9.2 Docs

- Location: https://plus.mvrwholesale.com/pages/location
- FAQs: https://plus.mvrwholesale.com/pages/faqs — MVR Plus is for registered Cash & Carry customers; delivery + curb-side pickup
- Shopify Ajax: https://shopify.dev/docs/api/ajax/reference/product

### 9.3 API?

Yes, **public Shopify Ajax/JSON**. Not Storefront API token required for read of published products.

### 9.4 Auth

Catalog read: none. Checkout / B2B price lists: customer account (untested; tags already expose INSTOREPRICE).

### 9.5 Location

One warehouse. No store selector. `storeId` can be `mvr-weston`.

### 9.6 Fields

`title`, `vendor`, `handle`, `tags` (`INSTOREPRICE`, `MARKUP:1.1`, `MARGIN:0.90`, `SHELFLOCATION`, `LASTUPDATED`, tax), variant `sku` (UPC), `price` (online), `available`.

**Critical:** `variant.price` is **online with ~10% markup**. `INSTOREPRICE` tag is the **shelf / warehouse cash price**. Example: online $18.43 vs INSTOREPRICE $16.59 (`16.59 × 1.1 ≈ 18.25`).

### 9.7 Requests

```http
GET https://plus.mvrwholesale.com/products.json?limit=5
GET https://plus.mvrwholesale.com/search/suggest.json?q=eggs&resources[type]=product&resources[limit]=8
GET https://plus.mvrwholesale.com/products/grayridge-white-medium-30pk-eggs.json
```

Isolated POC: `npm run probe:mvr -- eggs`

### 9.8 Live responses (2026-08-16)

```json
{
  "title": "GRAY RIDGE - GRAYRIDGE WHITE MEDIUM EGGS 30PK",
  "vendor": "GRAY RIDGE",
  "price": "10.77",
  "tags": [
    "INSTOREPRICE:9.69",
    "MARKUP:1.1",
    "LASTUPDATED:2026-04-09T13:11:14.651Z",
    "SHELFLOCATION:B.29.03"
  ]
}
```

```json
{
  "title": "SEALTEST - 2% MILK 4LT",
  "price": "6.99",
  "tags": ["INSTOREPRICE:6.29", "MARKUP:1.1", "LASTUPDATED:2026-05-04T12:45:14.579Z"]
}
```

Robin Hood / Five Roses AP flour 2.5kg listed on search HTML at **$7.21** (online). Fixture: `src/connectors/fixtures/mvr-sample.json`.

### 9.9 Accuracy

No MVR receipt in repo. Tag math is internally consistent (`× 1.1`). `LASTUPDATED` on eggs was **April 2026** while the product is still published — **tag freshness is uneven**. Treat INSTOREPRICE as `shelf` with `confidence=medium` until a same-week warehouse receipt. Online price = `possible_markup`.

### 9.10 Legal

Published Shopify JSON is the storefront the site already exposes. Commercial use of prices: Shopify ToS + MVR customer agreement. Do not scrape checkout after login. Asking MVR for a CSV/feed is cleaner long-term.

### 9.11 Cost

$0 for public JSON. Rate-limit politely (pagination on `/products.json`).

### 9.12 Stability

High (standard Shopify). Tag schema (`INSTOREPRICE`) could be removed by a theme/ERP change — monitor.

### 9.13 Primary

Shopify JSON. Prefer **INSTOREPRICE** for restaurant cash-and-carry comparisons. Store online price separately.

### 9.14 Backup

Monthly flyer OCR; email MVR for Excel; receipt import.

### 9.15 To implement

New `MvrShopifyConnector` (new file). Map:

- `price` = INSTOREPRICE if present else variant.price
- `regularPrice` unused; `salePrice` unused unless compare_at
- `pricingPolicy` = `same_as_in_store` if using tag else `possible_markup`
- `priceKind` = `shelf` vs `online`
- `upc` = variant.sku
- `fulfillmentType` = `in_store` (warehouse) or `delivery` if quoting Plus delivery

Do not touch Walmart/NF.

**Scores (Shopify + INSTOREPRICE):** shelf 4, store-specific 5 (single warehouse), availability 4, catalog 5, stability 4, speed 5, legality 3, cost 5, integration 5, block-risk 4 → **`recommended`** (with markup split).

---

## 10. Test basket (same SKU intent, 2026-08-16 catalogs)

Sources: `data/catalog/walmart_5831_latest.json`, `nofrills_3660_latest.json`, live MVR suggest, Flipp Sobeys. Avocado and paper towels are **not** pinned staples.

| Product | Store | Store ID | Brand / name | UPC | Pack | Regular | Sale | Unit | Avail | Source | Checked | Policy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Milk 2% | Walmart | 5831 | Mehadrin 2% 2LT | 066181001557 | 2L | 6.47 | — | — | out_of_stock | Rapid | 2026-08-16T00:48Z | same_as_in_store (pickup node) |
| Milk 2% | No Frills | 3660 | Kosher 2% Milk | — | 2L | 5.67 | — | $0.28/100ml | unknown | PCX | 2026-08-16T00:49Z | same_as_in_store (pickup) |
| Milk 2% | MVR | mvr-weston | Sealtest 2% 4LT | 0006442000077 (sku) | 4L | 6.29 in-store / 6.99 online | — | — | available | Shopify tags | LASTUPDATED 2026-05-04 | split shelf vs markup |
| Butter | Walmart | 5831 | Gay Lea Unsalted | — | 454g | 7.96 | — | — | unknown | Rapid | 2026-08-16T00:49Z | same_as_in_store |
| Butter | No Frills | 3660 | Gay Lea Unsalted | — | 454g | 8.29 | — | $1.83/100g | unknown | PCX | 2026-08-16T00:49Z | same_as_in_store |
| Eggs | Walmart | 5831 | GV Large 12 | — | 12 | 3.93 | — | — | unknown | Rapid | 2026-08-16T00:48Z | same_as_in_store |
| Eggs | No Frills | 3660 | No Name Large 12 | — | 12 | 3.93 | — | $0.33/ea | unknown | PCX | 2026-08-16T00:49Z | same_as_in_store |
| Eggs | MVR | mvr-weston | Gray Ridge medium 30pk | — | 30 | 9.69 / 10.77 online | — | — | available | Shopify | LASTUPDATED 2026-04-09 | split |
| Flour 2.5kg | No Frills | 3660 | All-Purpose Flour | — | 2.5kg | 3.79 | — | $0.15/100g | unknown | PCX | 2026-08-16T00:49Z | same_as_in_store |
| Flour 2.5kg | Walmart | 5831 | — | — | — | **no_match** | — | — | — | Rapid search | — | matcher gap |
| Flour 2.5kg | MVR | mvr-weston | Robin Hood / Five Roses | — | 2.5kg | 7.21 online | — | — | — | Shopify search HTML | 2026-08-16 | possible_markup |
| Sugar 2kg | No Frills | 3660 | Granulated Sugar | — | 2kg | 2.99 | — | $0.15/100g | unknown | PCX | 2026-08-16T00:49Z | same_as_in_store |
| Sugar 2kg | Walmart | 5831 | — | — | — | **no_match** | — | — | — | Rapid | — | matcher gap |
| Tomatoes grape | Walmart | 5831 | YFM 10 oz | — | 283g | 2.97 | — | — | unknown | Rapid | 2026-08-14 | same_as_in_store |
| Tomatoes grape | No Frills | 3660 | Grape Tomato | — | 907g | 7.99 | — | $0.88/100g | unknown | PCX | 2026-08-16 | different pack |
| Blueberries | Walmart | 5831 | 312 g | — | 312g | 3.44 | — | — | unknown | Rapid | 2026-08-14 | same_as_in_store |
| Blueberries | No Frills | 3660 | 2 LB | — | 907g | 7.99 | — | $0.88/100g | unknown | PCX | 2026-08-16 | different pack |
| Canola oil 3L | No Frills | 3660 | 100% Pure Canola | — | 3L | 9.00 | **7.99** | $0.27/100ml | unknown | PCX | 2026-08-16 | promotional |
| Canola oil 3L | Walmart | 5831 | — | — | — | **no_match** | — | — | — | Rapid | — | matcher gap |
| Avocado | all | — | — | — | — | not in staples | — | — | — | — | — | — |
| Paper towels | all | — | — | — | — | not in staples | — | — | — | — | — | — |
| Milk (flyer) | Sobeys | 659 / L4J6W7 | Sweetened condensed | — | — | 3.28 | flyer | — | unknown | Flipp | 2026-08-16 | estimated / promotional |

### Receipt vs source (`absolute_error`, `percentage_error`)

```text
WM Simply Egg Whites 1kg: |9.47 - 9.47| / 9.47 = 0.0%
WM Grape tomatoes 10oz:   |2.97 - 2.97| / 2.97 = 0.0%
WM Mehadrin 2% 2L:        |6.47 - 5.49| / 5.49 = 17.9%   (receipt 2026-05-05 vs catalog 2026-08-16)
NF Egg whites 500ml:      |5.50 - 5.49| / 5.49 = 0.2%
NF Mehadrin 2% 2L:        |5.67 - 5.29| / 5.29 = 7.2%    (same date-gap caveat)
```

Same-day SKU matches are excellent for WM Rapid and NF PCX. Multi-month receipts cannot be used as scrape-error proof.

**Walmart #5831 physical audit 2026-08-16:** operator reported **2 wrong products on the whole staples list**; remaining matched lines agreed with the shelf. Two SKUs not recorded yet — pin them when named.

---

## 11. Method scores (0 = worst, 5 = best)

Polarity: **cost 5 = cheap**, **complexity/integration 5 = easy**, **block-risk 5 = low risk**.

| Method | Shelf | Store | Avail | Catalog | Stable | Speed | Legal | Cost | Easy | Low-block | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| WM Rapid store_id | 4 | 4 | 3 | 4 | 3 | 5 | 2 | 4 | 5 | 3 | `usable_for_mvp` |
| WM Playwright | 4 | 5 | 3 | 4 | 2 | 2 | 2 | 5 | 2 | 2 | `fallback` (local only) |
| WM getPreso Node | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 5 | 1 | 0 | `not_recommended` (412) |
| WM walmart.io CA grocery | — | — | — | — | — | — | 5 | ? | — | 5 | not available |
| NF PCX BFF | 4 | 5 | 3 | 5 | 3 | 4 | 2 | 5 | 4 | 2 | `usable_for_mvp` |
| WC PCX clone | 3 | 4 | 3 | 4 | 3 | 4 | 2 | 5 | 4 | 2 | `usable_for_mvp` after probe |
| MVR Shopify INSTOREPRICE | 4 | 5 | 4 | 5 | 4 | 5 | 3 | 5 | 5 | 4 | `recommended` |
| MVR online variant.price | 2 | 5 | 4 | 5 | 4 | 5 | 3 | 5 | 5 | 4 | `usable_for_mvp` if labelled markup |
| Sobeys Flipp | 1 | 2 | 0 | 1 | 4 | 5 | 3 | 5 | 5 | 4 | `fallback` |
| Voilà session JSON | 2 | 1 | 3 | 4 | 2 | 3 | 1 | 5 | 2 | 2 | `not_recommended` for store 659 |
| FreshCo Flipp | 1 | 2 | 0 | 1 | 4 | 5 | 3 | 5 | 5 | 4 | `fallback` |
| Instacart IDP | 0 | 0 | 0 | 0 | 5 | 5 | 5 | 4 | 4 | 5 | `not_recommended` (links only) |
| Uber Eats / DoorDash | 0 | 2 | 2 | 3 | 3 | 2 | 1 | 5 | 1 | 2 | `not_recommended` |
| Olive Branch flyer OCR | 2 | 5 | 0 | 1 | 3 | 1 | 4 | 4 | 3 | 5 | `manual_only` |
| Admin CSV / receipts | 5 | 5 | 2 | 1 | 5 | 1 | 5 | 5 | 4 | 5 | `manual_only` / gold labels |
| Apify Loblaw scraper | 3 | 4 | 3 | 4 | 2 | 3 | 1 | 3 | 3 | 1 | `fallback` |
| Partnership data feed | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 2 | 3 | 5 | `recommended` long-term, not in hand |

---

## 12. Comparison table

| Store | Primary source | Backup source | Shelf-price accuracy | Store-specific | Availability | Cost | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|
| Walmart #5831 | OpenWeb Ninja / Rapid `domain=ca&store_id=5831` | Playwright profile | **Same-day shelf walk 2026-08-16: 2 misses on the full list** (~90%+ of 22 matched lines). Older receipts 0% on egg whites / grape tomatoes | Yes (node 5831) | Partial (`out_of_stock` mapped) | ~$25/10k | Provider + ToS | **Keep. Do not rewrite. Pin the 2 misses.** |
| No Frills #3660 | PCX BFF `Site-Banner: nofrills` | Flipp | High (0.2% egg whites; milk gap is dated receipt) | Yes (3660) | Weak/unknown often | $0 | WAF / ToS | **Keep. Do not rewrite.** |
| Wholesale Club | PCX BFF (`wholesaleclub` + store `3724`) | Flyer / foodservice feed | Live PCX shelf at #3724; skip case packs | Yes | Same as NF | $0 | Same as NF | **Third compare store. Do not rewrite NF.** |
| Sobeys Clark & Hilda | Flipp postal L4J6W7 | Receipts/CSV; Voilà as separate regional banner | Flyer only | Weak (flyer region, not shelf) | No | $0 | Low for Flipp | **Estimated only. Do not use Voilà as this store.** |
| FreshCo | Flipp after locking postal | Receipts/CSV | Flyer only | After store lock | No | $0 | Low for Flipp | **Do not enable until store locked. Not Instacart.** |
| Olive Branch | Manual CSV + receipts + flyer OCR | WhatsApp sale posts | High only for staff-entered SKUs | Yes (single store) | No | Staff time | Low | **manual_only. Ask for Excel.** |
| MVR Weston | Shopify JSON `INSTOREPRICE` | Online `variant.price` labelled markup; flyer | Tag math consistent; tag dates can be stale | Yes (one warehouse) | Yes (`available`) | $0 | Tag schema change | **Add as new connector. Split shelf vs +10% online.** |

---

## 13. Implementation order (easiest / most reliable → hardest)

Do **not** change production Walmart or No Frills mapping to do this.

1. **Keep WM Rapid + NF PCX** as-is. Fill WM `no_match` staples (flour, sugar, oil) via existing Rapid `getProduct` / better queries — matcher work, not a new source.
2. **MVR Shopify connector** (new file). Public JSON, INSTOREPRICE vs online. Fixture + `probe:mvr` already added. Highest new-store ROI.
3. **Wholesale Club PCX** — **done** for staples compare: banner `wholesaleclub`, store `3724`, shared `pcx-bff.ts`. Keep WM/NF behavior unchanged.
4. **Gold-label receipts** — same-day photos for WM/NF/MVR to replace dated CSV. This is how shelf accuracy becomes scientific.
5. **Olive Branch CSV template + flyer OCR** — no API fantasy.
6. **Sobeys** — leave Flipp estimated; optional later `voila_gta` banner explicitly **not** store 659.
7. **FreshCo** — only after locking a store; Flipp then partnership.
8. **Partnerships last** — Loblaw PC Express business, Empire/Sobeys, Walmart content provider, MVR Excel. Best legality, slowest.
9. **Never for shelf math:** Instacart IDP, Uber Eats, DoorDash, Voilà-as-Clark-Hilda, datacenter GraphQL against PerimeterX.

---

## 14. Isolated artifacts added this pass

| Path | Role |
|---|---|
| `src/connectors/store-connector.ts` | `StoreConnector` / `StorePrice` types + MVR tag parser |
| `src/connectors/fixtures/mvr-sample.json` | Live Shopify fixture |
| `src/poc/probe-mvr-shopify.ts` | Public search probe |
| `src/poc/probe-pcx-banner.ts` | Wholesale Club / banner probe (key from env only) |
| `src/poc/store-connector-self-check.ts` | Fixture assertions |
| `.env.example` | Variable **names** only |

Run:

```bash
npm run poc:store-connector
npm run probe:mvr -- milk
```

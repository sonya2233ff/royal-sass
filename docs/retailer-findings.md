# Locked 3-store POC findings

Last updated: 2026-08-12

## Locked stores (do not auto-replace)

| Retailer | Location | Internal ID | Status |
|----------|----------|-------------|--------|
| Walmart | Supercentre #5831, 700 Centre St, Thornhill L4J 0A7 | **5831** (confirmed by user + `/en/store/5831` SSR) | Shelf via Playwright persistent profile (`npm run walmart:warm`); plain fetch/GraphQL hit PerimeterX. See [walmart-pricing.md](walmart-pricing.md) |
| No Frills | Anthony's #3660, 1054 Centre St, Vaughan L4J 3M8 | **3660** (confirmed by user) | **Exact** store prices via PCX BFF |
| Sobeys | Clark & Hilda, 441 Clark Ave W, Thornhill L4J 6W7 | Flipp `merchant_store_code` **659** | Flyer/Flipp only → **estimated** |

## Confirmed

- No Frills #3660: `POST api.pcexpress.ca/pcx-bff/api/v2/products/search` with `fulfillmentInfo.storeId=3660` returns product tiles with `pricing.price` (exact).
- Sobeys Clark & Hilda appears in `flyers.sobeys.com` nearest_stores as `merchant_store_code: "659"` for address 441 Clark Avenue West.
- Flipp/backflipp returns Sobeys flyer items for postal `L4J6W7` (merchant_id 2072) — flyer/promo coverage, not full shelf.
- Walmart getPreso with store cookies for 5831 returns HTTP 412 (PerimeterX) from this environment.

## Assumptions / gaps

- Sobeys has **no confirmed** PCX-style store-scoped full catalog API for Clark & Hilda shelf prices.
- Flipp Sobeys prices are **not** proven equal to in-store shelf at 659.
- Voila ≠ Clark & Hilda shelf (not assumed).
- Walmart #5831 shelf prices: Playwright profile (`npm run walmart:warm`) — no manual cookie paste. Optional legacy `WALMART_BROWSER_COOKIE`.

## How to run

```bash
npm run poc:fixtures
$env:WALMART_ALLOW_FLIPP_FALLBACK='1'; npm run poc
npx tsx src/poc/store-diff.ts no_frills 3660 3660 "2% milk 4L"
npx tsx src/poc/store-diff.ts sobeys 659 659 "milk"
npx tsx src/poc/store-diff.ts walmart_ca 5831 5831 "milk"
```

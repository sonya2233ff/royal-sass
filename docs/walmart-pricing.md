# Walmart Canada — how store-specific pricing works

## Locked store

**Walmart Supercentre #5831**  
700 Centre St, Thornhill, ON L4J 0A7

## Confirmed model (how price is formed per location)

```text
Postal / map pin
    → store NODE id (5831)
    → browser cookies:
         deliveryCatchment=5831
         defaultNearestStoreId=5831
         assortmentStoreId=5831
    → search / product APIs return priceInfo for THAT node
```

- Same product (`usItemId`) can have **different** `priceInfo` at store 5831 vs another Walmart.
- Official Marketplace APIs are for **sellers**, not consumer shelf prices.
- Flipp = weekly flyer only — **not** shelf catalog for #5831.

## Primary path (no manual cookie paste)

PerimeterX blocks plain `fetch`/GraphQL from Node. Use a **persistent Playwright profile**:

```bash
npm run walmart:warm
```

1. Headed Chromium opens with profile `data/walmart-profile/`.
2. Pass Verify / select store **#5831** if needed.
3. Press Enter in the terminal when search looks normal.
4. Later runs reuse the same profile automatically:

```bash
npm run poc:receipt
npm run poc:walmart-verify
npm run poc
```

Connector order:

1. Optional fast path: `WALMART_BROWSER_COOKIE` (legacy; expires often)
2. SSR search HTML
3. getPreso GraphQL
4. **Playwright persistent session** (`WALMART_USE_BROWSER` default on; set `0` to disable)
5. Flipp only if `WALMART_ALLOW_FLIPP_FALLBACK=1` (not recommended for shelf)

Env knobs:

| Var | Meaning |
|-----|---------|
| `WALMART_USE_BROWSER` | Default on; `0` disables Playwright fallback |
| `WALMART_BROWSER_HEADLESS` | Set `1` for headless (may fail PX more often) |
| `WALMART_BROWSER_PROFILE` | Override profile dir (default `data/walmart-profile`) |
| `WALMART_BROWSER_COOKIE` | Optional legacy Cookie header |

## What we probed (2026-08-12)

| Path | Result for #5831 |
|------|------------------|
| `GET /en/store/5831` SSR `__NEXT_DATA__` | **Works** — address, phone, nearby nodes. **No grocery prices.** |
| Map/locator idea (FetchNearByNodes) | PerimeterX / blocked |
| Search HTML `/en/search?q=...` | Redirect to `/blocked` (Verify Your Identity) |
| Orchestra `getPreso` GraphQL | HTTP 412 PerimeterX |
| Legacy `api/product-page/find-in-store` | HTTP 403 |
| Flipp | Irrelevant / incomplete — not usable as shelf source |
| Playwright persistent profile | **Viable** for local POC shelf prices |

## Maps

Maps/store pages are useful to **confirm the node** (we already verified 5831 = Centre St Thornhill).  
They do **not** expose the grocery shelf price list by themselves.

## Production note

This is a **local residential browser session**, not a VPS scraper. For production later: dedicated worker with a warm profile, or an official data partner.

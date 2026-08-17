# Royal SASS — cafe staples price compare (POC)

Walmart #5831 vs No Frills #3660. Sobeys off for this demo.

## Phone demo

**Live app:** https://royal-sass.vercel.app

1. Open the link on the phone
2. Select products → **Compare**
3. Walmart prices = shipped catalog cache; No Frills = live
4. Skip **Refresh WM** unless `OPENWEBNINJA_API_KEY` or `RAPIDAPI_KEY` is set (local `.env` and Vercel). `WALMART_SOURCE=rapid` with a blank key does **not** scrape walmart.ca.

**GitHub:** https://github.com/sonya2233ff/royal-sass

## Walmart price source (RapidAPI / OpenWeb Ninja)

Shelf prices for store `#5831` come from RapidAPI / OpenWeb Ninja, not from walmart.ca HTML:

1. Get a free key at [OpenWeb Ninja Real-Time Walmart Data](https://app.openwebninja.com/api/realtime-walmart-data) (or RapidAPI)
2. Put `OPENWEBNINJA_API_KEY=...` or `RAPIDAPI_KEY=...` in `.env` (and Vercel env for prod Refresh)
3. `WALMART_SOURCE=rapid` — required for the Rapid connector; empty keys fail loudly instead of hitting PerimeterX
4. `npm run probe:walmart-rapid` — smoke search for staples at `#5831`
5. `WALMART_SOURCE=rapid npm run cache:walmart` — refresh local catalog

Receipts lock identity (UPC → preferred SKU); RapidAPI supplies live price.

```bash
npm run receipts:import -- data/receipts/sample.csv
# then drop your 6-month export as CSV with columns:
# date,store,upc,name,qty,unit_price,line_total[,product_id,retailer]
```

## Local

```bash
npm install
cp .env.example .env
npm run dev
```

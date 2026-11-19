# PriceTrail — Personal Price History Tracker

Record product prices across stores over time, privately in your browser. See
lowest, highest, average and latest prices, spot price drops, compare stores,
and find the cheapest offer — with no account, no server, and no scraped data.

## Features

- **Dashboard** — tracked products, price drops, price rises, products at or
  below target, and the five most recent price updates.
- **My Products** — add, edit and delete products (name, category, brand,
  target price, product URL, notes). Search by name or brand; filter by
  category and price movement; sort by name, latest update, lowest price,
  or percentage change.
- **Price history** — every product keeps its own price records (store,
  price, date, notes). Lowest, highest, average, latest price and percentage
  change from the previous record are calculated automatically. A native SVG
  chart shows the history with the lowest point highlighted and a dashed
  target-price line when a target is set.
- **Compare** — the latest recorded price from each store for a product, the
  cheapest offer highlighted, potential savings vs the most expensive store,
  and the recording date of each price so older prices are not mistaken for
  current offers.
- **Settings** — currency (PKR, USD, EUR, GBP, INR, SAR, AED), light/dark
  theme, JSON backup export and restore, CSV export of price records, and
  delete-all-data (type DELETE to confirm).

## How it works

- All data lives in IndexedDB in your browser. Nothing leaves your device.
- Money is stored as integer minor units, so 0.1 + 0.2 style rounding errors
  cannot happen.
- Changing the default currency only affects products added afterwards.
  Existing prices are never converted or relabelled.
- Backups are schema v1 JSON. Restore validates every record first and only
  replaces your data when the whole file is valid.

## Run it

Open `index.html` in a browser, or serve the folder with any static server:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Tech

Vanilla HTML, CSS and JavaScript only. No frameworks, libraries, CDNs or
external requests. No build step.

## Files

- `index.html` — app shell, navigation, dialogs
- `styles.css` — layout, light/dark themes, responsive rules
- `app.js` — views, forms, rendering
- `db.js` — IndexedDB persistence
- `calculations.js` — money parsing, statistics, validation (pure functions)
- `charts.js` — native SVG price-history chart
- `backup.js` — JSON backup/restore, CSV export

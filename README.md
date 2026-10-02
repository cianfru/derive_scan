# Torq

Repository `derive_scan`. Torq’s landing page and market workspace live in `frontend/` (React + Vite, deployed as static files).

Reflex's signals on Derive's perps, plus Derive's options volatility surface.

- Signals: Reflex's signal code (engines, synthesizer, decision pipeline, agent filters), copied unchanged into `backend/reflex` at a pinned Reflex commit, run on Derive's candles for every Derive perp after each 4H and daily close. Design: `docs/signal-port.md`. Check against Reflex: `docs/parity-report.md`.
- Options: Derive does not serve past volatility surfaces, so the recorder builds the history every 15 minutes.

Both run in one GitHub Action (`.github/workflows/record.yml`) that commits plain files to the `data` branch: no server, no cost on a public repo. The FastAPI app in `backend/` serves the options data from SQLite and is kept for local use; it is not deployed.

## Frontend

```sh
cd frontend
npm ci
npm run dev       # http://127.0.0.1:5173
npm test
npm run build     # static output in frontend/dist
npm run preview   # serve the production build locally
```

Use Node.js 22 LTS. Publish `frontend/dist` to a static host after building; the source `index.html` requires Vite and is not opened directly. Relative asset paths and hash navigation support deployment under a subdirectory. Routes: `#home`, `#scanner`, `#surface`, `#watchlist`.

The workspace includes market search, sorting, active-signal filters, 4H/1D switching, a browser-local watchlist, CSV export of the current view, market detail charts, and BTC/ETH options term structures. The palette follows Derive’s charcoal and orange, with responsive layouts and reduced-motion support.

Data comes from this repository’s public `data` branch, refreshed on load, manually, and every five minutes. Each feed refreshes independently. Bundled, timestamped real snapshots provide a first render and fallback; an unavailable feed retains the last good data and is marked offline. Signals use closed-bar prices, and the 24h change compares six 4H bars or one daily bar. The charts show 24 closed bars, not a streaming price feed. Insufficient history and thin volume are shown in market details. Options are context, not signals. No exchange reads, account connections, or order execution are performed by the browser.

## Signal files (`data` branch)

| Path | Content |
|---|---|
| `signals/latest.json` | newest rows for every perp on 4H and 1D: signal, unified 4H x 1D signal, regime, z-score, heat, exhaustion, ribbon, positioning, inputs status, data status; market-wide context |
| `signals/{4h,1d}/YYYY-MM-DD.csv` | one row per perp per closed bar |
| `signals/status.json`, `signals/state.pkl` | last computed bar per timeframe; decision and agent-filter state carried between bars |
| `candles/{UND}/{4h,1d,1w}.csv` | closed bars: Derive index OHLC, perp volume in contracts (0 when nothing traded) |

Every Derive perp is listed. `data_status` says how far Reflex's engine can read it: `ready`, `warming up` (fewer than ~500 bars, z-scores damped by the engine) or `not enough data` (fewer than 200 bars). `volume_status` is `thin` when fewer than 90% of the last 100 bars traded; the volume-based exhaustion flags are then off. Signals are computed 3 minutes after each close, once Derive has published the bar. Newest: `https://raw.githubusercontent.com/cianfru/derive_scan/data/signals/latest.json`.

## Options files (`data` branch)

| Path | Content |
|---|---|
| `{source}/{UND}/features/YYYY-MM-DD.csv` | `ts,feature,value`, every snapshot |
| `{source}/{UND}/expiries/YYYY-MM-DD.csv` | one row per live expiry per snapshot |
| `{source}/{UND}/chains/YYYY-MM-DD/HH.json.gz` | raw option chain and perp ticker, hourly |
| `{source}/{UND}/latest.json` | newest features and term structure |
| `runs/YYYY-MM-DD.csv`, `status.json` | every attempt with its real fetch time; last result per source and underlying |

Snapshots are labelled with their 15-minute slot (unix seconds, UTC). An external cron service starts the workflow every 5 minutes (GitHub's own schedule is kept as a backup) and it records only slots not yet recorded, so a late or skipped scheduled run is caught by the next one. Failures show in the repo's Actions tab. Newest data: `https://raw.githubusercontent.com/cianfru/derive_scan/data/v2_mainnet/BTC/latest.json`.

## What it records

Every 15 minutes, for each source (default `v2_mainnet`) and underlying (default BTC, ETH):

| Table | Rows per snapshot | Content |
|---|---|---|
| `features` | ~12 per underlying | index price; ATM IV at 7/30/90 days; 25-delta risk reversal and butterfly at 30 days; put/call OI ratio; option OI; perp funding (hourly and annualised), basis, OI |
| `expiry_slices` | one per live expiry | forward, ATM IV, 25-delta call/put IV, RR25, BF25, call/put OI |
| `chains` | hourly | gzip JSON of the raw option chain and perp ticker, for recomputing features later |

Feature definitions are fixed in `backend/derive/features.py` (docstring). No extrapolation: a value that cannot be bracketed by real quotes is left out.

Measured on 1 October 2026: one snapshot of BTC and ETH from V2 mainnet takes ~11 s and 28 public requests; a raw chain is ~42 KB gzipped per underlying. With the defaults that is ~2 MB a day, ~60 MB a month of chains, plus a few thousand small rows a day.

## Local API

- `GET /health`
- `GET /api/status`: sources, row counts, database size, bytes sent per route, last run per source and underlying, request counts
- `GET /api/surface/{underlying}?source=`: latest features and term structure (`stale` when the newest snapshot is overdue)
- `GET /api/features/{underlying}?feature=atm_iv_30d&from=&to=&source=`: time series (unix seconds; default last 30 days, at most 400)

JSON responses carry ETags: a repeat request with `If-None-Match` gets an empty 304. `/api/status` also shows the database size on disk (`db_bytes`) and bytes sent per route (`egress`).

## Run

```
cd backend
pip install -r requirements-dev.txt
python -m pytest
python record_once.py --out ../store   # record the current options slot into files, as the Action does
python signal_once.py --out ../store   # compute any due 4H/1D signals, as the Action does
python research/parity_report.py OUT.md   # one-off: Derive candles vs Reflex's candles, same code
python main.py                         # local API with its own recorder, http://localhost:8000
```

Settings: see `.env.example` (the Action uses the defaults). The API's recorder holds a file lock in `DATA_DIR`, so several workers never record twice.

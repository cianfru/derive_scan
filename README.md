# Torq

Repository `derive_scan`. App and landing page: `frontend/` (React + Vite), deployed on Vercel (project `torq`) from `main`; it reads the `site-data` branch built by `backend/publish_site.py`.

```
cd frontend && npm install && npm run dev      # app against the live site-data branch
```

Reflex's signals on Derive's perps, plus Derive's options volatility surface.

- Signals: Reflex's signal code (engines, synthesizer, decision pipeline, agent filters), copied unchanged into `backend/reflex` at a pinned Reflex commit, run on Derive's candles for every Derive perp after each 4H and daily close. Design: `docs/signal-port.md`. Check against Reflex: `docs/parity-report.md`.
- Options: Derive does not serve past volatility surfaces, so the recorder builds the history every 15 minutes.

Both run in one GitHub Action (`.github/workflows/record.yml`) that commits plain files to the `data` branch: no server, no cost on a public repo. The FastAPI app in `backend/` serves the options data from SQLite and is kept for local use; it is not deployed.

## Signal files (`data` branch)

| Path | Content |
|---|---|
| `signals/latest.json` | newest rows for every perp on 4H and 1D: signal, unified 4H x 1D signal, regime, z-score, heat, exhaustion, ribbon, positioning, inputs status, data status; market-wide context |
| `signals/{4h,1d}/YYYY-MM-DD.csv` | one row per perp per closed bar |
| `signals/status.json`, `signals/state.pkl` | last computed bar per timeframe; decision and agent-filter state carried between bars |
| `candles/{UND}/{4h,1d,1w}.csv` | closed bars: Derive index OHLC, perp volume in contracts (0 when nothing traded) |
| `candles/{UND}/{tf}.backfill.csv` | earlier bars from OKX spot, before Derive's first bar (price only); rows report `backfilled_bars` |

Every Derive perp is listed. `data_status` says how far Reflex's engine can read it: `ready`, `warming up` (fewer than ~500 bars, z-scores damped by the engine) or `not enough data` (fewer than 200 bars). `volume_status` is `thin` when fewer than 90% of the last 100 bars traded; the volume-based exhaustion flags are then off. Signals are computed 3 minutes after each close, once Derive has published the bar. Newest: `https://raw.githubusercontent.com/cianfru/derive_scan/data/signals/latest.json`.

## Trade flow files (`data` branch)

| Path | Content |
|---|---|
| `flow/large/YYYY-MM-DD.csv` | taker trades at or above $25k perp notional, $100k option notional or $2k option premium, with wallet |
| `flow/wallets/YYYY-MM-DD.csv` | one row per wallet per 15-minute run: trades, perp and option notional, premium bought and sold, realised PnL, fees |

| `flow/sides/YYYY-MM-DD.csv` | per run, coin and kind (call, put, perp): taker buying and selling, market makers left out once classed |

## Options traders' history (`data` branch)

Every option and perp trade on Derive V2 since December 2023, one finished UTC day at a time (`history_once.py`, part 1 of `docs/options-traders-study.md`). Raw legs are not kept; they can be read again from Derive.

| Path | Content |
|---|---|
| `history/days/YYYY-MM-DD.csv.gz` | per wallet and instrument for the day: contracts and value bought and sold, maker and taker legs, delta added in USD (Black-76 at each trade's implied volatility), implied volatility, out-of-the-money premium sold, realised PnL, fees |
| `history/settlements/{UND}.json` | option settlement price per expiry |
| `history/wallets.json` | each wallet's class from all days so far: market maker, income, hedger, directional, skilled, occasional |
| `history/state.json` | last day done |

## Options files (`data` branch)

Every coin with options on Derive (`universe.json`). BTC and ETH in full detail; the others with expiry rows hourly and raw chains daily.

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
python history_once.py --out ../store  # extend the options traders' history (150 s budget), as the Action does
python research/parity_report.py OUT.md   # one-off: Derive candles vs Reflex's candles, same code
python main.py                         # local API with its own recorder, http://localhost:8000
```

Settings: see `.env.example` (the Action uses the defaults). The API's recorder holds a file lock in `DATA_DIR`, so several workers never record twice.

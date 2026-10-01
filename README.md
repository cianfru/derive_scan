# Derive Scan

Records Derive's options volatility surface and perp data. Derive does not serve past surfaces, so the recorder is how the history gets built.

Recording runs as a scheduled GitHub Action (`.github/workflows/record.yml`) that commits plain files to the `data` branch: no server, no cost on a public repo. The FastAPI app in `backend/` serves the same data from SQLite and is kept for local use; it is not deployed.

## Recorded files (`data` branch)

| Path | Content |
|---|---|
| `{source}/{UND}/features/YYYY-MM-DD.csv` | `ts,feature,value`, every snapshot |
| `{source}/{UND}/expiries/YYYY-MM-DD.csv` | one row per live expiry per snapshot |
| `{source}/{UND}/chains/YYYY-MM-DD/HH.json.gz` | raw option chain and perp ticker, hourly |
| `{source}/{UND}/latest.json` | newest features and term structure |
| `runs/YYYY-MM-DD.csv`, `status.json` | every attempt with its real fetch time; last result per source and underlying |

Snapshots are labelled with their 15-minute slot (unix seconds, UTC). The workflow fires every 5 minutes and records only slots not yet recorded, so a late or skipped scheduled run is caught by the next one. Failures show in the repo's Actions tab. Newest data: `https://raw.githubusercontent.com/cianfru/derive_scan/data/v2_mainnet/BTC/latest.json`.

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
python record_once.py --out ../store   # record the current slot into files, as the Action does
python main.py                         # local API with its own recorder, http://localhost:8000
```

Settings: see `.env.example` (the Action uses the defaults). The API's recorder holds a file lock in `DATA_DIR`, so several workers never record twice.

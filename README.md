# Derive Scan

Records Derive's options volatility surface and perp data, and serves it read-only. Derive does not serve past surfaces, so the recorder is how the history gets built.

## What it records

Every 15 minutes, for each source (default `v2_mainnet`) and underlying (default BTC, ETH):

| Table | Rows per snapshot | Content |
|---|---|---|
| `features` | ~12 per underlying | index price; ATM IV at 7/30/90 days; 25-delta risk reversal and butterfly at 30 days; put/call OI ratio; option OI; perp funding (hourly and annualised), basis, OI |
| `expiry_slices` | one per live expiry | forward, ATM IV, 25-delta call/put IV, RR25, BF25, call/put OI |
| `chains` | hourly | gzip JSON of the raw option chain and perp ticker, for recomputing features later |

Feature definitions are fixed in `backend/derive/features.py` (docstring). No extrapolation: a value that cannot be bracketed by real quotes is left out.

Measured on 1 October 2026: one snapshot of BTC and ETH from V2 mainnet takes ~11 s and 28 public requests; a raw chain is ~42 KB gzipped per underlying. With the defaults that is ~2 MB a day, ~60 MB a month of chains, plus a few thousand small rows a day.

## API

- `GET /health`
- `GET /api/status`: sources, row counts, last run per source and underlying, request counts
- `GET /api/surface/{underlying}?source=`: latest features and term structure
- `GET /api/features/{underlying}?feature=atm_iv_30d&from=&to=&source=`: time series (unix seconds; default last 30 days)

## Run

```
cd backend
pip install -r requirements-dev.txt
python -m pytest
python main.py           # http://localhost:8000
```

Settings: see `.env.example`. The recorder holds a file lock in `DATA_DIR`, so several workers never record twice. On Railway, mount a volume at `/app/data`.

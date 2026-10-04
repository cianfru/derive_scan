# Cowboy

Trader intelligence on Derive. Repository `derive_scan` (internal name, kept). App and landing page: `frontend/` (React + Vite), deployed on Vercel (project `torq`, internal name kept) from `main`; it reads the `site-data` branch built by `backend/publish_site.py`.

```
cd frontend && npm install && npm run dev      # app against the live site-data branch
```

Reflex's signals on Derive's perps, plus Derive's options volatility surface.

- Signals: Reflex's signal code (engines, synthesizer, decision pipeline, agent filters), copied unchanged into `backend/reflex` at a pinned Reflex commit, run on Derive's candles for every Derive perp after each 4H and daily close. Design: `docs/signal-port.md`. Check against Reflex: `docs/parity-report.md`.
- Options: Derive does not serve past volatility surfaces, so the recorder builds the history every 15 minutes. Daily readings before recording began are rebuilt from traded options, a separate measurement that is labelled as such and never joined to the recorded quotes.

Both run in one GitHub Action (`.github/workflows/record.yml`) that commits plain files to the `data` branch: no server, no cost on a public repo. The FastAPI app in `backend/` serves the options data from SQLite and is kept for local use; it is not deployed.

## Signal files (`data` branch)

| Path | Content |
|---|---|
| `signals/latest.json` | newest rows for every perp on 4H and 1D: signal, unified 4H x 1D signal, regime, z-score, heat, exhaustion, ribbon, positioning, inputs status, data status; market-wide context |
| `signals/{4h,1d}/YYYY-MM-DD.csv` | one row per perp per closed bar |
| `signals/status.json`, `signals/state.pkl` | last computed bar per timeframe; decision and agent-filter state carried between bars |
| `metric_history/{UND}/{4h,1d}.json` | cached historical price metrics, reconstructed from completed candles; original recorded decisions take precedence |
| `candles/{UND}/{4h,1d,1w}.csv` | closed bars: Derive index OHLC, perp volume in contracts (0 when nothing traded) |
| `candles/{UND}/{tf}.backfill.csv` | earlier bars from OKX spot, before Derive's first bar (price only); rows report `backfilled_bars` |

Every Derive perp is listed. `data_status` says how far Reflex's engine can read it: `ready`, `warming up` (fewer than ~500 bars, z-scores damped by the engine) or `not enough data` (fewer than 200 bars). `volume_status` is `thin` when fewer than 90% of the last 100 bars traded; the volume-based exhaustion flags are then off. Signals are computed 3 minutes after each close, once Derive has published the bar. Newest: `https://raw.githubusercontent.com/cianfru/derive_scan/data/signals/latest.json`.

## Trade flow files (`data` branch)

| Path | Content |
|---|---|
| `flow/large/YYYY-MM-DD.csv` | taker trades at or above $25k perp notional, $100k option notional or $2k option premium, with wallet |
| `flow/wallets_v2/YYYY-MM-DD.csv` | one row per wallet and trade-time bucket: trades, perp and option notional, premium bought and sold, realised PnL, fees |
| `flow/sides_v2/YYYY-MM-DD.csv` | per trade-time bucket, coin and kind (call, put, perp): taker buying and selling, market makers left out once classed |
| `flow/coverage_v2/YYYY-MM-DD.csv`, `flow/recovery.json` | successfully queried intervals, query provenance and progress recovering missing recent history |

Flow runs independently of options snapshots. A failed read remains due even when the current options slot succeeded. Missing complete 15-minute buckets in the trailing seven days are replayed from public trades, newest first, under a time budget. Full-bucket replacement and a write-ahead transaction make retries safe; coverage advances only after all pages and files are complete.

## App data files (`site-data` branch)

Built by `backend/publish_site.py` from the `data` branch after every recording run, then force-pushed as a single commit (no history). The app reads only these files, one request per screen.

| Path | Content |
|---|---|
| `markets.json` | every perp: price, changes, signals, regime, heat, z-score, ribbon, funding, OI, data status, options summary, alignment, sparklines; market-wide context and consensus per timeframe; `breadth_1d`: the daily regime mix, `{cols, rows: [[close, perps per regime...]]}` with columns MARKUP, BLOWOFF, REACC, ACCUM, CAP, MARKDOWN, FLAT, over the 120-day engine history |
| `coins/{UND}.json` | candles (4H, 1D) with signal history and the newest rows; `ribbon["1d"]`: one character per daily candle (`g` gold, `b` blue, `n` grey, `-` warm-up or no reading); `engine_context`: consensus per timeframe, BTC's regime, Fear & Greed, stablecoin 7-day change, with observation times; `history.engine` (recorded and reconstructed price metrics) and `history.coverage` (engine, option recording and wallet history; option rows are not published); options detail, with `options.iv_history`: 14 days of 15-minute readings `[ts, atm_iv_7d, atm_iv_30d, atm_iv_90d, rr25_30d, bf25_30d, pc_oi_ratio, rr25_7d]` at 6 decimals (so a coin file stops growing after 14 days of recording); alignment by horizon; taker flow |
| `wallets/{UND}.json` | the ranked traders holding the coin's options and how each cohort is positioned on it |
| `traders.json`, `traders/{address}.json` | options traders' leaderboard and cohorts (market makers left out); one file per ranked trader |
| `flow.json` | last 24 hours: large trades and the most active wallets |
| `strikes/{UND}.json` | per-strike view of the newest chain (written by `record_once.py`) |
| `surface/{UND}.json` | daily option readings rebuilt from traded options, version 1: `{und, version, generated_at, status: ready\|sparse, first_trade_day, day0, days, index[], traded{atm7, atm30, atm90, rr7, rr30}, recorded{from, ...}, quality{metric: {coverage, reliability, shown}}, range_1y{metric: {p10, p50, p90, last, pct}}, overlap{metric: {days, median_diff}}}`. Value `i` of each array is the UTC day `day0 + i * 86400`; null is a gap. `traded` holds a 5-day median and only the readings that pass the gates (below); `recorded` holds, for the same readings, the daily medians of the recorded 15-minute snapshots (days with at least 72 of 96) from offset `from`, as a separate series; `pct` is the newest value's percentile rank (0-100) within the past year of `traded`. Written for every coin with a `history/surface` file; `markets.json` and `coins/{UND}.json` carry `has_surface` (true when at least one reading is shown); a coin without it needs no request |
| `radar.json` | version 1, read by the Radar page only: `{version, generated_at, through, cohort: "smart", closes: [30 daily close times], coins: {UND: {z: [...], w: {"7d": [[score, gross, flags] \| null], "30d": [...]}, e: "--uu"}}}` for every coin with options, one value per close, the newest close being the newest in `history/balance.json`. `z` is the engine's daily z-score from the same rows as `coins/{UND}.json` `history.engine["1d"]`, null unless ready; `w` is the Smart balance at that close (flags as in `history/balance.json`), null for a gap or below the live gates (complete quotes, gross at least $10k, at least 3 positions); `e` is one character per close for the engine's reading saved there, by the live rule (saved as ready, perp volume ok): `u` up, `d` defensive, `n` neutral, `-` none (replayed closes carry no final signal). Not written until `history/balance.json` exists |

## Questions (stage 1, off by default)

Plain yes/no price questions built from Derive option spreads (`docs/questions-design.md`), computed in the record step from the tickers it already holds (`backend/derive/questions.py`, `derive/question_job.py`). The only added exchange read is one `public/get_option_settlement_prices` call per coin after an expiry it holds questions on (merged into `history/settlements/{UND}.json`). BTC and ETH use G = 5c (all-in over the clipped mark at $1,000 of payout, worse side) and S = $50 (top-of-book payout, smaller side); every other coin uses G = 8c and S = $25, takes the narrowest zone (from 6.5% of the index, up to 25%) whose headline passes at first sight, and is marked thin. All thresholds live in `QUESTION_GATES`. `python questions_sweep.py --data DIR` replays the rule and the gates over kept chains.

The `data` branch always keeps (a few KB, plus about 300 KB a day of hourly CSV before compression):

| Path | Content |
|---|---|
| `questions/state.json` | schema 1: per coin, each date's frozen `zone` (set once, at most one change toward the minimum while over 7 days out), `headline` with its two-slot hold, the last hourly gate checks, `shown`, the published ids `{id: [lo, hi]}` and `retired` ids; each coin's instrument `spec` (tick, minimum, amount step, taker rate, base fee, cap); `settle_try` per coin |
| `questions/history/{UND}/{YYYYMMDD}.csv` | hourly, one row per published question of that date: `ts,id,fair,yes_buy,yes_sell,no_buy,no_sell,index` (per $1) |

The app files exist only when the Action runs with `QUESTIONS_PUBLISH=on` (`record.yml`, `"off"` today); while it is off `publish_site.py` removes any `questions/` folder, and the app shows Questions only in a build with `VITE_QUESTIONS=1` (routes, the Saloon leading the nav with the research pages after it, the landing's "Enter the Saloon" button and the coin page's Saloon card). `VITE_DERIVE_REFERRAL` adds a referral code from Derive's API Broker programme to the ticket's "Open Derive" link (`VITE_DERIVE_REFERRAL_PARAM`, default `ref`; `VITE_DERIVE_OPTIONS_URL` for the page).

| Path (`site-data`) | Content |
|---|---|
| `questions/index.json` | `{schema, prices_ts, generated_at, paused?, coins: [{und, thin, index, questions, dates}]}`: coins with at least one live answer, BTC and ETH first |
| `questions/{UND}.json` | `{schema, und, prices_ts, index, thin, spec, paused?, dates: [{expiry, settle_ts, label, days, board, zone, zone_set_ts, headline, checks, levels: [{id, k, lo, hi, fair, state, ladder, yes, no}]}], settled: [{expiry, settle_ts, label, zone, settle_price, levels: [{id, k, lo, hi, paid}]}]}`. `id` is `{UND}-{YYYYMMDD}-A-{lo}-{hi}` (strikes as Derive writes them); `state` open, tail (Yes outside 3c-97c), retired, settling (from 07:30 UTC); `ladder` 7 or 15 for the levels shown, 0 for an id kept only for holders; each side is `{state: open\|screen_wide\|no_quote\|settling, buy, sell, size, form: debit\|credit, legs: [[name, buy\|sell, limit]], close: [[name, buy\|sell, limit]]}`, per $1 except the per-contract limits; `board` false keeps a date (under a day, or lapsed) for holders only. Settled dates stay 24 hours |
| `questions/history/{UND}-{YYYYMMDD}.json` | one date's hourly prices: `{schema, und, expiry, settle_ts, zone, ids, retired, ts[], index[], rows: {id: {i[], fair[], yb[], ys[], nb[], ns[]}}, settle_price, paid}`; settled dates keep four points a day for 90 days |

`prices_ts` is the 15-minute slot start. Prices over 35 minutes old show their age; over 90 minutes `publish_site.py` marks the files `paused` and the app shows em dashes.

## Tracking values over time

Coin pages include **Market history**: dated engine metrics, funding and open interest. Inspect exact samples by pointer, touch or keyboard; select daily or four-hour readings. Missing intervals remain gaps. Details: `docs/history-tracking.md`.

Historical price metrics cover up to 120 daily closes and 30 days of four-hour closes. They use the same engines on completed cached candles, with warmup and source provenance retained. Reconstructed metrics use dashed lines; final trading decisions are shown only where originally recorded. Option measurements stay in the `data` branch's feature files; the coin file carries their recording coverage and 14 days of IV history for the options panel. Derive provides no past surfaces, so missing snapshots and the surfaces of dates before recording began cannot be recovered. Daily readings rebuilt from the options traded on those dates (`surface/{UND}.json`) are a separate measurement: labelled as rebuilt from traded options, published as their own series beside the recorded quotes and never used to fill a recorded gap. The coin page's Options step reads that file only when `has_surface` is true: a strip under each of its three figures (thin line rebuilt from traded options, thick line recorded, dot the newest snapshot) and the IV history tab (3M, 1Y, All); other coins keep the snapshot view. Wallet trade reconstruction and option-surface recording have separate coverage dates.

Readings rebuilt from traded options are published per reading only while it passes three gates, recomputed on every run: a reading on at least 70% of the trailing 180 days, a corrected split-half reliability of at least 0.85 (the same fit on two halves of the instruments), and, once recorded and traded readings overlap on 14 days or more, a median difference of at most 3 volatility points (ATM) or 2 (risk reversal). No level offset is applied. On 3 October 2026 BTC (from 21 September 2024) and ETH (from 3 February 2024) passed for all five readings, HYPE (from 7 February 2026) for ATM 7, 30 and 90 days and the 30-day risk reversal; the other coins trade too few options. Method and validation: `docs/history-tracking.md`.

## Options traders' history (`data` branch)

Every option and perp trade on Derive V2 since December 2023, one finished UTC day at a time (`history_once.py`, part 1 of `docs/options-traders-study.md`). Raw legs are not kept; they can be read again from Derive.

| Path | Content |
|---|---|
| `history/days/YYYY-MM-DD.csv.gz` | per wallet and instrument for the day: contracts and value bought and sold, maker and taker legs, delta added in USD (Black-76 at each trade's implied volatility), implied volatility, out-of-the-money premium sold, realised PnL, fees |
| `history/settlements/{UND}.json` | option settlement price per expiry |
| `history/wallets.json` | each wallet's class from all days so far (market maker, income, hedger, directional, occasional) and, for profitable directional wallets, its tier (top, smart, profitable) |
| `history/positions.json` | open option contracts per instrument held by each tier's wallets |
| `history/traders.json` | leaderboard (best 200 by options PnL, market makers left out), each one's open options and last 45 days, cohorts by results and by size with their open options |
| `history/surface/{UND}.csv` | one row per finished UTC day for each coin with options (traded or recorded that day), appended once and never rewritten (`derive/surface_history.py`): `day, index, index_src, carry_day, carry_pairs, carry, points, contracts, atm7, atm30, atm90, rr7, rr30, n7, n30, n90`, the same five readings from two halves of the instruments (`*_a`, `*_b`, by crc32 of the instrument name), and `rec_atm7 ... rec_rr30, rec_n`: the median of that day's recorded snapshots, null unless at least 72 of 96 were recorded |
| `history/balance.json` | the Smart wallets' option delta balance per coin at every daily close (`derive/balance_history.py`), schema 1: `{schema, through, closes: {close_ts: {UND: {"7d": [score, net, gross, positions, flags], "30d": [...]}}}, expiry_gross}`. `close_ts` is the daily bar's close (00:00 UTC after the day); score is net over gross USD delta, null below the live gates (gross at least $10k, at least 3 positions) or when a delta was missing or estimated; net and gross are null when a quote was missing; flags bit 0 = roll (at least 25% of the window's gross left or entered by expiry since the previous close), bit 1 = modelled (no chain recorded at that close). A coin or horizon without a Smart position is left out. `expiry_gross` holds the two newest closes' gross per expiry, for the next close's roll. About 0.5 KB a close |
| `history/state.json` | last day done; `surface` (definition version of `history/surface`), `surface_through` (newest day in it) and, while a new version is rebuilt into `history/surface_rebuild/`, `surface_pending`; `balance` (definition version of `history/balance.json` once its backfill is done; removed when a catch-up skipped a close, so the backfill runs again) |

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
python flow_once.py --out ../store     # collect flow and recover missing recent buckets independently
python history_once.py --out ../store  # extend the options traders' history (150 s budget), as the Action does
python research/parity_report.py OUT.md   # one-off: Derive candles vs Reflex's candles, same code
python main.py                         # local API with its own recorder, http://localhost:8000
```

Settings: see `.env.example` (the Action uses the defaults). The API's recorder holds a file lock in `DATA_DIR`, so several workers never record twice.

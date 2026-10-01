# Reflex signals on Derive: port design

Status: draft for the owner's approval, 1 October 2026. No code until approved.

## Goal

Reproduce Reflex's signals on Derive, computed independently of Reflex. The signals come from price candles and are venue-agnostic, so the same code runs on Derive's data. The options layer is added afterwards, only through the declared study (see "Not in this step").

## What gets ported

Copied from `cianfru/RCCE_Scanner` at commit `e45ed97d91fa1cca58533144233dc807a63f4e8f` (1 October 2026), into `backend/signals/`, with that commit named in each file header. Copied, not imported: Derive Scan never calls Reflex or depends on its servers, and the Reflex repo is not changed.

| Reflex file | What it does | Input |
|---|---|---|
| `engines/rcce_engine.py` | regime, z-score, energy, volatility state, raw signal; beta to BTC and ETH | 4H or 1D candles, plus BTC and ETH candles |
| `engines/heatmap_engine.py` | structural heat and phase | the timeframe's candles plus weekly |
| `engines/exhaustion_engine.py` | exhaustion state, climax, absorption, floor confirmation | candles with volume, plus weekly |
| `scanner.py`: `compute_consensus`, the per-symbol merge | market-wide consensus across the scanned coins | every coin's regime |
| `signal_synthesizer.py` | final signal (STRONG_LONG ... TRIM), reasons, warnings | all of the above plus optional context |
| `decision_pipeline.py`, `confluence.py` | input freshness, 4H x 1D confluence, final constraints | the synthesized rows |

Timeframes: 4H and 1D, as in Reflex. Only closed candles are used, as in Reflex (`closed_candles`).

Left out:
- Hyperliquid-specific: HyperLens smart-money consensus (`has_hyperlens=False`), wallet tracking, Hyperliquid candle and market feeds, `k` markets.
- The Larsson engine and its paid data.
- CoinGlass inputs (paid key): ETF flows, Coinbase premium (`has_coinglass=False`, as Reflex runs without the key).
- The executor and everything after the signal (trading is a separate, approved step).
- CTO, levels, patterns, SMC and spike-zone engines: not part of the signal itself. Can follow later if wanted.

## Data from Derive (checked 1 October 2026 on V2 mainnet)

| Need | Derive method | Notes |
|---|---|---|
| Price candles (OHLC) | `public/get_index_chart_data` (currency, period in seconds, start/end) | The spot index Derive marks and settles against. No volume. Each call is clamped to a maximum number of buckets (per the docs), so long histories are fetched in pages. |
| Volume | `public/get_tradingview_chart_data` (instrument, period, start/end) | Traded perp candles with USD volume. |
| Funding, open interest | `public/get_tickers` (perp), `public/get_funding_rate_history` | Feeds the synthesizer's positioning input. |

Index history and perp volume per coin (daily index bars; share of 4H perp bars with no trades over the last 400 days):

| Coin | Daily index bars | 4H bars with no trades | 24h perp volume |
|---|---|---|---|
| BTC | 1,031 | under 1% | ~$13M |
| ETH | 1,031 | 0% | ~$33M |
| SOL | 885 | 9% | ~$0.7M |
| HYPE | 394 | 18% | ~$5M |
| ZEC, XAUT, CC | 120 | 80-90% | about $0.5M or less |
| LIT | 18 | 99% | small |

Other V2 perps: LINK, ADA, DOGE, XRP, BNB, PUMP, VVV, all with little trading. The RCCE engine prefers 300 bars (a 200-bar fallback exists with dampening); weekly inputs use up to 199 bars.

## Inputs that do not come from Derive

| Synthesizer input | Plan |
|---|---|
| Market consensus | Computed over the Derive universe. Reflex computes it over 200+ coins, so this is a known difference. |
| Fear & Greed | alternative.me, free (Reflex's own fallback source). |
| Stablecoin supply | DefiLlama, free (Reflex's source). |
| BTC dominance / global metrics | CoinGecko public endpoint, free (Reflex's source). |
| CVD, long/short ratio, liquidations | Neutral defaults, as Reflex does when they are missing. |

Each is fetched once per run by the scheduled job; users never trigger reads.

## Parity checks

1. Code parity (automated, part of the tests): Reflex's engines at the pinned commit and the port, given the same candle fixtures, return identical outputs. Fixtures are saved candle arrays, so the test runs offline.
2. Data parity (one-off report, before anything is shown as "Reflex's signals"): for BTC and ETH over the last year, regime and signal on Derive's candles against the candles Reflex uses, bar by bar (a one-off offline read for this report, not a feed in the product). Expected sources of difference: index price vs traded perp price, volume source, consensus universe, missing CoinGlass and HyperLens inputs. The report states the agreement rate; it is a check of the port, not a performance claim.

## Where it runs

Inside the existing recorder job (GitHub Actions, triggered every 5 minutes), at no added cost:
- after each 4H close and each daily close, fetch the new candles, run the engines for every coin, and commit `signals/{4h,1d}/YYYY-MM-DD.csv` (one row per coin per closed bar) and `signals/latest.json` to the `data` branch;
- candles are cached on the `data` branch, so each run fetches only the newest bars.

## Keeping in step with Reflex

The port stays pinned. Updating to a newer Reflex commit is a deliberate step the owner asks for: diff the pinned files against Reflex, re-run the parity tests, note the new commit. Never automatic.

## Words on screen

Reflex's signal labels are kept. Reflex also produces an `expected_range` ("calibrated next-bar range forecast"): on this product it is not shown, or is shown only as the past realised range, per the no-forecast-words rule. Larsson never appears.

## Not in this step

- Options features in the signal: only after the declared study (rules committed first, after 4-6 weeks of recording) shows they add something; until then options data is shown beside the signals as context.
- Trading on Derive perps: testnet and dry-run first, only with the owner's explicit approval.

## Decisions for the owner

1. Volume source. Recommended: Derive's own perp volume. It is full for BTC and ETH and mostly present for SOL and HYPE; for the thinly traded coins the volume-based exhaustion flags (climax, absorption, floor confirmation) are marked unavailable rather than computed on empty bars. Alternative: volume from a large exchange's public candles, closer to Reflex but not Derive's data.
2. Universe. Recommended: signals for every Derive perp with enough index history (BTC, ETH, SOL, HYPE now; the 120-day coins on 4H only, with their warm-up noted); trading, when approved, limited to the liquid perps (BTC, ETH, then HYPE and SOL).
3. Market-wide inputs (Fear & Greed, stablecoin supply, BTC dominance). Recommended: include them, from the same free sources Reflex uses, so the synthesizer sees what it sees in Reflex.

## Build steps (one pull request each)

1. Port the engines, consensus, synthesizer and decision code; code-parity tests on saved fixtures.
2. Derive candle and context fetch, the signal step in the scheduled job, files on the `data` branch.
3. Data-parity report for BTC and ETH.
4. Frontend (owner's design guidelines first): signals plus the options screens.

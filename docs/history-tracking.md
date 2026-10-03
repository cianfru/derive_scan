# Historical tracking and collection recovery

Torq's coin pages expose dated measurements so a trader can compare the current reading with its own history. Engine metrics, option measurements and wallet reconstruction have different source coverage.

## What the October 3 audit found

- Wallet history contained 1,037 completed daily files, from December 1, 2023 through October 2, 2026. Its derived snapshots were current and on schema 2.
- Original daily and four-hour engine decisions were saved only from October 1. Older price candles existed but their price metrics were not published as a usable history.
- BTC and ETH option feature recording began October 1 at 12:45 UTC. The audit found missed snapshot slots during the transition to scheduled recording. Most other option markets began October 2 at 08:00 UTC.
- The current flow coverage format began October 2. It could catch up after its watermark but did not replay earlier missing intervals. Flow also ran inside options recording: if options succeeded and flow failed, the next run could skip flow because the options slot was already complete.

The trade-history API can recover missing trades. It cannot recover past option surfaces. Daily readings rebuilt from the options traded on past dates are a separate measurement, described below; they do not recover a surface and never fill a recorded gap. A recent listing may also lack the price history required for engine normalisation.

## Publication and inspection

`coins/{UND}.json` includes `history.engine` and `history.coverage`. The Market history panel provides numerical charts, source labels, exact UTC dates, period selection, regime/decision context and collection coverage. Missing values and absent intervals break the plotted line. Option rows (`history.options`) were published until 3 October 2026; the app never read them and over 90 days they would reach about 4 MB per coin, so only their coverage is published now (`history.coverage.options`).

The publisher uses the existing pure price engines to reconstruct up to 120 daily closes and 180 four-hour closes from cached candles. Each historical evaluation sees only completed candles up to that close, including weekly and BTC/ETH inputs. External backfill stays price-only. Metrics with insufficient normalisation or failed engine inputs remain unavailable. Saved observations take precedence, with one exception. When a close was saved while not ready (too little history at the time, such as HYPE, XAUT and ZEC on 1 and 2 October, before their history was extended) and the replay of the same close is ready, the replay supplies that close's price metrics only: regime, z-score, heat with its phase, and ribbon. The row lists the copied keys in `filled_from_replay` and the coverage counts such rows (`filled_from_replay_count`). The saved signal, funding, OI and option fields are never replaced, and neither is any value the saved row holds. The replay never creates historical final signals, funding, OI, option prices or wallet decisions, and never changes the live decision state.

`markets.json` `breadth_1d` counts, at each daily close of the same window, how many perps were in each regime: recorded where the close was saved as ready, replayed before that, and filled closes included. Its newest row equals the published daily consensus counts.

The replay cache is bounded and invalidated by code and causal input changes. A full 15-market rebuild took about 40–55 seconds in verification; subsequent cached publication took about 1.5 seconds. The existing signal CSV schema is extended with OI, the positioning observation time, heat validity and ribbon quality. Ambiguous legacy zero heat and ribbon states remain unknown unless an exact matching original snapshot establishes their validity. Older rows retain unknown fields rather than guessed values.

Option measurement coverage is computed from saved feature rows for the latest 90 days: the original recording start, the expected and missing slot counts, and the newest slot, separately from the publication time. Dollar perp OI is derived only when contracts, index and basis are known; the mark is `index * (1 + basis)`.

## Option readings rebuilt from traded options

Derive kept no quote history before recording began on 1 October 2026. The options traded on each past day are in the rebuilt trade history (`history/days`), with the implied volatility of each trade's price, so a daily reading can be fitted to them. It is its own measurement: published as `traded`, labelled as rebuilt from traded options, never joined to the recorded quotes (`recorded`, from 1 October 2026) and never used to fill a recorded gap.

Storage and publication: `history_once.py` appends one row per coin with options and finished UTC day to `history/surface/{UND}.csv` (append-only; rows are never rewritten). A change of definition takes a new `SURFACE_VERSION`, which rebuilds every row into `history/surface_rebuild/` within the job's time budget, over as many runs as needed, and swaps it in when complete. `publish_site.py` turns each file into `surface/{UND}.json` on every run. No network call is involved.

### Method (`backend/derive/surface_history.py`)

- Index per day: the perp trades of wallets that traded one side only that day, |delta in USD| over contracts (the index at each trade, contract-weighted); the daily candle's (high + low + close) / 3 when there is none. Against the candles' typical price the median gap is 0.28% for BTC and 0.47% for ETH.
- Convention: the history's implied volatility is Black-76 on the index without discounting. Derive prices on a forward above the index (forward times discount is about the index). On 1-2 October that read BTC's 30-day calls about 1.5 volatility points too high and puts about 1.1 too low against Derive's marks, which alone would raise the 25-delta risk reversal by about 2.6 points. Each price is therefore inverted again with forward S·e^(cT) and discount e^(-cT).
- Carry c, measured in the data: in Derive's convention a call and a put at one strike share one implied volatility, so each same-day call/put pair at one strike (7-200 days, within one standard deviation of the index) gives c = (IV call − IV put) · vega / (K · T). Each day keeps the median of its pairs; the carry used is the median over that day and the 14 fitted days before it. It matches the known futures basis: BTC 22% a year in March 2024, 14-17% in November-December 2024, 1-5% through 2026 and 5.2-5.3% on 1-2 October 2026, when Derive's own chain forwards gave 5.2-5.6%; ETH 4.7-4.8% against 3.6-4.5% in the chains. A carry error of 1% a year moves the risk reversal by about 0.44 points.
- Fit, per day and tenor X of 7, 30 and 90 days: out-of-the-money trades with tenor between X/2 and 2X and |delta| ≥ 0.05; IV = a + b·x + c·x² [+ d·ln(T/X)], x the standardised moneyness, weights √contracts, one robust pass. ATM is a; the 25-delta risk reversal is read from the fit at the 25-delta call and put points.
- No extrapolation: a reading exists only when trades sit on both sides of the money and of the tenor (or one within 25% of it).
- Display: a 5-day median, centred where later days exist and needing at least 3 daily values, starting on the first day the trailing 30 days are half covered. The newest two days are revised as later days arrive, since their window is still one-sided.
- Halves: the same fits on two halves of the instruments (crc32 of the instrument name) feed the reliability gate.
- Recorded: the median of the day's recorded 15-minute snapshots, kept only for days with at least 72 of 96.

### Validation (research, 3 October 2026, on 1,037 days and 687,617 option rows)

Recorded quotes against traded readings on the only overlap days (1 October partial with 17 snapshots, 2 October full), volatility points:

| Reading | BTC 1 Oct | BTC 2 Oct | ETH 1 Oct | ETH 2 Oct |
|---|---|---|---|---|
| ATM 30d | 33.4 vs 34.7 | 33.1 vs 33.9 | 46.8 vs 48.8 | 46.6 vs 47.7 |
| ATM 7d | 29.4 vs 32.8 | 29.6 vs 30.7 | 39.1 vs 42.5 | 39.3 vs 39.6 |
| ATM 90d | 36.1 vs 37.1 | 35.9 vs 37.0 | 51.0 vs 53.5 | 50.7 vs 51.7 |
| RR 30d | −1.15 vs −2.42 | −0.80 vs −0.36 | −0.23 vs −1.79 | −0.01 vs −0.88 |

- HYPE on 2 October (64 snapshots): ATM 30d 59.5 recorded, 59.2 traded.
- Instrument by instrument (traded against mark IV, same convention, 1-2 October): correlation 0.765 for BTC (273 instrument-days) and 0.885 for ETH (366); median gap at 21-45 days −0.2 to +1.5 points. Taker buys sit 0.8 points above the mark, taker sells 0.1 below.
- Level: traded readings run about 1 to 2 points above Derive's quotes at 30 days, up to 3.4 at 7 days and 1 to 2.5 at 90 days. No offset is applied; the publisher reports the difference (`overlap`) and hides a reading if, after 14 overlap days, it exceeds 3 points (ATM) or 2 (risk reversal).
- Long-range check against Deribit DVOL, a 30-day implied volatility index, used for this validation only (it is never fetched by any job, stored or published): BTC ATM 30d correlation 0.979 over 597 days, 0.846 on 5-day changes, mean −1.8 points; ETH 0.971 over 913 days, 0.869, −2.1. Derive's recorded ATM 30d sat 1.6 to 3.0 points below it on the overlap days, so the rebuilt series sits on a consistent level.
- Known episodes are reproduced (5-day medians, RR 30d in points): March 2024 rally BTC +7.3; 5 August 2024 crash BTC −3.5, ETH −3.4; 12 November 2024 rally BTC +4.5, ETH +4.6; 8 April 2025 tariff crash BTC −3.3, ETH −7.3 (ETH's curve inverted: 7 days 100.7 against 30 days 79.2); 6 February 2026 crash BTC −11.3, ETH −10.3.
- Noise of one full-sample reading (split-half, three random instrument splits), raw / 5-day median, in volatility points, against the series' own spread: BTC ATM 30d 0.47 / 0.41 (spread 8.3), RR 30d 0.80 / 0.46 (3.2), ATM 7d 0.82 / 0.78, ATM 90d 0.59 / 0.61, RR 7d 0.92 / 0.63; ETH ATM 30d 0.70 / 0.53 (8.0), RR 30d 1.01 / 0.67 (3.3), ATM 7d 1.37 / 1.32, ATM 90d 0.68 / 0.47, RR 7d 1.63 / 1.17. Raw daily risk reversals are noisy and are shown only smoothed.

### Gates and what passes

Recomputed by the publisher on every run, so a coin qualifies by itself once enough of its options trade: a reading on at least 70% of the trailing 180 days, corrected split-half reliability of at least 0.85, and the overlap limit above. On 3 October 2026 (production split):

| Coin | Shown from | Readings shown | Reliability ATM 7 / 30 / 90, RR 7 / 30 |
|---|---|---|---|
| BTC | 21 September 2024 (742 days) | all five | 0.986 / 0.994 / 0.974, 0.963 / 0.975 |
| ETH | 3 February 2024 (973 days) | all five | 0.971 / 0.990 / 0.975, 0.923 / 0.904 |
| HYPE | 7 February 2026 (238 days) | ATM 7, 30, 90 and RR 30 | 0.979 / 0.980 / 0.989, 0.321 / 0.872 |

ZEC, SOL, XRP and XAUT trade options on too few days (30-day coverage over the last 180 days 2% to 26%); ADA, LIT, PUMP and VVV almost never. Their files are `sparse` and `has_surface` is false. Early BTC (December 2023 to September 2024) is too sparse and falls before the start rule.

Where the newest readings sat within their own past year on 2 October 2026: BTC ATM 30d 34.1 (5th percentile), RR 30d −1.0 (89th); ETH ATM 30d 48.4 (11th), RR 30d −1.1 (86th).

### Limits

- A traded reading reflects when trading happened (busy, volatile hours weigh more) and the spread paid; it is not a time-averaged quote.
- Large single trades can dominate a thin day; √contracts weights and the 5-day median limit that.
- The job reads Derive V2's trade history; a V3 trade schema would need an adapter.

### Runtime and size

A full rebuild of all 1,037 day files took 31-33 seconds locally; with a 10-second budget it finished in four runs with byte-identical files. One new day takes well under a second. `surface/BTC.json` is 32 KB (8.6 KB gzipped), ETH 41.6 KB (11.7 KB), HYPE 8.8 KB (2.9 KB), growing by about 45 bytes a day.

## Independent flow recovery

`flow_once.py --due` participates in the scheduled workflow independently of options, signals and wallet history. `flow_once.py --out DIR --budget 120 --max-intervals 8` collects live flow and replays uncovered complete buckets in the previous seven days. The newest gaps are prioritised so the 24-hour view recovers first.

Each historical query is bounded to at most six hours. All pages must finish, pagination counts must agree when supplied, and the time budget must hold before an interval is recorded as complete. Trades are deduplicated and reverted legs are excluded. A replay replaces complete buckets rather than adding to partial aggregates. The same market-maker rules and thresholds apply.

A write-ahead transaction retains final file contents. If a process stops while writing, the next invocation completes those writes before querying again. Source files precede the coverage marker and checkpoint. Historical replay cannot cause a later live query to certify an older unqueried gap. Coverage files retain source, query time and leg count. The publisher finishes any pending transaction before reading flow, and the workflow publishes app data only after its build and data commit succeed.

Verification against Derive recovered 115,250 historical trade legs across 25 intervals and filled all seven days of collection coverage in a scratch rebuild. Scheduled production recovery uses the same bounded code across successive runs. Tests cover gaps, pagination failures, timeouts, migration, overlap, interrupted writes, retries, recorded/reconstructed precedence and dated chart inspection. Engine code, wallet classifications, ranking definitions and the declared study are unchanged.

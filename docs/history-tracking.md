# Historical tracking and collection recovery

Torq's coin pages expose dated measurements so a trader can compare the current reading with its own history. Engine metrics, option measurements and wallet reconstruction have different source coverage.

## What the October 3 audit found

- Wallet history contained 1,037 completed daily files, from December 1, 2023 through October 2, 2026. Its derived snapshots were current and on schema 2.
- Original daily and four-hour engine decisions were saved only from October 1. Older price candles existed but their price metrics were not published as a usable history.
- BTC and ETH option feature recording began October 1 at 12:45 UTC. The audit found missed snapshot slots during the transition to scheduled recording. Most other option markets began October 2 at 08:00 UTC.
- The current flow coverage format began October 2. It could catch up after its watermark but did not replay earlier missing intervals. Flow also ran inside options recording: if options succeeded and flow failed, the next run could skip flow because the options slot was already complete.

The trade-history API can recover missing trades. It cannot recover past option surfaces. A recent listing may also lack the price history required for engine normalisation.

## Publication and inspection

`coins/{UND}.json` includes `history.engine` and `history.coverage`. The Market history panel provides numerical charts, source labels, exact UTC dates, period selection, regime/decision context and collection coverage. Missing values and absent intervals break the plotted line. Option rows (`history.options`) were published until 3 October 2026; the app never read them and over 90 days they would reach about 4 MB per coin, so only their coverage is published now (`history.coverage.options`).

The publisher uses the existing pure price engines to reconstruct up to 120 daily closes and 180 four-hour closes from cached candles. Each historical evaluation sees only completed candles up to that close, including weekly and BTC/ETH inputs. External backfill stays price-only. Metrics with insufficient normalisation or failed engine inputs remain unavailable. Saved observations take precedence, with one exception. When a close was saved while not ready (too little history at the time, such as HYPE, XAUT and ZEC on 1 and 2 October, before their history was extended) and the replay of the same close is ready, the replay supplies that close's price metrics only: regime, z-score, heat with its phase, and ribbon. The row lists the copied keys in `filled_from_replay` and the coverage counts such rows (`filled_from_replay_count`). The saved signal, funding, OI and option fields are never replaced, and neither is any value the saved row holds. The replay never creates historical final signals, funding, OI, option prices or wallet decisions, and never changes the live decision state.

`markets.json` `breadth_1d` counts, at each daily close of the same window, how many perps were in each regime: recorded where the close was saved as ready, replayed before that, and filled closes included. Its newest row equals the published daily consensus counts.

The replay cache is bounded and invalidated by code and causal input changes. A full 15-market rebuild took about 40–55 seconds in verification; subsequent cached publication took about 1.5 seconds. The existing signal CSV schema is extended with OI, the positioning observation time, heat validity and ribbon quality. Ambiguous legacy zero heat and ribbon states remain unknown unless an exact matching original snapshot establishes their validity. Older rows retain unknown fields rather than guessed values.

Option measurement coverage is computed from saved feature rows for the latest 90 days: the original recording start, the expected and missing slot counts, and the newest slot, separately from the publication time. Dollar perp OI is derived only when contracts, index and basis are known; the mark is `index * (1 + basis)`.

## Independent flow recovery

`flow_once.py --due` participates in the scheduled workflow independently of options, signals and wallet history. `flow_once.py --out DIR --budget 120 --max-intervals 8` collects live flow and replays uncovered complete buckets in the previous seven days. The newest gaps are prioritised so the 24-hour view recovers first.

Each historical query is bounded to at most six hours. All pages must finish, pagination counts must agree when supplied, and the time budget must hold before an interval is recorded as complete. Trades are deduplicated and reverted legs are excluded. A replay replaces complete buckets rather than adding to partial aggregates. The same market-maker rules and thresholds apply.

A write-ahead transaction retains final file contents. If a process stops while writing, the next invocation completes those writes before querying again. Source files precede the coverage marker and checkpoint. Historical replay cannot cause a later live query to certify an older unqueried gap. Coverage files retain source, query time and leg count. The publisher finishes any pending transaction before reading flow, and the workflow publishes app data only after its build and data commit succeed.

Verification against Derive recovered 115,250 historical trade legs across 25 intervals and filled all seven days of collection coverage in a scratch rebuild. Scheduled production recovery uses the same bounded code across successive runs. Tests cover gaps, pagination failures, timeouts, migration, overlap, interrupted writes, retries, recorded/reconstructed precedence and dated chart inspection. Engine code, wallet classifications, ranking definitions and the declared study are unchanged.

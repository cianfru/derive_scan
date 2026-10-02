# Reliability fixes, October 2026

This change preserves the approved study rules in `options-traders-study.md`: wallet classes,
thresholds, tiers, gross PnL ranking, data collection cadence and daily aggregate storage.
The engine, option prices and wallet positioning remain separate dimensions.

## History coverage and rollout

Derived wallet snapshots use schema version 2. On the next history run, existing daily files
are recalculated if their derived snapshots have an older schema or a different coverage date.
No historical day files or accumulation checkpoints are reset. A rebuild also recovers from
failure after saving a day's checkpoint but before writing derived snapshots.

Classification uses the end of the last processed UTC day, not today's date applied to a
partial history. `scan_days(as_of=...)` excludes incomplete and future UTC days; it cannot
provide an intraday historical view from daily aggregates. Passing an unbounded scan to
`classify` triggers a cutoff-aware rescan. Classification does not mutate the supplied scan.

The publisher withholds rankings, books and wallet alignment until history reaches the
latest complete day (with the existing one-hour settlement grace period) and the new schema
is available. Engine and options readings remain available. Coverage dates are visible and
are independent of the publish timestamp. Existing trader detail URLs also receive the
coverage state while backfilling. Positions represent the displayed daily close, marked
using the newest chain; intraday trades are not included, and expired positions are omitted.

Deploy the backend and frontend together. Until the recorder publishes schema 2, the new
frontend deliberately withholds legacy wallet snapshots instead of treating file existence
as proof that history is current. The recorder's existing schedule performs the upgrade.

## Accounting

Tier and cohort cells retain `[net contracts, position count, gross contracts]`. Gross is
summed before opposing wallets cancel, so net/gross measures the documented quantity.
Legacy two-value cells do not produce a directional score.

Open-position cost is carried across completed days, preserving basis on partial closes,
resetting on a close, and establishing a new basis after a single-fill reversal. When a day contains both
buys and sells, their execution order is unavailable: a remaining position's entry and
unrealised PnL are withheld. Multiple fills that cross from short to long or vice versa also
lose the cost of just the remaining contracts. Unknown basis remains unknown until a close or an unambiguous
reversal establishes a new basis. No approximate lifetime average is substituted. Exact
recovery for ambiguous periods would require separate historical trade replay; this change
does not refetch or expand stored raw trade data. Missing marks or basis also withhold the
aggregate unrealised PnL instead of presenting a partial total.

The approved gross ranking formula remains unchanged. UI labels and tips explicitly state
that fees are excluded. This is not a change to the study or a claim of predictive value.

## Flow and verification

New flow records exclude reverted legs, deduplicate repeated legs within a response, and
retain every previously seen key when the timestamp watermark does not advance. Previously
published aggregate flow files are not rewritten; any historical duplicates or reverted legs
in them require a separate source replay to repair and otherwise age out of the displayed
24-hour and 7-day windows.

Regression coverage includes navigation when scrollTo returns a Promise, error recovery,
coverage descriptions, changing wallet URLs, cost basis, opposing exposure, historical cutoff,
snapshot upgrades and flow deduplication. PR checks run backend tests, frontend tests and a
production build. Browser verification covers navigation and the published coverage states.

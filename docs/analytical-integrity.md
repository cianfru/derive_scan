# Analytical integrity, version 2

Implemented following the 2 October 2026 analytical review. This changes the Derive adapter and live descriptive readings. The copied Reflex files, historical wallet collection, classification thresholds, ranking formula and declared-study rules remain unchanged.

## Measurement and availability

- OI state now stores contracts, mark and observation timestamp per instrument/timeframe. Price and contract-count changes use the same two snapshots. Dollar OI remains a displayed value, not the participation change. First observations, legacy dollar-only state, reversed timestamps and intervals longer than the timeframe plus 30 minutes are unavailable for the OI trend. Old state upgrades automatically without resetting the engine's other state.
- Consensus includes only ready, current engine histories. It publishes eligible and universe counts. Unknown BTC/consensus evidence does not earn confirmation points.
- The adapter marks the no-climax check unknown when volume coverage is thin. Unknown core evidence suppresses new entries; valid price-based exit decisions remain available. Short or warming histories cannot publish a ready signal. This policy is outside the pinned engine, and is deliberately more conservative than the former handling of missing evidence.
- Signal JSON includes per-condition pass/fail/unknown, availability, source, observation time and freshness. The UI exposes these beneath “Why this signal”.

## Trade-time flow and migration

The collector writes `flow/sides_v2/` and `flow/wallets_v2/` using trade-time 15-minute buckets. Existing `flow/sides/` and `flow/wallets/` files are preserved and no longer treated as exact rolling totals. Large trades retain their individual execution timestamps.

`flow/coverage_v2/` records successful queried intervals, including intervals containing no trades. Failed requests do not extend coverage. Rolling windows end on the last complete 15-minute boundary; future/current incomplete buckets are excluded. Catch-up trades stay in their actual historical buckets.

On migration, new coverage begins with the next successful query, excluding the previously consumed watermark millisecond. A partial 24-hour or seven-day window remains visible as partial, but cannot contribute to options tone. No old aggregate is relabelled as trade-time data. No wallet-history backfill or collection cadence changes are required. Market-maker filtering retains the existing available classifications; this does not establish that classification is complete while the history rebuild is still running.

## Separate analytical dimensions

“Shorter view” means 4H engine / 7-day option tenor plus 24-hour flow / held wallet options expiring within 7 days. “Broader view” means 1D engine / 30-day tenor plus seven-day flow / held wallet options expiring within 30 days. These windows are labelled explicitly. They are separate, overlapping views, not independent forecasts or inputs to one combined trading signal.

Options tone v2 uses two required components with equal weights:

1. Current RR25 (call IV minus put IV), divided by 0.04 and clipped to [-1, 1]. This definition never changes with history length.
2. Covered taker premium balance: (call buys + put sells - put buys - call sells) / total premium. The existing $5,000 activity minimum is retained.

Both must exist; no renormalisation over an available subset. The existing ±0.25 display thresholds are retained. The same 30-day definition powers the headline and broader alignment. Option snapshots must be within 30 minutes of publication.

Historical skew percentile is a separate descriptive field: at least 96 observations spanning 95 fifteen-minute intervals, with at least 90% slot coverage. Its sample start, end and count are published. Put/call OI and the 7-day minus 30-day IV spread are descriptive surface context and do not cast directional votes. These choices have not been validated as predictive signals and do not change the wallet study.

## Implied ranges and option levels

Smile-derived ranges are accepted only after call-price slope bounds, convexity and strike-support checks. Numerical tolerance is 1e-7 in call-price slope; this is not fitted to a return outcome. The old cumulative-maximum repair is removed. An invalid or unsupported smile uses a labelled lognormal ATM fallback with the reason published. Without an ATM IV, the range is withheld. Real chains may use the fallback frequently because piecewise IV interpolation can violate convexity; a future arbitrage-constrained surface fit is separate work.

The chart starts the range edges at the options snapshot's index and timestamp, preserves actual expiry times, and displays both edges even when they lie on the same side of the index. Edges bound the middle half of the model distribution; their asymmetry alone does not identify buying intent. The separate ATM move-scale panel remains explicitly an arithmetic approximation.

Call and put OI walls aggregate the labelled expiry window. Minimum intrinsic payout is calculated per expiry; the chart identifies the nearest nonempty expiry rather than pooling unrelated settlement dates.

## Live wallet valuation

Historical records, classes, cohorts and the ranking formula are unchanged. The live display uses fresh quoted deltas where present, or a labelled estimate from the strike IV on the index. It never assumes 50% IV. Quoted put delta is inferred from call delta minus one, matching the existing undiscounted convention.

Missing deltas withhold complete book totals. Estimated deltas remain visible but withhold directional labels. Alignment discloses missing/modelled position counts and estimated gross exposure share; “positions” means wallet-instrument positions, not distinct wallets. Valuation time and history-through date remain separate.

## Validation and research boundary

Regression tests cover matching OI intervals, price-only notional changes, legacy/gapped OI, missing evidence, consensus dilution, skew continuity, fixed options components, flow catch-up and empty intervals, stale snapshots, missing wallet quotes, invalid smiles and expiry-specific payout minima. The original engine fixtures still match on complete data, and the hash test verifies the pinned files remain unchanged. Frontend tests cover actual range anchors/expiry times, unknown/stale states, coverage, condition explanations and model fallback labels.

The declared wallet study has not been run. Its newly-added-delta measure differs from the app's held-book measure. Training-window accounting, denominator interpretation and active-day wording still need to be resolved under the existing protocol before computing a verdict; no interpretation was silently inserted into the collection or ranking logic.

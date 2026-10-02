# Torq interface and radar

The interface uses Derive's public website as its palette reference: black and charcoal, orange `#ff5e00`, restrained mint for positive readings. Inter handles titles and controls; numerical tables retain IBM Plex Mono. The research view replaces the decorative gauge and industrial texture with recorded price history and explicitly named evidence.

## Reading the interface

- **Markets:** overview separates Engine, Option prices and Smart wallets. Shorter and broader views disclose their actual measurement windows. Show details retains the engine timeframes, combined engine signal, funding, open interest, regime, heat and IV. Sort controls work with the keyboard; search is local.
- **Price traces:** recorded 4H closes, direct line segments, first-close baseline and percentage change across the shown samples. Each trace has its own vertical scale. The publisher includes actual closing timestamps, so the landing chart has precise dates and a keyboard/pointer readout. A trace is not a forecast. Index price and the latest closed bar are labelled separately.
- **Options:** term previews have labelled IV and expiry axes. Snapshot time is visible on each market. Information buttons explain units and model limits.
- **Coin detail:** section links lead to the three perspectives, chart, engine evidence and options detail. Existing evidence and valuation disclosures remain available.
- **Responsive behavior:** navigation reflows on phones, charts measure their container to preserve text size, wide metric tables scroll within their own container, and selecting a radar market brings its detail into view. Tabs support arrows/Home/End; reduced motion is respected.

## Radar definition

Reflex reference: [RCCE_Scanner RadarPage](https://github.com/cianfru/RCCE_Scanner/blob/main/frontend/src/pages/RadarPage.jsx), with its map, selected-market rail, list and drill-down pattern. Its trader-count axis is not portable to the data Torq currently publishes.

Torq uses only the existing analytical v2 public payload:

| Encoding | Source and interpretation |
| --- | --- |
| Horizontal | Current 4H engine z-score, regardless of selected wallet expiry window |
| Vertical | Existing Smart cohort net option dollar delta / gross absolute dollar delta, from −100% to +100% |
| Circle area | Gross dollar delta exposure, scaled to the largest visible market |
| Selection detail | Engine, options tone and wallet readings separately, with their own windows |

Circle area is proportional to exposure (radius scales with its square root). The interaction target is larger than small circles for accessibility. The accessible market list duplicates all selections. Selection and wallet window are stored in the URL.

A market is plotted only when both the 4H engine and wallet readings are current, wallet history explicitly reports `ready`, score and gross delta are valid, gross exposure is complete, and no positions have missing or modelled deltas. The backend's existing minimum-position and minimum-exposure rules still apply. Missing data is never plotted as neutral. Options tone is deliberately not folded into an invented composite score.

The recorded review snapshot is processed through 2026-03-28 against a required 2026-10-01 UTC close. The production interface therefore shows an explicit collection state, with real engine/options readings available for inspection. Populated-map behavior is tested with isolated fixtures, not injected into public data.

## What the Derive leaderboard contributes

Read-only inspection of the [official leaderboard](https://app.derive.xyz/leaderboard) on 2026-10-02 confirmed:

- Overall: rank, wallet, trades, fees and volume, with a period selector.
- Realized PnL: rank, wallet, trades, PnL and volume, with a period selector.

These are useful wallet discovery and comparison fields. A displayed rank alone does not distinguish market makers, hedgers or directional wallets, or establish repeatable skill. Torq's existing classification, historical reconstruction and cohort definitions remain unchanged. There is no new leaderboard ingestion or ranking rule in this change.

A later enrichment can join official leaderboard observations by wallet address and observation period, preserving the reported source and its PnL definition. It needs a verified supported endpoint and coverage/reconciliation against the existing trade history first. Do not substitute rewards/points rankings for trading results, or use leaderboard rank as the radar's trader-quality filter.

The current radar intentionally omits Reflex's replay, entry-price proximity and trader headcounts: the present public schema does not establish those measures. Adding them requires timestamped position snapshots and defined aggregation, without resetting the accumulating history or changing the approved study.

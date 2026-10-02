# Torq interface and radar

Torq restores its angular identity: Chakra Petch headings, Barlow text, IBM Plex Mono numbers, chamfered controls, graphite surfaces and Derive orange `#ff5e00`. Mint and muted coral describe positive and negative readings. The landing page illustrates the three analytical layers with projected 3D dot surfaces: travelling price ridges, a curved options surface and positioning peaks/troughs. Pointer movement gently changes perspective; choosing a layer changes its emphasis and separation. The illustration is explicitly labelled, with no live market subset or data fetches. Motion has a pause control, follows reduced-motion preferences, and stops drawing offscreen or in a hidden tab.

## Reading the interface

- **Markets:** the briefing and all engine readings use the last completed daily close. Actual engine signal names and regimes replace generic directional labels. Daily percentage change compares consecutive completed UTC days; index price is labelled separately. The 7/30-day controls only change options tenor, flow and wallet expiry windows.
- **Price traces:** up to 60 recorded daily closes, direct segments, first-close baseline and percentage change across those samples. Each trace has its own vertical scale. Large traces support pointer and keyboard inspection. Rows, traces and options cards open the coin; information controls do not trigger navigation.
- **Sentiment:** Fear & Greed uses the semicircular instrument pattern from the read-only Reflex reference, with the same value driving label and needle. The tooltip explains source, age and the engine's 40/70 thresholds. BTC dominance is omitted.
- **Assets:** real, locally served icons replace initial-letter placeholders. Provenance and the Web3Icons MIT license are retained in `frontend/public/coins/`.
- **Coin detail:** daily candles lead, followed by engine evidence, three separate readings and options detail. Regimes, signals, ribbon, units, availability and expiry windows have explanations. Options commentary describes comparable-delta IV pricing, not trader intent. Raw diagnostics are available on demand.
- **Traders:** selecting a results or size cohort reveals its aggregate option exposure and each actual coin, with all-unexpired, within-7d, within-30d and beyond-30d slices. These are expiry filters, never performance-ranking periods. Net dollar delta and gross dollar delta remain separate; position counts are wallet-instrument positions. Missing or estimated quotes withhold direction. Reconstruction and valuation dates stay visible.
- **Flow:** the briefing uses all collected v2 taker premium totals by coin/side, independently of the capped large-trade sample. Each bar shows composition within one market; dollar totals communicate size. Selecting a coin filters the expandable sample. Collection coverage is shown before the summary; incomplete collection never becomes a full-day directional claim.
- **Responsive behavior:** navigation reflows on phones, chart containers resize, and wide tables scroll inside their section. Tabs support arrows/Home/End, tooltip buttons are keyboard accessible, and reduced motion is respected.

## Daily data and recovery

Both alignment horizons now use `row_1d`. Daily signal/regime/quality metadata, `z_1d`, `heat_1d`, `chg_1d`, `spark_1d`, timestamps and history provenance are published explicitly. Existing 4H collection and legacy fields remain for compatibility. The frontend takes its engine from the daily slot even when rendering an older v2 payload whose 7d slot contained a 4H reading; alignment is recomputed from the displayed readings.

OKX remains the first external history source. Explicitly mapped Coinbase ADA-USD, ZEC-USD and VVV-USD spot products and Hyperliquid HYPE/USDC spot (`@107`) supplement daily/weekly history where needed. Unsupported symbols are not inferred from ticker spelling. Coinbase weekly bars require seven contiguous UTC daily bars. Only completed candles are admitted, external volume is zero, provider errors preserve recovered history, and failed attempts retry daily. Versioned recovery permits previously completed empty OKX attempts to use the new sources once.

References: [Coinbase historic candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [Hyperliquid Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

The October 2 review recovered HYPE spot history back to November 2024 and Venice back to January 2025, plus earlier Zcash bars. This was tested in a scratch copy of recorded data. Production recovery occurs when the collector runs after deployment. Additional history enters stateful decisions on the next scheduled daily evaluation; a previous close is not reissued as a new signal event. The UI distinguishes recovered-but-not-yet-evaluated history from a truly short listing history. More price history does not create Derive volume or wallet history.

The pinned engine, decision-state lifecycle, study, wallet reconstruction, classification and ranking rules are unchanged. Smart-wallet availability still requires current history, sufficient positions/exposure and fresh quoted deltas. Cohort exposures use existing reconstructed positions and preserve gross exposure before opposing wallets offset.

## Radar definition

Reflex reference: [RCCE_Scanner RadarPage](https://github.com/cianfru/RCCE_Scanner/blob/main/frontend/src/pages/RadarPage.jsx), with its map, selected-market rail, list and drill-down pattern. Its trader-count axis is not portable to the data Torq currently publishes.

| Encoding | Source and interpretation |
| --- | --- |
| Horizontal | Daily engine price z-score, independent of wallet expiry selection |
| Vertical | Existing Smart cohort net option dollar delta / gross absolute dollar delta, from −100% to +100% |
| Circle area | Gross dollar delta exposure, relative to the largest visible market |
| Selection detail | Daily engine, options tone and wallet readings with their own windows |

Explicit quadrant labels distinguish above/below trend from long/short option sensitivity. Circle radius scales with the square root of gross exposure; labels may move to avoid overlap, observations do not. The accessible list duplicates map selections. Selection and expiry window are stored in the URL.

Only current daily engine and wallet readings are plotted. Wallet history must explicitly report ready, gross exposure must be complete, and no positions may have missing or modelled deltas. Existing minimum-position and exposure rules still apply. Missing or stale data is never plotted as neutral; options tone is not folded into a composite score. Populated-map behavior is covered by isolated fixtures; recorded stale quotes exercise the unavailable state.

## What the Derive leaderboard contributes

Read-only inspection of the [official leaderboard](https://app.derive.xyz/leaderboard) on 2026-10-02 confirmed:

- Overall: rank, wallet, trades, fees and volume, with a period selector.
- Realized PnL: rank, wallet, trades, PnL and volume, with a period selector.

These are useful wallet discovery and comparison fields. A displayed rank alone does not distinguish market makers, hedgers or directional wallets, or establish repeatable skill. Torq's existing classification, historical reconstruction and cohort definitions remain unchanged. There is no new leaderboard ingestion or ranking rule in this change.

A later enrichment can join official leaderboard observations by wallet address and observation period, preserving the reported source and its PnL definition. It needs a verified supported endpoint and coverage/reconciliation against the existing trade history first. Do not substitute rewards/points rankings for trading results, or use leaderboard rank as the radar's trader-quality filter.

The current radar intentionally omits Reflex's replay, entry-price proximity and trader headcounts: the present public schema does not establish those measures. Adding them requires timestamped position snapshots and defined aggregation, without resetting the accumulating history or changing the approved study.

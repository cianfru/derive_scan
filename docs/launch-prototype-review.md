# Cowboy product prototype

This prototype keeps Cowboy's outcome pricing and research rules while making the information easier to read before a decision. It covers the Saloon, outcome detail, Markets, the Traders leaderboard and cohorts. It is an interactive design proposal with a fixed published-data snapshot, rather than a change to the production app.

## Open it

The self-contained `artifacts/cowboy-launch-prototype.html` opens in a browser without a server or network requests. Navigation, filters, budgets, payout scenarios, trader inspection and theme switching work locally.

To run from source:

```sh
cd frontend
npm ci
npm run dev
```

Open `/prototype.html`. The existing app remains available at its normal routes; enable `VITE_QUESTIONS=1` to compare the Saloon locally.

To export the single-file prototype, from the repository root:

```sh
node scripts/build-launch-prototype.mjs
```

The entry point and page styles are separate from the production entry. The prototype adds no runtime dependencies and uses the existing Manrope, Chivo Mono, Cowboy artwork and coin assets.

## Why change the interface

The existing product has substantial information. The strongest opportunity is to make its units, scopes and decisions clear at first glance.

| Journey | Current interface condition | Proposed behavior | Benefit to the trader |
| --- | --- | --- | --- |
| Saloon | Price tiles combine a before-fee cents price with a fee-inclusive maximum return computed at a reference amount; the board's fees wording does not make that basis immediately visible. | Show a chosen spending limit across the board, actual spend including fees, and maximum dollars back. Label the per-$1 price basis separately. | Compare outcomes using a concrete amount, including quotes whose available size limits the spend. |
| Outcome detail | The chart area says “BTC index now” while its default series is the outcome price in cents per $1. Settlement mechanics compete with the decision figures. | Name the plotted series correctly, put the subject's index in the header, and show the partial-payout ramp with an interactive settlement price beside the order figures. | Distinguish the coin's index from the package price and understand the loss or payout between the two strikes. |
| Markets | Regime, wallet positioning and options pricing are compressed into repeated icon chains under 7D/30D headings. | Give each reading its own named column and explain the selected wallet expiry window and options tenor. Keep the daily regime independent. | Read the three layers without learning the icon system or mistaking the options window for an engine timeframe. |
| Market structure | The daily bars are small, while permanent date labels consume height. | Keep the original individual stacked daily bars, colors and spacing; give them more height and reveal date and coin groups on hover. | Inspect the history without changing the representation the owner prefers. |
| Leaderboard | Gross expired-options PnL and win rate lead; scope and sample definitions are mostly in explanatory copy. | Put “before fees” beside results and expired-instrument counts beside the rate. Preserve published ranks when sorting differently. | Judge what a ranking and percentage actually measure, and how much evidence sits behind them. |
| Cohorts | Names such as Money Printer or Shrimp need decoding, and one selected group is shown at a time. | Lead with result thresholds or premium-traded ranges and wallet counts; compare groups before opening their exposure detail. | Compare like-for-like groups and distinguish exposure balance from a count of traders agreeing. |
| Selected views | Markets and Cohorts headline summaries can retain a broader/default scope after the table selection changes. | Keep the selected scope, counts and readout together. | Avoid interpreting a statement about one population as a statement about the filtered rows. |

These benefits are hypotheses grounded in the current interface and data semantics. They have not been established by a user study.

## Design direction

Use Cowboy's identity with the restraint associated with Apple product interfaces: clear type hierarchy, calm surfaces, consistent spacing, aligned numbers and controls that explain their effects. More decoration does not improve the trading decision.

- Saloon is the trade-discovery front door. A price outcome opens a single decision workspace.
- Markets and Traders are research workspaces with clear scope and sibling views.
- Primary information is in dollars and plain words. Methodology and contract detail remain accessible.
- Color describes data or interaction consistently; it does not create a combined recommendation.
- Light and dark themes use the same hierarchy and behavior.
- The “Why this design” drawer explains the changes screen by screen and links to the current product for comparison.

Positions and Following remain part of the wider production navigation. This prototype covers the requested research and discovery journeys; it does not simulate a personal wallet or invent a position history.

## Data and behavior

The snapshot is pinned to `site-data` commit `2baf367b15f6787b8c81850a2334bae390112f14`, published on 5 October 2026 at 18:46:26 UTC. The prototype labels that capture time and uses the same observation clock when assessing the saved readings.

`frontend/src/prototype/snapshot-source.json` records source files and hashes. The dataset contains all 15 markets, 6 outcome boards, 34 recorded outcome histories, 200 published leaderboard rows and the result/size cohorts. The 120 historical breadth counts and coin memberships were independently matched against each coin's published engine history.

Outcome quantities, fees, breakevens and settlement values use the existing package math. Partial payouts remain linear between the strikes. After selection, the chart shows only that trade's dollar payout; before selection, it compares both directions per $1. A maximum payout is an upper bound at settlement, not a guaranteed return. Quote limitations, unavailable readings and data coverage remain visible. No probability, edge claim, new signal or invented return is added.

The prototype's order action opens a review of the figures. It does not connect a wallet or execute an order. Following persists across navigation and uses a dedicated prototype browser-storage key, separate from production records. Trader details show public published records rather than a fabricated trade history.

## Evaluate before adopting

Ask a first-time trader to complete these tasks without help:

1. Choose a $100 spending limit and identify the actual spend, maximum loss, maximum payout and one partial-payout example.
2. Explain what a 63¢ price represents and how fees enter the dollar figures.
3. Switch the wallet/options window and explain why the daily regime stays the same.
4. Compare two traders using gross-result scope and expired-instrument sample size.
5. Explain a cohort's wallet count and exposure balance without treating exposure as a vote count.
6. Inspect a daily bar and name its date and coin groups.

Record errors and completion time against the current interface. Adopt changes that improve those tasks, rather than assuming that a cleaner screenshot proves the product is ready.

## Implementation order

Start with labels and price bases, then the outcome decision layout, then Markets' named readings and Traders' visible samples. Keep existing calculation and data gates. Check navigation, responsive layouts, keyboard/touch access and unavailable states as each change moves into the production components. Public execution remains the existing trading workstream.

## Verification

All five prototype views were checked at 1440px and 390px in light and dark themes, with no document overflow or runtime errors. Browser interaction checks cover budgets, outcome settlement endpoints, price-history units, daily-bar hover and keyboard inspection, market windows and filters, published trader ranks, wallet dialogs, and cohort selections. Mobile previews disclose the partial-payout range before review and link directly to the settlement scenarios.

The standalone HTML was loaded without network access: embedded fonts and images loaded, all five views and interactions worked, and no HTTP requests were attempted. The managed browser blocks direct file URLs, so this check used the exact HTML through Playwright's `setContent`. The production build and existing frontend suite also pass: 61 files, 580 tests. No production page, execution flow or data publisher was changed.

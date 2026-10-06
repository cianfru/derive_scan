# Saloon design prototype

Open `index.html` in a browser. It is a self-contained, offline prototype; no server, wallet or account is needed. It does not call APIs, load production scripts or place orders. External navigation and research links open the existing Cowboy site only when clicked.

The board explores a more expressive Saloon while retaining Cowboy's typography, warm neutrals, orange interaction color and restrained layout. It groups the catalogue as coin → settlement date → price level → Higher/Lower. Each coin has one panel, an explicit date selector and an ordered price ladder. Three levels nearest the index appear initially; “View all N price levels” reveals the remaining levels for that date, and “Show fewer” restores the nearby view. Counts refer to price levels, each with two answers.

Maximum dollar profit leads each answer, with percentage return and actual cost beneath it. Higher and Lower have richer green and red surfaces. A coin filter widens the same ladder. On phones, the price level and partial-payout range sit above their answer buttons to preserve readable returns. Research context appears once per coin. A side preview shows cost, maximum payout and maximum loss, followed by an interactive partial-payout explorer and a simulated review.

The prototype includes 165 illustrative price levels across 20 coin/date groups (330 Higher/Lower answer choices). Prices, levels, index values, context and asset specifications are illustrative, frozen examples dated 8 October–6 November 2026. They are not a current trading catalogue. Payout and fee arithmetic uses the repository's existing pure `budgetTicket`, `outcome` and `breakeven` helpers. Asset specifications in this concept are not an execution configuration.

The comparison amount on the board is a prototype exploration. The production board's fixed reference amount remains unchanged. The same amount is carried into the preview; contract increments and minimum sizes remain visible through the existing calculation helpers.

Controls: coin and settlement-date filters, per-coin date selection, expand/collapse the price ladder, following, comparison amount, Higher/Lower selection, preview amount and side changes, settlement slider, sample payouts, simulated review, expandable context and light/dark theme. Following saves a specific coin/date/price level with both answer choices. It shows saved levels across dates and lasts for the open page only. A date with no levels for a coin does not substitute another date. Expanding a ladder preserves its selected date and does not scroll past the newly revealed levels.

## Rebuild

With frontend dependencies installed, run from the repository root:

```sh
node prototypes/saloon/build.cjs
```

An existing dependency directory can be supplied with `COWBOY_FRONTEND=/absolute/path/to/frontend`. `index.html` embeds its fonts, logos, coin images, CSS and bundled JavaScript. The only production modules included are pure calculation helpers; unused exports are removed by the bundle. There are no route, build, deployment or feature-flag changes.

Cowboy's bundled Manrope and Chivo Mono fonts retain their SIL Open Font License notices in `frontend/public/fonts/OFL-manrope.txt` and `OFL-chivo-mono.txt`. Coin artwork attribution remains in `frontend/public/coins/sources.json` and `WEB3ICONS-LICENSE`. These notices are also embedded in the standalone HTML.

## Verification

An independent review exercised all 165 levels and 330 answer previews across 20 coin/date groups, with 769 catalogue and identity checks. A further 82 Chromium checks cover filters, following, independent context expansion, fee-inclusive amounts, board-to-preview parity, decimal drafts, minimum sizes, both answer directions, zero/partial/full payouts, simulated review, nested help, keyboard isolation and Escape restoration. Layout was checked at 1440, 1280, 1024, 800, 600, 390, 375 and 320 pixels, including $100, $500 and $10,000 comparison amounts. No API calls, external asset requests or order requests occur while using the prototype. The standalone bundle was also checked with networking disabled. Safari and Firefox have not been run.

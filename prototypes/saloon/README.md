# Saloon design prototype

Open `index.html` in a browser. It is a self-contained, offline prototype; no server, wallet or account is needed. It does not call APIs, load production scripts or place orders. External navigation and research links open the existing Cowboy site only when clicked.

The board explores a more expressive Saloon while retaining Cowboy's typography, warm neutrals, orange interaction color and restrained layout. Maximum dollar profit leads each answer, with percentage return beside it. Higher and Lower have richer green and red surfaces. A side preview shows cost, maximum payout and maximum loss, followed by an interactive partial-payout explorer and a simulated review.

Prices, levels, index values, context and asset specifications are illustrative, frozen examples dated 8–9 October 2026. They are not a current trading catalogue. Payout and fee arithmetic uses the repository's existing pure `budgetTicket`, `outcome` and `breakeven` helpers. Asset specifications in this concept are not an execution configuration.

The comparison amount on the board is a prototype exploration. The production board's fixed reference amount remains unchanged. The same amount is carried into the preview; contract increments and minimum sizes remain visible through the existing calculation helpers.

Controls: coin and settlement-date filters, following, comparison amount, Higher/Lower selection, preview amount and side changes, settlement slider, sample payouts, simulated review, expandable context and light/dark theme. Following lasts for the open page only.

## Rebuild

With frontend dependencies installed, run from the repository root:

```sh
node prototypes/saloon/build.cjs
```

An existing dependency directory can be supplied with `COWBOY_FRONTEND=/absolute/path/to/frontend`. `index.html` embeds its fonts, logos, coin images, CSS and bundled JavaScript. The only production modules included are pure calculation helpers; unused exports are removed by the bundle. There are no route, build, deployment or feature-flag changes.

Cowboy's bundled Manrope and Chivo Mono fonts retain their SIL Open Font License notices in `frontend/public/fonts/OFL-manrope.txt` and `OFL-chivo-mono.txt`. Coin artwork attribution remains in `frontend/public/coins/sources.json` and `WEB3ICONS-LICENSE`. These notices are also embedded in the standalone HTML.

## Verification

81 Chromium browser checks cover filters, following, independent context expansion, fee-inclusive amounts, board-to-preview parity, decimal drafts, minimum sizes, both answer directions, zero/partial/full payouts, simulated review, nested help, keyboard isolation and Escape restoration. Layout was checked at 1440, 1280, 1024, 800, 600, 390, 375 and 320 pixels, including $100, $500 and $10,000 comparison amounts. No API calls, external asset requests or order requests occur while using the prototype. The standalone bundle was also checked with networking disabled. Safari and Firefox have not been run.

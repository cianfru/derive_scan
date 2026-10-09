# Cowboy

Trader intelligence on Derive. Repository `derive_scan` (internal name, kept). App and landing page: `frontend/` (React + Vite), deployed on Vercel (project `torq`, internal name kept) from `main`; it reads the `site-data` branch built by `backend/publish_site.py`.

```
cd frontend && npm install && npm run dev      # app against the live site-data branch
```

Reflex's signals on Derive's perps, plus Derive's options volatility surface.

- Signals: Reflex's signal code (engines, synthesizer, decision pipeline, agent filters), copied unchanged into `backend/reflex` at a pinned Reflex commit, run on Derive's candles for every Derive perp after each 4H and daily close. Design: `docs/signal-port.md`. Check against Reflex: `docs/parity-report.md`.
- Options: Derive does not serve past volatility surfaces, so the recorder builds the history every 15 minutes. Daily readings before recording began are rebuilt from traded options, a separate measurement that is labelled as such and never joined to the recorded quotes.

Both run in one GitHub Action (`.github/workflows/record.yml`) that commits plain files to the `data` branch: no server, no cost on a public repo. The FastAPI app in `backend/` serves the options data from SQLite and is kept for local use; it is not deployed.

## Signal files (`data` branch)

| Path | Content |
|---|---|
| `signals/latest.json` | newest rows for every perp on 4H and 1D: signal, unified 4H x 1D signal, regime, z-score, heat, exhaustion, ribbon, positioning, inputs status, data status; market-wide context |
| `signals/{4h,1d}/YYYY-MM-DD.csv` | one row per perp per closed bar |
| `signals/status.json`, `signals/state.pkl` | last computed bar per timeframe; decision and agent-filter state carried between bars |
| `metric_history/{UND}/{4h,1d}.json` | cached historical price metrics, reconstructed from completed candles; original recorded decisions take precedence |
| `candles/{UND}/{4h,1d,1w}.csv` | closed bars: Derive index OHLC, perp volume in contracts (0 when nothing traded) |
| `candles/{UND}/{tf}.backfill.csv` | earlier bars from OKX spot, before Derive's first bar (price only); rows report `backfilled_bars` |
| `candles/{UND}/{tf}.spot_volume.csv` | for a perp whose Derive volume is thin: the whole volume series from one spot market (`timestamp,volume,source`; OKX, or Coinbase for a verified product); rows report `volume_source` |

Every Derive perp is listed. `data_status` says how far Reflex's engine can read it: `ready`, `warming up` (fewer than ~500 bars, z-scores damped by the engine) or `not enough data` (fewer than 200 bars). `volume_status` is `thin` when fewer than 90% of the last 100 bars traded; the volume-based exhaustion flags are then off. Signals are computed 3 minutes after each close, once Derive has published the bar. Newest: `https://raw.githubusercontent.com/cianfru/derive_scan/data/signals/latest.json`.

## Trade flow files (`data` branch)

| Path | Content |
|---|---|
| `flow/large/YYYY-MM-DD.csv` | taker trades at or above $25k perp notional, $100k option notional or $2k option premium, with wallet |
| `flow/wallets_v2/YYYY-MM-DD.csv` | one row per wallet and trade-time bucket: trades, perp and option notional, premium bought and sold, realised PnL, fees |
| `flow/sides_v2/YYYY-MM-DD.csv` | per trade-time bucket, coin and kind (call, put, perp): taker buying and selling, market makers left out once classed |
| `flow/coverage_v2/YYYY-MM-DD.csv`, `flow/recovery.json` | successfully queried intervals, query provenance and progress recovering missing recent history |

Flow runs independently of options snapshots. A failed read remains due even when the current options slot succeeded. Missing complete 15-minute buckets in the trailing seven days are replayed from public trades, newest first, under a time budget. Full-bucket replacement and a write-ahead transaction make retries safe; coverage advances only after all pages and files are complete.

## App data files (`site-data` branch)

Built by `backend/publish_site.py` from the `data` branch after every recording run, then force-pushed as a single commit (no history). The app reads only these files, one request per screen.

| Path | Content |
|---|---|
| `markets.json` | every perp: price, changes, signals, regime, heat, z-score, ribbon, funding, OI, data status, options summary, alignment, sparklines; market-wide context and consensus per timeframe; `breadth_1d`: the daily regime mix, `{cols, rows: [[close, perps per regime...]], members: [[coin names per regime...]]}` with columns MARKUP, BLOWOFF, REACC, ACCUM, CAP, MARKDOWN, FLAT, over the 120-day engine history; members align with rows and columns for inspecting each daily close |
| `coins/{UND}.json` | candles (4H, 1D) with signal history and the newest rows; `ribbon["1d"]`: one character per daily candle (`g` gold, `b` blue, `n` grey, `-` warm-up or no reading); `band`: which side of the weekly band the daily close is on and since when (`{side, since, days, open}`, as the engine reads the band; `derive/band.py`); `engine_context`: consensus per timeframe, BTC's regime, Fear & Greed, stablecoin 7-day change, with observation times; `history.engine` (recorded and reconstructed price metrics) and `history.coverage` (engine, option recording and wallet history; option rows are not published); options detail, with `options.iv_history`: 14 days of 15-minute readings `[ts, atm_iv_7d, atm_iv_30d, atm_iv_90d, rr25_30d, bf25_30d, pc_oi_ratio, rr25_7d]` at 6 decimals (so a coin file stops growing after 14 days of recording); alignment by horizon; taker flow |
| `wallets/{UND}.json` | the ranked traders holding the coin's options and how each cohort is positioned on it |
| `traders.json`, `traders/{address}.json` | options traders' leaderboard and cohorts (market makers left out); one file per ranked trader and no other (no publish time in it; `valued_at` is the chain the book was valued on). Coverage fields `ready`, `status`, `through`, `expected_through`, plus `gaps` and `gap_days`: history readings that did not reconcile and are still retried (coverage stays ready; Traders and Trader name the gap days in their status (i)) |
| `traders/index.json` | every wallet active in the last 365 days except market makers: `[address, books ("o" options), days before through of its last activity, has a file]`; the trader page reads it when a wallet has no file |
| `traders/aliases.json` | `{version: 1, aliases: {derive_wallet: owner_wallet}}`, both lowercased, for the Derive Wallets whose owner has a file or an index row; the trader page reads it when a wallet has no file and redirects an old `/trader/<Derive Wallet>` link to the owner's page |
| `flow.json` | last 24 hours: large trades (at most 60 options and 40 perps) and the most active wallets; spot legs left out; until perp-only wallets are classed, wallets without an options class show no perp activity |
| `strikes/{UND}.json` | per-strike view of the newest chain (written by `record_once.py`) |
| `surface/{UND}.json` | daily option readings rebuilt from traded options, version 1: `{und, version, generated_at, status: ready\|sparse, first_trade_day, day0, days, index[], traded{atm7, atm30, atm90, rr7, rr30}, recorded{from, ...}, quality{metric: {coverage, reliability, shown}}, range_1y{metric: {p10, p50, p90, last, pct}}, overlap{metric: {days, median_diff}}}`. Value `i` of each array is the UTC day `day0 + i * 86400`; null is a gap. `traded` holds a 5-day median and only the readings that pass the gates (below); `recorded` holds, for the same readings, the daily medians of the recorded 15-minute snapshots (days with at least 72 of 96) from offset `from`, as a separate series; `pct` is the newest value's percentile rank (0-100) within the past year of `traded`. Written for every coin with a `history/surface` file; `markets.json` and `coins/{UND}.json` carry `has_surface` (true when at least one reading is shown); a coin without it needs no request |
| `radar.json` | version 1, read by the Radar page only: `{version, generated_at, through, cohort: "smart", closes: [30 daily close times], coins: {UND: {z: [...], w: {"7d": [[score, gross, flags] \| null], "30d": [...]}, e: "--uu"}}}` for every coin with options, one value per close, the newest close being the newest in `history/balance.json`. `z` is the engine's daily z-score from the same rows as `coins/{UND}.json` `history.engine["1d"]`, null unless ready; `w` is the Smart balance at that close (flags as in `history/balance.json`), `[null, null, flags]` when the close is unavailable (bit 2: no valid implied volatility, shown as unavailable with its reason), null for a gap or below the live gates (complete quotes, gross at least $10k, at least 3 positions); `e` is one character per close for the engine's reading saved there, by the live rule (saved as ready, perp volume ok): `u` up, `d` defensive, `n` neutral, `-` none (replayed closes carry no final signal). Not written until `history/balance.json` exists |

## Questions (stage 1, off by default)

Plain yes/no price questions built from Derive option spreads (`docs/questions-design.md`), computed in the record step from the tickers it already holds (`backend/derive/questions.py`, `derive/question_job.py`). The only added exchange read is one `public/get_option_settlement_prices` call per coin after an expiry it holds questions on (merged into `history/settlements/{UND}.json`). BTC and ETH use G = 5c (all-in over the clipped mark at $1,000 of payout, worse side) and S = $50 (top-of-book payout, smaller side); every other coin uses G = 8c and S = $25, takes the narrowest zone (from 6.5% of the index, up to 25%) whose headline passes at first sight, and is marked thin. All thresholds live in `QUESTION_GATES`. `python questions_sweep.py --data DIR` replays the rule and the gates over kept chains.

The `data` branch always keeps (a few KB, plus about 300 KB a day of hourly CSV before compression):

| Path | Content |
|---|---|
| `questions/state.json` | schema 1: per coin, each date's frozen `zone` (set once, at most one change toward the minimum while over 7 days out), `headline` with its two-slot hold, the last gate checks (one per 15-minute slot since 9 October 2026; `check_slot`), `shown`, the published ids `{id: [lo, hi]}` and `retired` ids; each coin's instrument `spec` (tick, minimum, amount step, taker rate, base fee, cap); `settle_try` per coin |
| `questions/history/{UND}/{YYYYMMDD}.csv` | hourly, one row per published question of that date: `ts,id,fair,yes_buy,yes_sell,no_buy,no_sell,index` (per $1) |

The app files exist only when the Action runs with `QUESTIONS_PUBLISH=on` (`record.yml` currently sets it to `"on"`); while it is off `publish_site.py` removes any `questions/` folder. The app shows the Saloon only in a build with `VITE_QUESTIONS=1` (routes, navigation, the landing's "Enter the Saloon" button and the coin page's Saloon card). Public visitors explore costs and settlement payouts; the review says "One-tap trading is coming to Cowboy" and does not offer manual order placement. One-tap execution, when enabled for the visitor, happens on Cowboy; `VITE_DERIVE_REFERRAL` supplies its referral code.

The Saloon also keeps, in the viewer's browser only, `cowboy-follows` (version 1: `{version, budget, follows: [{id, side, level, at, seen}], research: {UND: {regime, signal, lean7, lean30}}, notices, dismissed}`): the board budget (`/saloon/browse`), followed answers and the notices shown on return; export and import as `{kind: "cowboy-follows", version, budget, follows}`. No published file changes.

| Path (`site-data`) | Content |
|---|---|
| `questions/index.json` | `{schema, prices_ts, generated_at, paused?, trading, trading_mainnet, coins: [{und, thin, index, questions, dates}]}`: coins with at least one live answer, BTC and ETH first; `trading` and `trading_mainnet` are the one-tap switches (Saloon stage 2, below) |
| `questions/{UND}.json` | `{schema, und, prices_ts, index, thin, spec, paused?, dates: [{expiry, settle_ts, label, days, board, zone, zone_set_ts, headline, checks, levels: [{id, k, lo, hi, fair, state, ladder, yes, no}]}], settled: [{expiry, settle_ts, label, zone, settle_price, levels: [{id, k, lo, hi, paid}]}]}`. `id` is `{UND}-{YYYYMMDD}-A-{lo}-{hi}` (strikes as Derive writes them); `state` open, tail (Yes outside 3c-97c), retired, settling (from 07:30 UTC); a side is `tail` when it would cost over 99c per $1 (not offered; its true `buy` stays in the file); `ladder` 7 or 15 for the levels shown, 0 for an id kept only for holders; each side is `{state: open\|screen_wide\|no_quote\|tail\|settling, buy, sell, size, form: debit (credit no longer published, 4 October 2026), legs: [[name, buy\|sell, limit]], close: [[name, buy\|sell, limit]]}`, per $1 except the per-contract limits; `board` false keeps a date (under a day, or lapsed) for holders only. Settled dates stay 24 hours |
| `questions/history/{UND}-{YYYYMMDD}.json` | one date's hourly prices: `{schema, und, expiry, settle_ts, zone, ids, retired, ts[], index[], rows: {id: {i[], fair[], yb[], ys[], nb[], ns[]}}, settle_price, paid}`; settled dates keep four points a day for 90 days |

Gold rings (7 October 2026): on every publish `publish_site.py` (`annotate_smart`) marks an answer `smart: {delta_usd, wallets}` when at least two smart (top-tier) wallets holding options of that settlement inside its pays-in-part zone lean its way, more than lean the other way, with at least $10,000 (BTC, ETH) or $2,000 (other coins) between them; `questions/index.json` coins carry `smart`, the count of marked answers on the board. Context, not a signal. Each date also carries `traders: {state, score, long, short, net_delta_usd, gross_delta_usd, status}`: every directional wallet's open options of that settlement (`directional_book` in `history/positions.json`), each wallet counted long or short from $1,000 of delta, net over gross for the state, 3 wallets and $10,000 needed; each level carries `smart_wallets: {long, short}`, and the ring needs at least 2 smart wallets its way, more than the other way. Both are absent until the history holds the book.

The Saloon opens on the chart (`pages/Saloon.jsx`, `components/SaloonChart.jsx`, `saloon-chart.css`): coin tabs (logo, price, 24-hour change from `markets.json`, answers, gold rings), then the coin's last 12 days of 4-hour candles (`coins/{UND}.json`) and one column per settlement date with each answer a bubble at its level (the most it makes on $100, fees included). `?coin=` picks the coin; `?view=list` shows the list (`pages/Board.jsx`). `/saloon/guided`, `/saloon/{UND}` and `/saloon/browse` redirect there.

`prices_ts` is the 15-minute slot start. Prices over 35 minutes old show their age; over 90 minutes `publish_site.py` marks the files `paused` and the app shows em dashes.

## Saloon stage 2 (testnet fills, off by default)

One-tap answers through Derive RFQ (`docs/saloon-stage2-design.md`), built through P6 on Derive's V3 testnet only (owner's approval for P6, 4 October 2026: real fills on testnet; mainnet stays forbidden). The app shows it only in a build with both `VITE_QUESTIONS=1` and `VITE_SALOON_TRADE` set: `1` or `dryrun` give the P5 dry run (nothing fills), `testnet` gives real fills on the testnet with test USDC, `mainnet` gives real-money fills on Derive's V3 mainnet, closed until switched on (section "Saloon real money" below); any other value leaves it off. With it off the build carries no trading code (`src/lib/trade/bundle.test.js`); with it on, the trading code is one lazy chunk (`TradePanel-*.js`).

- `frontend/src/lib/trade/`: `package.js` (debit packages, contracts, the RFQ ceiling and floor, Derive's RFQ fee groups, quote checks, caps in `TRADE_LIMITS`), `derive.js` (JSON-RPC over the browser's WebSocket, retries, plain messages; refuses `private/execute_quote` on any endpoint but its build's own, and on mainnet unless switched on for a pilot wallet), `sign.js` (Derive's action signing; data encoders from `@derivexyz/derive-ts/codecs`), `wallet.js`, `account.js` (the Saloon account: a PRIME Standard subaccount labelled "Cowboy"), `sessionKey.js` (approving Cowboy: `trade:rfq:option`, one subaccount, 7 days; switch off), `rfq.js` (one ticket: RFQ, firm quote, dry run or fill), `fills.js` (a fill from Derive's trade history, or from execute_quote's answer), `record.js` (exact journal records and exits), `sync.js` (Positions from Derive), `limits.js` (kill switch, caps), `seat.js`, `config.js` (the build's one network, its endpoint and constants, `fillsAllowed`, `executeAllowed`), `live.js` (the mainnet switch as last read).
- `frontend/src/components/trade/`: `TradePanel.jsx` (the ticket beside stage 1's, which stays one tap away as "Place by hand"; the sell back on Positions; `DeriveSync` and `AlsoOnDerive` for Positions), `SeatSetup.jsx`, `ApproveCowboy.jsx`, `TradeTicket.jsx`.
- **Fills (P6).** After the firm quote passes the checks (ceiling or floor, margin unchanged, fee ceiling, caps, kill switch) the user taps "Buy for $X"; the Saloon key signs and `private/execute_quote` goes to the testnet with `enable_taker_protection`, the answer's label and the referral code (`VITE_DERIVE_REFERRAL`, empty by default; no builder fee). Outcomes: filled; part filled (recorded as filled for what filled, the rest of the RFQ cancelled, never retried); quote expired (11104); rejected (taker protection, Derive's cancel reasons); rate limited (-32000, nothing executed, the user taps again). A tap with no answer (timeout, dropped socket, 9000/9001) is never re-sent: the RFQ is re-read with `private/get_rfqs` until Derive says filled, cancelled or expired. Mainnet guard: `fillsAllowed` (testnet build, testnet network, Sepolia domain, testnet endpoint) in the ticket, and the client itself refuses the call on any other endpoint (`lib/trade/execute.test.js`).
- **Exact journal.** A fill is read back from `private/get_trade_history` (by the taker's quote id, else by RFQ id): fill time, legs, prices, fees and trade ids, kept as exact under the testnet journal key `cowboy-questions:testnet` (`exec: "rfq"`, `journal.source: "derive"`); only when the history has not caught up, from execute_quote's own answer (no trade ids). A sell back is an exact J2 exit (`via: "rfq"`).
- **Positions from Derive.** A testnet build's Positions reads the testnet journal and, over the user's own authenticated WebSocket, the Saloon account's `private/get_positions` and `private/get_trade_history`: fills this browser missed are added by their RFQ label (`{question id}:{yes|no}`, `:close` for a sell back), each card says whether Derive holds its legs, options no record explains are listed under "Also in your Saloon account", and settlement is recorded at the testnet's own price (`public/get_option_settlement_prices`). Close on a one-tap position sells it back through RFQ (floor from the board's sell-back price, or from Derive's mark when the board has none).
- **Kill switch.** `trading` in `questions/index.json` (`on`, `sell_only`, `off`), from the repository variable `QUESTIONS_TRADING` (unset means `on`, unknown values `off`), rewritten at every publish. `sell_only` blocks buys and keeps sell backs; `off` blocks both; the ticket shows a plain notice. A redeploy with the flag off is the hard stop.
- **Caps**, checked in the browser before any RFQ and again before the fill: $250 most-you-can-lose per answer and $1,000 bought per wallet per UTC day in this browser (`TRADE_LIMITS`, `limits.js`).
- Tests replay frames recorded from V3 testnet's public methods (`public_frames.json`, a real RFQ execution's trade rows in `testnet_rfq_trades.json`) and one recorded `public/execute_quote_debug` answer; private call shapes come from Derive's openapi (`private_shapes.json`). `src/saloon-testnet.test.jsx` walks buy, Positions, sell back and the kill switch on screen.

### A testnet site (second Vercel project)

A second Vercel project serves the complete testnet app from the same repo; production (`torq`) is unchanged.

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Framework | Vite |
| Production branch | `main` (or the branch under test) |
| `VITE_QUESTIONS` | `1` |
| `VITE_SALOON_TRADE` | `testnet` |
| `VITE_DERIVE_REFERRAL` | leave unset (empty) until Cowboy has a code |
| `VITE_DATA_URL` | leave unset: the board reads the same `site-data` files as production |

The header and every trade screen carry a "Testnet" badge. The board shows Derive mainnet prices recorded every 15 minutes; one-tap trades go to Derive's V3 testnet, whose firm price can differ, as the badge's (i) says.

The header also carries the wallet (testnet builds only): "Connect wallet" runs the same connect and sign-in as a ticket's first step; once connected it shows the short address with a menu: Saloon account (ready, funding needed or approval needed; opens Positions), Switch off Cowboy (when approved) and Disconnect. It is the same connection as every ticket and Positions (one store, `lib/trade/seat.js`), so connecting in either shows in both. Its code is the trade chunk's (`components/trade/WalletMenu.jsx`, exported from `TradePanel.jsx`, loaded after the first paint), its styles (`src/hdr-wallet.css`) are inlined by the Shell in testnet builds only; on phones the header takes two rows on every page, the landing included. Other builds carry none of it (`bundle.test.js`).

## Saloon real money (mainnet one-tap)

Built 5 October 2026 (design P8); **on since 7 October 2026 for the pilot** (the owner's wallet): production has `VITE_SALOON_TRADE=mainnet` and `VITE_SALOON_PILOT`, and cowboy-feed's `feed.yml` defaults `trading_mainnet` to `on` (the repository variable `QUESTIONS_TRADING_MAINNET` there overrides it). A build with `VITE_QUESTIONS=1` and `VITE_SALOON_TRADE=mainnet` reaches Derive's V3 mainnet only (`wss://api.derive.xyz/v3/ws`, Ethereum, chain 1); it carries none of the testnet's endpoint, chain or wording, and no "Details for testing" (`bundle.test.js`). Every testnet safety stays: the firm-quote checks, the order-book check and its re-asks, the balance check, the large-trade warnings, one tap never re-sent, the referral code (`VITE_DERIVE_REFERRAL`) and no builder fee (`extra_fee` "0").

- **Two locks, both needed.** (a) The published switch `trading_mainnet` in `questions/index.json`, from the repository variable `QUESTIONS_TRADING_MAINNET` (`on`, `sell_only`, `off`; unset or unknown means `off`), apart from the testnet's `trading`. The ticket reads it again, uncached, right before each fill; a read that fails counts as off. (b) The pilot list `VITE_SALOON_PILOT`: comma-separated wallet addresses (empty or unset means nobody). Eligible visitors get the one-tap ticket; everyone else gets a figures-only review with "One-tap trading is coming to Cowboy…" (`TradePanel` passes `oneTapComing` to `QuestionTicket`; `oneTapComing()` in `lib/pilot.js` says the same for other callers).
- **The fill guard.** `fillsAllowed(network, mode, live)` and the client's last check before the wire (`executeAllowed` in `lib/trade/config.js`) allow `private/execute_quote` only in a mainnet build, on the mainnet endpoint and chain, while the switch allows that direction for the signed-in pilot wallet (or, as before, in a testnet build on the testnet). Every combination is tested (`lib/trade/mainnet.test.js`).
- **Pilot browsers.** One tap shows in a browser that connected a listed wallet before, or that opened any page with `?pilot` once. Connecting a wallet that is not listed ends that and returns to the figures-only review. The header's wallet shows in pilot browsers only.
- **Funding** uses Derive's standard deposit flow: `public/register_deposit_address` for PRIME Standard, then official USDC on Ethereum (`0xA0b8…eB48`) sent to that address; "Fund it on Derive instead" opens Derive's app. Optional four-chain EVM funding and wallet purchase guidance are described below and in [the funding hub notes](docs/cross-chain-funding.md).
- **Kept apart.** Browser keys use `cowboy-saloon-*:mainnet`; one-tap records join the mainnet journal (`cowboy-questions`) beside the trades placed by hand.

### Switching it on (owner)

1. Repository variables (GitHub, Settings, Secrets and variables, Actions, Variables): leave `QUESTIONS_TRADING_MAINNET` unset for now (off).
2. Vercel, production project `torq`, Environment Variables (Production): `VITE_SALOON_TRADE` = `mainnet`, `VITE_SALOON_PILOT` = your own wallet address (more, comma-separated, later); `VITE_QUESTIONS` stays `1`. Redeploy.
3. In your own browser open `/saloon?pilot` once, connect your wallet, accept Derive's terms, fund your Derive account and approve Cowboy. The ticket stops at "Cowboy has paused one-tap trading": the switch is still off.
4. For the first live trade, set `QUESTIONS_TRADING_MAINNET` = `on`. It takes effect at the next Action publish (the recorder runs every 5 minutes; the published file can take a few more minutes to refresh). Start with the smallest amount, then sell back and let one settle.
5. To let more wallets in, add them to `VITE_SALOON_PILOT` and redeploy.

### Switching it off

- **Fast, no redeploy:** set `QUESTIONS_TRADING_MAINNET` to `off` (or `sell_only` to allow only sell backs). Each tap re-reads the published file, so it holds from the first publish after the change (minutes).
- **Hard stop:** in Vercel, remove `VITE_SALOON_TRADE` (or empty `VITE_SALOON_PILOT`) and redeploy: the build then carries no trading code, or offers one tap to nobody.
- Either way, positions already on Derive are untouched and settle as usual; users can sell them on Derive.

## Funding hub (optional)

Implemented 7 October 2026, with **cross-chain funding and the Rysk preview off by default**. This PR does not enable them in production. Direct Ethereum funding stays available; no real cross-chain transfer has been signed or sent during development, and the first owner mainnet deposit is pending.

| Flag | Requirements and scope |
| --- | --- |
| `VITE_FUND_ANYCHAIN=1` | Requires `VITE_QUESTIONS=1` and a supported `VITE_SALOON_TRADE` mode. Adds **Pay from another chain**. Real transfers require `VITE_SALOON_TRADE=mainnet` and existing wallet/pilot eligibility; testnet and dry-run builds cannot send real bridge transfers. |
| `VITE_RYSK_MOCK=1` | Requires `VITE_QUESTIONS=1`. Adds a lazily loaded **Receive premium** illustration beside **Buy outcome**. Made-up figures and a made-up seven-day term; no Rysk prices, wallet actions or orders. |

The EVM funding picker supports **Ethereum, Base, Arbitrum and HyperEVM**. LI.FI's public chain/token catalogues supply metadata; approved public RPCs and Multicall3 read balances, without a LI.FI balances endpoint. The initial scan covers native currency and up to 40 common tokens per chain; **Find other tokens** expands the catalogue. Failed reads remain unavailable, not zero. Solana funding is not implemented.

Routes request **FASTEST**, with no Cowboy integrator fee; provider and network fees still apply. Quotes expire after **60 seconds**, and estimated bridge duration must be at most **120 seconds**. Guaranteed Ethereum USDC arrival after fees and slippage must cover Derive's runtime deposit minimum plus `max($0.50, 10% of the minimum)`. Source balance/gas, recipient, token, amount and chain checks run before sending. Changed quotes require review if arrival or cost worsens. ERC-20 routes may need a separate exact-amount wallet approval; the allowance-aware quote includes its estimated gas in **Estimated total cost**, and refuses to guess an unavailable estimate. The wallet shows final network fees.

Funding shows **bridge delivery → Derive account credit** as separate steps. Wallet/network-scoped receipts survive disconnects; a persisted pre-send intent also holds funding after a reload or ambiguous wallet response without a hash. If the wallet request was cancelled after reload, manual wallet-activity verification and reconciliation are needed; there is no automatic resend. Partial or unverified delivery remains held, while a proved revert/refund can reopen funding after a fresh balance check. Optional-code removal and these boundaries are covered by bundle and fake-wallet/provider tests.

The 7 October read-only public quote returned an expected and guaranteed arrival of **9.46525 USDC for 10 USDC on Base**, via Mayan (Swift), with a three-second bridge estimate and a $5.50 minimum including margin. Wallet balances were mocked; no signature, approval, transfer or actual Derive credit was tested. The first owner deposit must measure total gas, arrived amount, Derive's fee and final credit time. Historical 6 October quotes are preserved separately in [the implementation and validation notes](docs/cross-chain-funding.md).

Mainnet account setup also offers **Buy with Apple Pay in your wallet** guidance: buy USDC on the selected network if the wallet/provider offers it, then return to fund Derive. It is not an embedded onramp; payment fees, availability and identity checks are set by the wallet's provider. No owner business-onramp account or API key is required.

The [Rysk discussion brief](docs/rysk-design.md) covers the owner's partner call and the obligation-first mock: collateral lock and possible purchase/sale, physical settlement and no early exit, followed by premium dollars and settlement examples. A future HyperEVM/Rysk funding adapter is not implemented; Derive cash and Rysk locked collateral remain distinct.

## Live service (Railway)

`backend/live/` keeps one connection to Derive's WebSocket (`ticker_slim.{instrument}.1000`) for every
option the published Saloon boards use (about 800 on 9 October 2026), re-prices each published level
every 2 s with the feed's own pricing (`derive.questions.price_level`) and serves the same paths the
app reads: `questions/index.json` and `questions/{UND}.json` (ETag, `Cache-Control: max-age=2`, gzip).
The 15-minute feed still decides which dates and levels exist and publishes the trading switches and
their lease; the live copy keeps them as published and only updates prices, `prices_ts` and the index.
While Derive's connection is down or its prices are older than 60 s, the published files are served
unchanged. `/health` reports the connection, the age of the last price and the files served.

Deploy (owner): a Railway service from this repository with root directory `backend` (it reads
`backend/railway.toml`: the Dockerfile, start command `python -m live.server`, health check `/health`;
the Dockerfile's own command is the live service too, so a start command left in Railway's settings is the only override),
a custom domain `live.cowboy.trading` (a CNAME at the DNS provider; the app's CSP allows it), then
`VITE_LIVE_URL=https://live.cowboy.trading/` on the Vercel project `torq` and a redeploy. Without
`VITE_LIVE_URL` the app reads the published files exactly as before. Optional variables:
`DERIVE_WS_URL`, `SITE_DATA_URL`.

In the app (`lib/data.js`): with `VITE_LIVE_URL` set, the Saloon's files are read from the live service
and refreshed every 5 s (3 s cache), falling back to the published copy when it does not answer; the
one-tap lease check before a fill still reads the published `questions/index.json`. A hidden tab stops
refreshing until it is shown again.

## X cards (`/control`)

`cowboy.trading/control` is the owner's page for posting on X by hand. It shows the card catalogue built from the latest `site-data` files (`frontend/src/control/`: `kit.jsx` for the frame, layout, charts and formatting; `cards.jsx` for the first three; `cards/market.jsx`, `options.jsx`, `saloon.jsx`, `traders.jsx`; `index.js` lists them). There are 22 cards and 45 card-and-coin entries:

- **Market:** the herd, weekly movers, market mood, the trend mix over 120 days, and funding.
- **Coins:** a trend spotlight per coin.
- **Options:** Friday's priced range, protection cost, a normal month's swing, where the open bets sit, the priced range by date, and the last 24 hours of flow.
- **Saloon:** the higher-or-lower ladder, how a price moved, what settlement paid, the long shot, and how 55¢ becomes $1.
- **Traders:** the leaderboard, the biggest trades of the day, smart wallets' lean, and winners against losers.

Each card says what the number is and why it matters, with a comparison (a week or a month ago, the share of recent days, the last few days' real move). Each card drafts two or three post angles. Every angle tags @derivexyz, stays under 280 characters, and uses no links, addresses or forecast words. A card whose data has nothing to say returns no model and sits out, as funding does while every perp pays the same rate. The page shows today's four picks (one per group, turning over daily), the full catalogue by group, a coin switch, Next angle, editable text with checks, Download PNG (2160x2160, drawn in the browser with both fonts embedded) and Copy text.

The page is its own build entry (`frontend/control.html`), outside the app's bundle. It opens only with the password set in the Vercel environment variable `CONTROL_PASSWORD` (project `torq`, Production); while that variable is unset, the page stays shut. The browser asks for a name and a password: any name works, with the password set there.

## Tracking values over time

Coin pages include **Market history**: dated engine metrics, funding and open interest. Inspect exact samples by pointer, touch or keyboard; select daily or four-hour readings. Missing intervals remain gaps. Details: `docs/history-tracking.md`.

Historical price metrics cover up to 120 daily closes and 30 days of four-hour closes. They use the same engines on completed cached candles, with warmup and source provenance retained. Reconstructed metrics use dashed lines; final trading decisions are shown only where originally recorded. Option measurements stay in the `data` branch's feature files; the coin file carries their recording coverage and 14 days of IV history for the options panel. Derive provides no past surfaces, so missing snapshots and the surfaces of dates before recording began cannot be recovered. Daily readings rebuilt from the options traded on those dates (`surface/{UND}.json`) are a separate measurement: labelled as rebuilt from traded options, published as their own series beside the recorded quotes and never used to fill a recorded gap. The coin page's Options step reads that file only when `has_surface` is true: a strip under each of its three figures (thin line rebuilt from traded options, thick line recorded, dot the newest snapshot) and the IV history tab (3M, 1Y, All); other coins keep the snapshot view. Wallet trade reconstruction and option-surface recording have separate coverage dates.

Readings rebuilt from traded options are published per reading only while it passes three gates, recomputed on every run: a reading on at least 70% of the trailing 180 days, a corrected split-half reliability of at least 0.85 (the same fit on two halves of the instruments), and, once recorded and traded readings overlap on 14 days or more, a median difference of at most 3 volatility points (ATM) or 2 (risk reversal). No level offset is applied. On 3 October 2026 BTC (from 21 September 2024) and ETH (from 3 February 2024) passed for all five readings, HYPE (from 7 February 2026) for ATM 7, 30 and 90 days and the 30-day risk reversal; the other coins trade too few options. Method and validation: `docs/history-tracking.md`.

## Options traders' history (`data` branch)

Every option and perp trade on Derive V2 since December 2023, one finished UTC day at a time (`history_once.py`, part 1 of `docs/options-traders-study.md`). Raw legs are not kept; they can be read again from Derive.

| Path | Content |
|---|---|
| `history/days/YYYY-MM-DD.csv.gz` | per wallet and instrument for the day: contracts and value bought and sold, maker and taker legs, delta added in USD (Black-76 at each trade's implied volatility), implied volatility, out-of-the-money premium sold, realised PnL, fees |
| `history/settlements/{UND}.json` | option settlement price per expiry |
| `history/wallets.json` | each wallet's class from all days so far (market maker, income, hedger, directional, occasional) and, for profitable directional wallets, its tier (top, smart, profitable) |
| `history/positions.json` | open option contracts per instrument held by each tier's wallets |
| `history/traders.json` | leaderboard (best 200 by options PnL, market makers left out), each one's open options and last 45 days, cohorts by results and by size with their open options. `history/wallets.json`, `positions.json` and `traders.json` carry `gaps` and `gap_days` (unresolved entries of `state.json` `retry`) |
| `history/surface/{UND}.csv` | one row per finished UTC day for each coin with options (traded or recorded that day), appended once and never rewritten (`derive/surface_history.py`): `day, index, index_src, carry_day, carry_pairs, carry, points, contracts, atm7, atm30, atm90, rr7, rr30, n7, n30, n90`, the same five readings from two halves of the instruments (`*_a`, `*_b`, by crc32 of the instrument name), and `rec_atm7 ... rec_rr30, rec_n`: the median of that day's recorded snapshots, null unless at least 72 of 96 were recorded |
| `history/balance.json` | the Smart wallets' option delta balance per coin at every daily close (`derive/balance_history.py`), schema 2: `{schema, through, closes: {close_ts: {UND: {"7d": [score, net, gross, positions, flags], "30d": [...]}}}, expiry_gross}`. `close_ts` is the daily bar's close (00:00 UTC after the day); score is net over gross USD delta, null below the live gates (gross at least $10k, at least 3 positions) or when a delta was missing or estimated; net and gross are null when a quote was missing; flags bit 0 = roll (at least 25% of the window's gross left or entered by expiry since the previous close), bit 1 = modelled (no chain recorded at that close), bit 2 = unavailable (modelled, but a position had no valid implied volatility: its own traded IV within 21 days, else the coin's near-the-money traded IV within 7 days; score, net and gross null, never an intrinsic delta). A coin or horizon without a Smart position is left out. `expiry_gross` holds the two newest closes' gross per expiry, for the next close's roll. About 0.5 KB a close |
| `history/state.json` | last day done; `surface` (definition version of `history/surface`), `surface_through` (newest day in it) and, while a new version is rebuilt into `history/surface_rebuild/`, `surface_pending`; `balance` (definition version of `history/balance.json` once its backfill is done; removed when a catch-up skipped a close, so the backfill runs again); `repaired` (the last one-time repair finished: `fractional_strikes`, then `paging`), with `repairing` and `repair_pending` while one runs; `retry`: readings that did not reconcile, `[day, query, attempts, next_try]`, read again every 6 hours (4 per run) until exact, then the wallet files rebuild and the balance backfill runs again. Finishing `paging` removes `surface` and `balance`, so both rebuild from the repaired days |
| `history/anomalies.json` | readings kept although their pages did not reconcile within the slicing bound (day, query, legs read) |

## Options files (`data` branch)

Every coin with options on Derive (`universe.json`). BTC and ETH in full detail; the others with expiry rows hourly and raw chains daily.

| Path | Content |
|---|---|
| `{source}/{UND}/features/YYYY-MM-DD.csv` | `ts,feature,value`, every snapshot |
| `{source}/{UND}/expiries/YYYY-MM-DD.csv` | one row per live expiry per snapshot |
| `{source}/{UND}/chains/YYYY-MM-DD/HH.json.gz` | raw option chain and perp ticker, hourly |
| `{source}/{UND}/latest.json` | newest features and term structure |
| `runs/YYYY-MM-DD.csv`, `status.json` | every attempt with its real fetch time; last result per source and underlying |

Snapshots are labelled with their 15-minute slot (unix seconds, UTC). An external cron service starts the workflow every 5 minutes (GitHub's own schedule is kept as a backup) and it records only slots not yet recorded, so a late or skipped scheduled run is caught by the next one. Failures show in the repo's Actions tab. Newest data: `https://raw.githubusercontent.com/cianfru/derive_scan/data/v2_mainnet/BTC/latest.json`.

## What it records

Every 15 minutes, for each source (default `v2_mainnet`) and underlying (default BTC, ETH):

| Table | Rows per snapshot | Content |
|---|---|---|
| `features` | ~12 per underlying | index price; ATM IV at 7/30/90 days; 25-delta risk reversal and butterfly at 30 days; put/call OI ratio; option OI; perp funding (hourly and annualised), basis, OI |
| `expiry_slices` | one per live expiry | forward, ATM IV, 25-delta call/put IV, RR25, BF25, call/put OI |
| `chains` | hourly | gzip JSON of the raw option chain and perp ticker, for recomputing features later |

Feature definitions are fixed in `backend/derive/features.py` (docstring). No extrapolation: a value that cannot be bracketed by real quotes is left out.

Measured on 1 October 2026: one snapshot of BTC and ETH from V2 mainnet takes ~11 s and 28 public requests; a raw chain is ~42 KB gzipped per underlying. With the defaults that is ~2 MB a day, ~60 MB a month of chains, plus a few thousand small rows a day.

## Switching to V3

Switched on 6 October 2026 at 18:47 UTC, once Derive's migration had emptied V2 (no options listed) and V3 carried the open interest over. The feed (`cianfru/cowboy-feed`, `feed.yml`) reads `DERIVE_SNAPSHOT_SOURCES: ${{ vars.DERIVE_SNAPSHOT_SOURCES || 'v3_mainnet' }}`: unset means V3 mainnet; setting the repository variable there overrides it. Every job reads the first listed source: recorder, questions, flow, history, signals. `record.yml` here is off (`RECORDER_OFF=1`). Every job had been run once against V3 mainnet on 5 October 2026 on a copy of the data branch.

While V3's order books are empty the questions board publishes no coins and the Saloon reads "No prices on Derive right now."

What the switch keeps the same:

- Files: V3 mainnet records into `v2_mainnet/` (`SOURCES[...]["dir"]` in `derive/config.py`), so every reader carries on with one history; `status.json`, `runs/` and `latest.json` name the real source (`v3_mainnet:BTC`). Listing V2 and V3 mainnet together is refused (same directory).
- Wallet names: V3 names each leg by the owner's own address (EOA), V2 by the Derive Wallet (SCW); subaccount ids carry over (235 of 238 wallets trading on 4 October changed name, one to one). The owner's address is the canonical name (owner, 5 October 2026), before and after the switch. `history/wallet_aliases.json` (version 2, `derive/wallet_alias.py`; version 1 is still read) keeps each subaccount's SCW (from V2 legs as they pass, or one V2 lookup for a subaccount seen on V3 whose owner has no SCW known yet) and its V3 owner (from V3 legs: the jobs once switched, and `wallet_alias_once.py` after every flow run, which reads each finished day of the last 30 once). SCW -> EOA holds when every subaccount of the SCW names one owner; an SCW with two owners keeps its name (`last_run.conflicts`). Legs read from V2 are given the EOA as they are read (the name read stays as `wallet_raw`, which flow keys use); legs read from V3 keep their name. Rows written earlier under an SCW are translated when read (`history.canonical_rows`, `flow.market_makers`, `publish_site`), so nothing is rewritten and an owner learned later applies to the whole history: the wallet files rebuild when the names change (at most hourly, `ALIAS_REBUILD_EVERY` in `history_once.py`). One owner's several SCWs merge under it; a merged trader is a market maker when any part alone is one. An SCW whose owner is unknown (no V3 trade in the 30 days V3 serves) keeps its name.

Check before switching that V3 mainnet is trading: on 5 October 2026 it served the state migrated from V2 (trades up to 4 October 23:24 UTC, all `batch_status` `Settled`) with live marks and implied volatility, but empty order books, zero open interest, no option settlement prices and no funding history. Recorded then, the Saloon board is empty (no quotes) and open-interest features are zero. Switch once `public/get_trade_history` shows trades from the last minutes and BTC options show bids, asks and `stats.oi`.

Shape differences handled: `get_all_currencies` has no `instrument_types` (options are the coins with an `option` object); `tx_status` "reverted" became `batch_status` ending in "Error"; V3 lists option settlement prices only for its own expiries, so saved prices are merged, never replaced; unfiltered `get_trade_history` windows longer than 30 days are cut to the last 30 days without an error (the jobs read 15-minute to one-day windows); index prices carry fewer decimals.

## Local API

- `GET /health`
- `GET /api/status`: sources, row counts, database size, bytes sent per route, last run per source and underlying, request counts
- `GET /api/surface/{underlying}?source=`: latest features and term structure (`stale` when the newest snapshot is overdue)
- `GET /api/features/{underlying}?feature=atm_iv_30d&from=&to=&source=`: time series (unix seconds; default last 30 days, at most 400)

JSON responses carry ETags: a repeat request with `If-None-Match` gets an empty 304. `/api/status` also shows the database size on disk (`db_bytes`) and bytes sent per route (`egress`).

## Run

```
cd backend
pip install -r requirements-dev.txt
python -m pytest
python record_once.py --out ../store   # record the current options slot into files, as the Action does
python signal_once.py --out ../store   # compute any due 4H/1D signals, as the Action does
python flow_once.py --out ../store     # collect flow and recover missing recent buckets independently
python history_once.py --out ../store  # extend the options traders' history (150 s budget), as the Action does
python research/parity_report.py OUT.md   # one-off: Derive candles vs Reflex's candles, same code
python main.py                         # local API with its own recorder, http://localhost:8000
```

Settings: see `.env.example` (the Action uses the defaults). The API's recorder holds a file lock in `DATA_DIR`, so several workers never record twice.

## Product regression checks

Run `npm test` in `frontend/` for the financial models and component tests. Run
`npx playwright install chromium` once, then `npm run test:browser` for desktop and
phone journeys. These browser checks use deterministic published-data fixtures and
mock public sockets; they do not connect a wallet or submit orders. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium installation. CI also
builds the default, testnet and mainnet configurations.

Funding tests use fake wallet confirmations, public-provider responses and chain
receipts; they never send real funds. Optional-flag bundle checks also verify that
funding-provider and Rysk mock code are excluded when their flags are off.

The decision draft (coin, outcome, side, decimal budget and comparison choices) is
kept in the current browser session; live prices are read afresh. My space offers
a combined backup of journal records across both networks and Following, with a
preview before restore. Existing separate backup formats remain readable.

Each completed data publication has a `publication_revision` and a `manifest.json`
with artifact hashes. Observation timestamps retain their original meaning. Screens
combining files retry a revision mismatch once and identify it if it persists.
The recorder checks published health even when no collection is due. Coverage
problems fail the run while valid partial publication remains available; flow
recovery has a 45-minute grace period. The separate health workflow remains useful
for detecting a recorder that stops altogether.

Fixed product diagnostic codes are retained in a small in-memory buffer. Sending
these codes to the existing Vercel Analytics integration is opt-in through
`VITE_PRODUCT_EVENTS=1`; it is off by default. Events include only a predefined
kind and screen category, without addresses, amounts, query strings or error text.

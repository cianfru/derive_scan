# Torq (repo: derive_scan)

Torq is the product name (owner, 1 October 2026). Reflex's signals on Derive (derive.xyz), plus an options layer: perps and the options volatility surface. Its own product in its own repo, separate from Reflex (`cianfru/RCCE_Scanner`). Backend: Python jobs in `backend/` run by GitHub Actions (FastAPI app for local use only). Frontend: `frontend/`, React + Vite, on Vercel (project `torq`).

## Scope: what comes from Reflex and what does not

- Goal (owner, 1 October 2026; this was the plan all along): reproduce Reflex's signals on Derive, independently of Reflex, since they are venue-agnostic; add what Derive's options make possible; new design.
- Port, do not link: copy Reflex's venue-agnostic signal code (the price-based engines and the signal synthesizer) into this repo, pinned to a named Reflex commit, and run it on Derive's own data. Do not call Reflex's API or depend on its servers.
- Leave out anything Hyperliquid-specific: wallet tracking and smart-money consensus, Hyperliquid market quirks (e.g. its `k` markets), Hyperliquid data feeds. The Larsson engine (four EMAs of the close, Reflex's `larsson_engine.py`) is kept (owner, 1 October 2026), outside the signal path as in Reflex, and published as `ribbon`; the word never appears in the UI or in published files, and the paid data it refers to stays out of the repo.
- Also copy Reflex's infrastructure and data-ingestion patterns: fetch once and serve everyone, ETag/304, last good data with its time, egress and storage readouts, rate limits, edge cache and access codes when there are users, the frontend stack.
- Do not change the Reflex repo for Derive work. An options panel was added to Reflex (#197) and reverted (#198) for this reason.

## Where things stand (1 October 2026)

- Signals: built (1 October 2026). Reflex's signal code copied unchanged into `backend/reflex` (commit e45ed97; `reflex/SOURCE.md`, hash test), glue in `backend/derive/signals.py`, job `backend/signal_once.py` in the same Action: after each 4H and 1D close (+3 min), every Derive perp (15 on V2 today), Derive index candles with perp volume, Derive funding/OI, Fear & Greed, stablecoins, BTC dominance. Output `signals/` on the `data` branch (README). Short Derive histories are extended once with OKX spot candles before Derive's first bar (price only, volume 0; `derive/backfill.py`, `backfilled_bars` per row); coins OKX lists only recently stay short. `tests/test_signal_parity.py` shows the glue reproduces Reflex's scanner exactly on saved candles; `docs/parity-report.md` compares a year of signals on Derive's vs Reflex's candles. Left out: HyperLens, CoinGlass, CVD (Reflex's defaults when missing), the CTO overlay (shadow in Reflex by default) and the range forecast (a forecast).
- Recorder: GitHub Action `.github/workflows/record.yml`, started every 5 minutes by an external cron service (cron-job.org, owner's account) through the workflow-dispatch API; GitHub's own schedule never fired and stays only as a backup. Records each 15-minute slot once, committing plain files to the `data` branch; layout in README. Free on a public repo; no server. Records Derive V2 mainnet (`api.lyra.finance`) for every coin with options (discovered hourly via `public/get_all_currencies`, 12 live on 2 October 2026): features every 15 minutes for all; expiry rows every 15 minutes and raw chains hourly for BTC and ETH, expiry rows hourly and chains daily for the rest. The same run appends trade flow for the radar (`flow/`: large taker trades, per-wallet summaries per run; Derive V2's public trades carry the wallet). Scheduled workflows only run from the default branch.
- Railway retired to cut cost (owner's request, 1 October 2026): it recorded from 1 October 12:00 UTC until the Action took over at 20:15 UTC; that early SQLite data was not migrated. The cron service's access token expires about 30 December 2026; the owner renews it. The FastAPI app (`backend/main.py`) stays for local use, not deployed.
- Repo growth (2 October 2026): roughly 4 MB/day (chains ~2.3, option CSV ~1.5, flow ~0.5), about 1.4 GB a year; the traders' history adds about 10 MB once and ~10 KB a day. Before the repo nears 1 GB (around month 8), move old chains and flow out of git (e.g. release assets).
- App (2 October 2026): `frontend/` React + Vite + lightweight-charts, deployed on Vercel (project `torq`, root `frontend`, framework vite, production from `main`, previews off). Routes: `/` landing, `/markets`, `/coin/:und` (alignment grid, candles, ribbon, signal markers, readout, positioning, options panel: open interest by strike, term structure, volatility by strike, 14-day IV and skew, priced range), `/options`, `/traders`, `/trader/:address`, `/flow`. Reads only the `site-data` branch (`backend/publish_site.py`, rebuilt every run and force-pushed as one commit, so it keeps no history); `VITE_DATA_URL` overrides for local previews.
- Brand (owner, 2 October 2026): logo files in `frontend/public/brand` (on-dark and on-light versions, mark for icons). Corporate colours orange and dark grey; very dark graphite ground with an industrial plate/rivet pattern; chamfered corners echo the logo. Type: Chakra Petch (display, blocky, cut corners, close to the logo), Barlow (body), IBM Plex Mono (numbers). Tokens in `frontend/src/styles.css`; dark first, light supported.
- Not built: the radar proper, V3 source (one setting, `DERIVE_SNAPSHOT_SOURCES=v3_mainnet`, once V3 mainnet is live).
- Trading (plan Phase 2) is not in the repo. It needs the owner's explicit approval; order mechanics come from Derive's docs.

## Product direction (owner, 2 October 2026)

- Torq is an independent product: Reflex-grade feel and quality, its own identity. No mention of Reflex in the UI, landing page or public copy; the link to Reflex lives only in internal docs (code provenance).
- Core: the signal engine (ported from Reflex) on Derive's perps. Differentiator: options, shown as visual market structure (what traders pay for protection, where open interest sits, how the surface is shaped, the price ranges option prices imply per expiry), made easy to read, labelled as market pricing, never as a forecast.
- Options traders (owner, 2 October 2026): rebuild Derive's options trade history by wallet (since mid-2024) and study whether skilled directional options wallets lead price, the options counterpart of Reflex's profitable traders. Market makers, income sellers and hedgers are filtered out first. Declared study: `docs/options-traders-study.md`, rules approved by the owner 2 October 2026 before any result; until a verdict, positioning is context. Market makers are noise to the owner: never shown in the app (Flow, taker sides).
- Options on the chart (owner, 2 October 2026): no single price path (option prices encode a spread, not a direction). The chart shows the middle half of priced outcomes with the upside edge green and the downside red (asymmetry visible), and the call wall, put wall and max pain. An "options lean" (skew vs its range, taker premium, put/call change, short-dated stress) sits beside the engine's signal, never inside it.
- Focus (owner, 2 October 2026): Torq is built around the coins with options on Derive; perps without options stay available (no cost) behind "Perps only" on Markets. Their traders are tracked too (owner, 3 October 2026), possibly on their own page: those coins show two layers (Regime, Wallets) and gain the Options layer when Derive lists options for them. The history rebuild already holds every perp leg per wallet since December 2023. The core view is alignment: for the next 7 and 30 days, the engine's direction, option prices and smart wallets' positions side by side (`derive/lean.py`), shown on coin pages and sorting Markets.
- Traders page (owner, 2 October 2026): `/traders` ranks Derive's options traders by options PnL (market makers never shown), with cohorts by results (Giga-Rekt to Money Printer) and by size (Shrimp to Leviathan) and how each cohort is positioned per coin; `/trader/:address` shows a trader's open options (entry, mark, delta, unrealised), large trades and recent activity. Wallets show a made-up codename (`frontend/src/lib/walletName.js`, copied from Reflex commit 9977a83) and a Torq emblem (owner, 3 October 2026): a graphite plate with the logo's cut corners carrying one mechanical mark (gear, nut, bolt circle, chevrons, gauge, piston, rivet grid, crosshair) in an accent kept off green and red, drawn from the address (`frontend/src/lib/walletEmblem.js`).
- Smart wallets (owner, 2 October 2026): tiers among profitable directional options wallets, Top (best fifth, the study's set), Smart (best 50, the app's default), Profitable (all in profit).
- One path (owner, 3 October 2026): every screen follows the same order, coin -> 1 Regime -> 2 Wallets -> 3 Options, drawn with the same three tiles everywhere (`frontend/src/components/Chain.jsx`: up green, defensive red, balanced grey, building dashed; a framed chain when all three agree). Markets lists coins with their 7- and 30-day chains, sorted by agreement; the coin page has a sticky chain strip and three numbered steps (Regime: readout and chart, engine detail collapsed; Wallets: smart-wallet read, who holds it, cohorts on the coin, from `wallets/{UND}.json`; Options: the options workspace); other pages deep-link to `#regime`, `#wallets`, `#options`. Options tone uses skew alone (`skew_only`) until taker flow covers its window.
- Landing page (owner, 3 October 2026): show what Torq does, never its current results (12 coins would be given away). No live readings or market data on the landing. The hero is the three moving dot-wave layers, labelled and cycling in order (01 Regime, 02 Wallets, 03 Options; `components/ResearchLayers.jsx`, illustrative geometry only), followed by a data-free description of the three layers.
- Tracker suite (owner, 3 October 2026): Torq becomes the Derive equivalent of the Hyperliquid trader-intel sites (HyperTracker, Hyperdash): data rich, beautiful, elegant, showing who is doing what, built mostly from data Torq already has, made easy to read, including for people who do not know options. Research: Derive's public/margin_watch exposes any subaccount's live positions, greeks, margin and liquidation price; nobody's open orders are public; live data would need an always-on worker (about $5-10/month); the owner chose to stay on 15-minute updates for now (3 October 2026) and revisit once alerts (e.g. Telegram) and more of the suite exist. Copy trading is deferred until the product is established and its value proven (then V3 only, session keys in a signer, legal opinion, owner approval).
- Strategies (owner, 3 October 2026): the app lets a normal user build an options strategy that matches what the three layers say, explained plainly (cost, worst case, best case, breakeven, payoff), first as independent strategies the user can copy into Derive by hand; direct Derive integration (RFQ, builder fees) comes later with owner approval. A strategy is shown as matching the reading, never as advice or a forecast.
- Quality bar: excellent UI, refined, fast, clean, no friction, easy to understand.

## Roadmap (approved 2 October 2026)

1. Data foundations: done 2 October 2026 (backfill, options for every coin, trade flow).
2. Torq design system: first version done 2 October 2026 (`frontend/src/styles.css`); refine with the owner.
3. The app: first version live 2 October 2026 (markets, coin pages with options panel, options overview, flow). Next: regime history replayed over past bars for the chart, refinement to Reflex-grade polish.
4. Radar from Derive's wallet-level trade flow (best wallets over time, large options flow); a first Flow page exists. Landing rebuilt with the brand (done); keep refining. Derive's V3 docs describe public trades as anonymised, so the radar may lose wallet detail when V3 replaces V2.
5. Options traders: cone, option levels, options lean, taker positioning and the history rebuild (`history_once.py`, from December 2023, catching up in the Action) built 2 October 2026; study rules approved. Alignment grid and wallet tiers built 2 October 2026. Next: the study (part 2) once the history has caught up.
6. Later, with the owner's explicit approval: execution on Derive perps (testnet, dry-run first); a vault on Derive V3 (design doc first).

## Findings so far

- Derive's surface tracks the wider market closely; V3 testnet copies mainnet prices almost exactly (only open interest differs). Build on testnet, research on mainnet data only.
- ETH open interest on Derive is mostly calls (put/call ~0.07 vs ~0.38 for BTC), probably call-selling vaults (unverified): treat ETH put/call as structure, not sentiment.
- V2 refuses some default library user agents (HTTP 403); the client sends its own.
- V3 public trades (checked 2 October 2026): the docs call them "anonymized", yet the response schema still requires `wallet` and `subaccount_id`, and V3 testnet returns addresses (mostly one testing wallet). Whether mainnet keeps real wallets is unknown until it launches. The V2 history already rebuilt stays; only live wallet tracking is at risk. Unfiltered V3 queries are limited to a 30-day window (the recorder reads every 15 minutes, so unaffected).
- Derive writes fractional strikes with an underscore (`XRP-20260828-1_35-P` is 1.35). Python's `float("1_35")` returns 135 and JavaScript's `Number("1_35")` is NaN: always replace "_" with "." (found 3 October 2026; it had inflated one wallet to $39M of options PnL and skewed recorded strikes for XRP, HYPE, ADA, LIT, PUMP, VVV until then; `history_once.py` re-reads the affected days once).
- V3 mainnet has no date in Derive's docs; the move is described as awaiting a governance vote.

## Owner's standing rules

- Minimal visible text; visuals first; explanations behind (i) popovers.
- No emojis. No pills: tabs are underlined text.
- No blinking or pulsing status dots. Price flashes and loading spinners are fine.
- No forecast words in the UI (will, expect, likely, predict, target, probability, odds): show what happened, not what will. Options screens usually show "probability ITM"; this one does not. The priced range is labelled as what option prices imply, not our view.
- Never show the word "Larsson" in the UI; keep the paid data it refers to out of the repo. Its engine is kept and published as `ribbon`.
- Research follows a declared-study protocol: rules committed before results are computed; verdicts only when the declared bar is met, otherwise "context, not a signal".
- Costs stay low (target: zero added cost): fetch once, serve everyone; users never trigger their own exchange reads.
- No security details in code comments or docs.
- Live or paper trading changes need the owner's explicit approval.

## Derive specifics

- Read the docs from source, never guess: index `https://docs.derive.xyz/llms.txt`, specs `/openapi.json`, `/websocket.asyncapi.json`, `/subscriptions.asyncapi.json`.
- V2 mainnet (`api.lyra.finance`) and V3 (`api.derive.xyz/v3`, testnet `testnet.api.derive.xyz/v3`) return the same compact ticker shape (`option_pricing`: `i` mark IV, `d` delta, `f` forward; `stats.oi` contracts; `I` index, `M` mark). Options tickers need `currency` and `expiry_date` (YYYYMMDD). V2 lists instruments with `public/get_instruments`; V3 with paginated `public/get_all_instruments`.
- Funding is quoted per hour (annualised = rate x 24 x 365).
- Retryable errors: HTTP 429/5xx, JSON-RPC -32000 (rate limit) and 9002 (backend unavailable).
- Trading, when approved: testnet and dry-run by default, session keys only (trading scopes, one subaccount, expiry), owner key never on the server, secrets in the environment only. derive-py (0.1.3) is the reference for EIP-712 signing; the testnet domain separator is in its `config/contracts.py`.

## Working in this repo

```
cd backend
pip install -r requirements-dev.txt
python -m pytest
python main.py
```

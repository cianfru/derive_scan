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
- Repo growth (2 October 2026): roughly 4 MB/day (chains ~2.3, option CSV ~1.5, flow ~0.5), about 1.4 GB a year. Before the repo nears 1 GB (around month 8), move old chains and flow out of git (e.g. release assets).
- App (2 October 2026): `frontend/` React + Vite + lightweight-charts, deployed on Vercel (project `torq`, root `frontend`, framework vite, production from `main`, previews off). Routes: `/` landing, `/markets`, `/coin/:und` (candles, ribbon, signal markers, readout, positioning, options panel: open interest by strike, term structure, volatility by strike, 14-day IV and skew, priced range), `/options`, `/flow`. Reads only the `site-data` branch (`backend/publish_site.py`, rebuilt every run and force-pushed as one commit, so it keeps no history); `VITE_DATA_URL` overrides for local previews.
- Brand (owner, 2 October 2026): logo files in `frontend/public/brand` (on-dark and on-light versions, mark for icons). Corporate colours orange and dark grey; very dark graphite ground with an industrial plate/rivet pattern; chamfered corners echo the logo. Type: Chakra Petch (display, blocky, cut corners, close to the logo), Barlow (body), IBM Plex Mono (numbers). Tokens in `frontend/src/styles.css`; dark first, light supported.
- Not built: the radar proper, V3 source (one setting, `DERIVE_SNAPSHOT_SOURCES=v3_mainnet`, once V3 mainnet is live).
- Trading (plan Phase 2) is not in the repo. It needs the owner's explicit approval; order mechanics come from Derive's docs.

## Product direction (owner, 2 October 2026)

- Torq is an independent product: Reflex-grade feel and quality, its own identity. No mention of Reflex in the UI, landing page or public copy; the link to Reflex lives only in internal docs (code provenance).
- Core: the signal engine (ported from Reflex) on Derive's perps. Differentiator: options, shown as visual market structure (what traders pay for protection, where open interest sits, how the surface is shaped), made easy to read. No options study: options are context presented visually, never a claimed edge. Any claim that a feature improves the signals would still need a declared study.
- Quality bar: excellent UI, refined, fast, clean, no friction, easy to understand.

## Roadmap (approved 2 October 2026)

1. Data foundations: done 2 October 2026 (backfill, options for every coin, trade flow).
2. Torq design system: first version done 2 October 2026 (`frontend/src/styles.css`); refine with the owner.
3. The app: first version live 2 October 2026 (markets, coin pages with options panel, options overview, flow). Next: regime history replayed over past bars for the chart, refinement to Reflex-grade polish.
4. Radar from Derive's wallet-level trade flow (best wallets over time, large options flow); a first Flow page exists. Landing rebuilt with the brand (done); keep refining. Derive's V3 docs describe public trades as anonymised, so the radar may lose wallet detail when V3 replaces V2.
5. Later, with the owner's explicit approval: execution on Derive perps (testnet, dry-run first); a vault on Derive V3 (design doc first).

## Findings so far

- Derive's surface tracks the wider market closely; V3 testnet copies mainnet prices almost exactly (only open interest differs). Build on testnet, research on mainnet data only.
- ETH open interest on Derive is mostly calls (put/call ~0.07 vs ~0.38 for BTC), probably call-selling vaults (unverified): treat ETH put/call as structure, not sentiment.
- V2 refuses some default library user agents (HTTP 403); the client sends its own.
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

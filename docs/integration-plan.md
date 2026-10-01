# Reflex × Derive — Integration Plan (for Claude Code)

> Repo: `github.com/cianfru/RCCE_Scanner` (FastAPI + React + PostgreSQL; backend on Railway, frontend on Vercel)
> Target venue: **Derive V3 API — testnet only** (`https://testnet.api.derive.xyz/v3`, `wss://testnet.api.derive.xyz/v3/ws`)
> Status context: Derive V3 + Derive Chain wind-down is a **governance proposal (DIP, 14 Sep 2026), not yet approved**. No mainnet date. Build against V3 testnet; mainnet switch is a config change later.

> **Status, 1 October 2026.** Phase 1 (recorder) is built and live; see CLAUDE.md for where things stand. This is its own product in its own repo and does not use Reflex's signals (Phase 2 as written below, which routes Reflex signals, is superseded: any trading work starts from Derive's docs and needs the owner's approval). Open question 4 is answered yes: V2 mainnet public data is recorded now.

---

## 0. Ground rules (read first)

1. **Explore before writing.** Read the repo layout, the existing regime/signal engine, DB models, config/env handling, scheduler (if any), and how the frontend consumes the API. Match existing conventions (naming, async style, ORM, migrations tool). Report a short summary of findings before Phase 1 code.
2. **Read the Derive docs from source, don't guess.** Index: `https://docs.derive.xyz/llms.txt`. Machine-readable specs: `/openapi.json`, `/websocket.asyncapi.json`, `/subscriptions.asyncapi.json`. Agent guide: `/skill.md`. Migration notes: `/migrating/breaking-changes.md`. Verify every method name, param and response field against these.
3. **SDK:** Derive ships `derive-py`. Evaluate it first (install, signing helpers, WS support, async compatibility). Fall back to a thin custom JSON-RPC client only if it doesn't fit our async FastAPI stack — document why.
4. **Safety, non-negotiable:**
   - Testnet only. Network chosen via `DERIVE_ENV=testnet|mainnet`; refuse to start with `mainnet` unless `DERIVE_ALLOW_MAINNET=true`.
   - Execution is **dry-run by default** (`DERIVE_EXECUTION_MODE=dry_run|live`).
   - Owner wallet private key **never** on the server. Only a **session key** with trading scopes, **no withdrawal/transfer scopes**, restricted to one subaccount, IP-allowlisted where possible, with expiry.
   - Secrets via env only; never logged. Add them to `.env.example` with placeholders.
   - Core strategy logic stays server-side (IP protection).
5. **Don't touch RCCE signal logic** in Phases 1–2. Derive is a consumer of existing signals plus a new data source. Changes to the regime model come in Phase 3 behind a flag.
6. Small PR-sized commits per phase, tests included, no breaking changes to existing endpoints.

---

## Phase 1 — Derive data snapshotter (start here)

**Goal:** begin recording data Derive doesn't expose historically (especially the IV surface), so we have a backtest dataset when V3 goes live.

### 1.1 Module skeleton
```
backend/derive/
  __init__.py
  config.py        # env parsing: DERIVE_ENV, URLs, keys, mode, universe
  client.py        # JSON-RPC over HTTP + WS (heartbeats, reconnect w/ backoff, rate-limit aware)
  instruments.py   # instrument discovery + name parsing (see /trading/instrument-names.md)
  snapshotter.py   # scheduled collectors
  models.py        # DB models (follow repo's ORM)
  api.py           # FastAPI router: /derive/*
```

### 1.2 Collectors (every 15 min unless noted; configurable)
| Collector | Method | Store |
|---|---|---|
| Instruments catalogue (hourly) | `public/get_all_instruments`, `public/get_all_live_instruments` | instrument table (name, type, underlying, strike, expiry, option type, risk universe) |
| Risk universes (daily) | `public/get_risk_universes` | raw JSON + parsed |
| Option + perp tickers | `public/get_tickers` (per type/currency) | `derive_ticker_snapshots`: ts, instrument, mark, index, bid/ask, IV (mark/bid/ask if present), delta/gamma/vega/theta, OI, 24h vol |
| Funding | `public/get_funding_rate_history` | funding candles |
| Perp premium | `public/get_perp_impact_twap` | basis TWAPs |
| Index candles | `public/get_index_chart_data` | OHLC |
| Liquidations | `public/get_liquidation_history` | auctions table |
| Lending rates (daily) | `public/get_interest_rate_history` | rates |

Underlyings: start with **BTC, ETH** (Prime universe); make the list config-driven so HYPE/SOL/XAUT can be added.

### 1.3 Derived features (computed on write or via view)
Per underlying per snapshot:
- ATM IV per expiry (interpolate by delta≈0.5 or by strike nearest forward)
- IV term structure: 7d / 30d / 90d constant-maturity interpolation
- 25Δ risk reversal (call IV − put IV) and 25Δ butterfly
- Put/call OI ratio
- Funding (annualised) and perp basis

Store features in a narrow table: `(ts, underlying, feature, value)` or wide — pick what fits the existing schema style.

### 1.4 Ops
- Run on the existing scheduler if there is one; otherwise APScheduler inside the FastAPI app with a lock to avoid double-runs on multiple workers.
- Respect rate limits (`/rate-limits.md`, `public/getRateLimits`); exponential backoff on errors; log error codes per `/error-codes.md`.
- Watch storage: estimate rows/day for the option chain and add retention or downsampling (e.g. keep 15-min for 90 days, hourly after). Report the estimate.
- Config flag `DERIVE_SNAPSHOT_ENV` so we can snapshot **mainnet V2 public data** too if V3 testnet data is synthetic/thin — check what testnet data looks like and report.

### 1.5 API + UI (minimal)
- `GET /derive/surface/{underlying}` → latest term structure + skew
- `GET /derive/features/{underlying}?from&to` → feature time series
- Frontend: one panel in the existing dashboard style (IBM Plex Mono dark terminal) showing ATM IV term structure, 25Δ RR, funding. No new design system.

### 1.6 Done when
- Collectors run unattended for 24h on testnet with no crashes; tests cover instrument parsing, feature math (ATM interpolation, RR), and client reconnect.

---

## Phase 2 — Perp execution of existing Reflex signals (testnet)

**Goal:** route existing RCCE regime signals to Derive perps. Lowest-risk port; the existing walk-forward backtest still roughly applies to this.

### 2.1 Auth
- Implement session-key login per `/authentication/session-login.md` and EIP-712 action signing per `/authentication/action-signing.md` (use `private/order_debug` to verify our encoding matches the server's).
- Provide a one-off CLI script (run locally by the owner, **not** on the server) to register the session key with `private/set_session_key`: trading scopes only, single subaccount, expiry, IP allowlist. Document the steps in `backend/derive/README.md`.

### 2.2 Executor
```
backend/derive/
  strategy_perp.py   # RCCE signal → target position (size, side)
  risk.py            # limits: max notional/underlying, max leverage, daily loss stop, kill switch
  executor.py        # reconcile target vs actual → orders
```
Flow per signal tick:
1. Read current RCCE regime/signal for BTC/ETH (existing engine — do not modify).
2. Map to target position via a **config table** (regime → target exposure %). Keep the mapping explicit and documented.
3. `private/get_positions` + `private/get_open_orders` → compute delta to target.
4. Pre-trade: `private/order_quote` (or `public/order_quote`) + `public/get_margin` with simulated change → reject if risk limits breached.
5. Place: limit orders with `time_in_force` per config; large changes via `algo_type: twap` (`algo_duration_sec`, `algo_num_slices`). Always set `max_fee` with a buffer. Use `label` = `reflex-<signal_id>` for bulk cancel.
6. Protective stops: trigger orders (`trigger_type: stoploss`, `trigger_price_type: mark`).
7. Subscribe to `subaccount_orders`, `subaccount_trades`, `subaccount_balances` channels; persist fills.
8. In `dry_run` mode: do everything up to step 4, log the would-be order, never sign/send.

### 2.3 Persistence + UI
- Tables: `derive_orders`, `derive_fills`, `derive_positions_snapshots`, `derive_pnl_daily`.
- Dashboard panel: current position vs target, open orders, fills, PnL, kill-switch button (auth-protected).

### 2.4 Fees to model (from `/integrators/trading/trading-fees.md`, re-verify)
- Perps: taker $0.01 + 0.03% notional; maker 0.01% notional.
- Options (Phase 4): taker $0.5 + min(0.03% notional, 12.5% premium); maker min(0.01% notional, 12.5% premium).

### 2.5 Done when
- 1 week of dry-run logs reviewed, then live on testnet with tiny size; reconciliation never drifts; kill switch tested; restart-safe (no duplicate orders after a crash — use idempotent labels/nonces).

---

## Phase 3 — IV features into the regime model (behind a flag)

- Once Phase 1 has ≥4–6 weeks of data, evaluate adding: IV percentile (30d ATM), term-structure slope, 25Δ RR, funding z-score, liquidation-auction intensity.
- Offline notebook/script first: correlation with existing RCCE regimes and forward returns. Report findings before wiring anything.
- If useful, add as **filters/confirmations** (`RCCE_USE_DERIVE_FEATURES=false` by default), not as replacements for existing logic.

## Phase 4 — Options structure selector (design only until Phase 3 data exists)

Regime × IV-percentile → structure, executed via RFQ (`private/send_rfq` → `private/poll_quotes` → `private/execute_quote`; dry-run with `private/rfq_get_best_quote`):

| Regime \ IV | Low | High |
|---|---|---|
| Bull / markup | long calls / call spreads | short puts or long perp |
| Neutral | short strangle + perp delta hedge | iron condor |
| Distribution / early bear | put spreads | collar |
| Capitulation | long calls | short puts |

Deliverable in this phase: a design doc + backtest harness on recorded surface data. **No live options trading** until reviewed.

## Phase 5 — Vault (later)
- Evaluate `private/create_vault` (curator flow, fees, high-water mark) and builder fees / broker program. Design doc only.

---

## Config / env (add to `.env.example`)
```
DERIVE_ENV=testnet
DERIVE_ALLOW_MAINNET=false
DERIVE_HTTP_URL=https://testnet.api.derive.xyz/v3
DERIVE_WS_URL=wss://testnet.api.derive.xyz/v3/ws
DERIVE_WALLET_ADDRESS=
DERIVE_SESSION_KEY_PRIVATE=
DERIVE_SUBACCOUNT_ID=
DERIVE_EXECUTION_MODE=dry_run
DERIVE_UNDERLYINGS=BTC,ETH
DERIVE_SNAPSHOT_INTERVAL_SEC=900
DERIVE_MAX_NOTIONAL_USD=1000
DERIVE_DAILY_LOSS_STOP_USD=100
```

## Open questions to surface to the owner (don't block on them — pick a sensible default and flag it)
1. Does the existing engine expose signals via a function call, DB table, or HTTP? (Determines the Phase 2 integration point.)
2. Railway Postgres storage budget for the option-chain snapshots — acceptable growth per month?
3. Run the snapshotter on Railway or on a self-hosted machine?
4. Should we also snapshot **mainnet V2 public data** now for a real-market dataset before V3 launches?

## First task for this session
Phase 0 exploration summary → then Phase 1.1–1.2 (client + instrument discovery + ticker collector for BTC/ETH on testnet) with tests. Stop and report before Phase 2.

# Derive Scan

Options-aware scanner for Derive (derive.xyz): perps plus the options volatility surface. Its own product, separate from Reflex (`cianfru/RCCE_Scanner`). Backend: FastAPI in `backend/`. No frontend yet.

## Scope: what comes from Reflex and what does not

- Copy Reflex's infrastructure and data-ingestion patterns only: fetch once and serve everyone, ETag/304, serving the last good data with its time, egress and storage readouts, rate limits, edge cache and access codes when there are users, the frontend stack and visual style.
- Do not copy Reflex's analysis or anything Hyperliquid-specific: no RCCE regime/signal logic, no Reflex executor rules, no wallet tracking, no Hyperliquid market quirks (e.g. its `k` markets). Do not read Reflex's API.
- Do not change the Reflex repo for Derive work. An options panel was added to Reflex (#197) and reverted (#198) for this reason.

## Where things stand (1 October 2026)

- Recorder: scheduled GitHub Action `.github/workflows/record.yml` (fires every 5 minutes, records each 15-minute slot once) committing plain files to the `data` branch; layout in README. Free on a public repo; no server. Records Derive V2 mainnet (`api.lyra.finance`) BTC and ETH; raw chains hourly. Scheduled workflows only run from the default branch.
- Railway is being retired to cut cost (owner's request, 1 October 2026): the service recorded from 1 October 12:00 UTC until the Action took over; that early SQLite data was not migrated. The FastAPI app (`backend/main.py`) stays for local use, not deployed.
- Repo growth: ~2 MB/day of chains plus ~0.5 MB/day of CSV, about 100 MB over the 6-week study window. Past ~6 months move old chains out of git (e.g. release assets) before the repo nears 1 GB.
- Not built: frontend (plan: static site reading the `data` branch files, so users never reach Derive and nothing runs per user), V3 source (one setting, `DERIVE_SNAPSHOT_SOURCES=v3_mainnet`, once V3 mainnet is live).
- Trading (plan Phase 2) is not in the repo. It needs the owner's explicit approval and starts from Derive's docs, not from Reflex's strategy.

## Next steps (agreed)

1. Own small frontend (same stack and style as Reflex, Derive screens only; owner gives design guidelines first), starting with the volatility surface: term structure by expiry, 25-delta skew, priced 30-day range, and the 30-day history as it builds.
2. After 4-6 weeks of recorded data: a declared study (rules committed first) of what the surface features tell us. Until then every feature is "context, not a signal".
3. Later, only with evidence and V3 mainnet live: a vault on Derive V3 (design doc first).

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
- Never show the word "Larsson" in the UI; keep the paid data it refers to out of the repo.
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

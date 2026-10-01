# Derive Scan

Options-aware scanner for Derive (derive.xyz): perps plus the options volatility surface. A separate product from Reflex (`cianfru/RCCE_Scanner`), built on the same principles. Backend: FastAPI in `backend/`. No frontend yet.

## Plan

`docs/integration-plan.md` is the phased plan. Phase 1 (data recorder) is built. Phase 2 (trading) needs the owner's explicit approval before any work starts.

## Owner's standing rules (shared with Reflex)

- Minimal visible text; visuals first; explanations behind (i) popovers.
- No emojis. No pills: tabs are underlined text.
- No blinking or pulsing status dots. Price flashes and loading spinners are fine.
- No forecast words in the UI (will, expect, likely, predict, target, probability, odds): show what happened, not what will. Options screens usually show "probability ITM"; this one does not.
- Never show the word "Larsson" in the UI; keep the paid data it refers to out of the repo.
- Research follows a declared-study protocol: rules committed before results are computed; verdicts only when the declared bar is met, otherwise "context, not a signal". Volatility-surface features are context until a declared study says otherwise.
- Costs stay low: fetch once, serve everyone; users never trigger their own exchange reads.
- No security details in code comments or docs.

## Derive specifics

- Read the docs from source, never guess: index `https://docs.derive.xyz/llms.txt`, specs `/openapi.json`, `/websocket.asyncapi.json`, `/subscriptions.asyncapi.json`.
- V2 mainnet (`api.lyra.finance`) and V3 (`api.derive.xyz/v3`, testnet `testnet.api.derive.xyz/v3`) return the same compact ticker shape. Options tickers need `currency` and `expiry_date` (YYYYMMDD).
- V3 testnet marks copy the real market but its order books and open interest come from bots: build against it, research on mainnet data only.
- Funding is quoted per hour.
- Trading, when approved: testnet and dry-run by default, session keys only (trading scopes, one subaccount, expiry), owner key never on the server, secrets in the environment only.

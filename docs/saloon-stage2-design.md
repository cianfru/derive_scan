# Saloon stage 2: one-tap answers through Derive

Cowboy. 4 October 2026. A design for the owner's approval. **No trading code is written until the owner approves it** (CLAUDE.md: "Live or paper trading changes need the owner's explicit approval"). It is written for the owner and for whoever builds the feature.

It builds on:
- `docs/questions-design.md` (stage 1, and the stage 2 outline in its section 7);
- the Saloon code as it stands: `backend/derive/questions.py`, `frontend/src/pages/Questions.jsx`, `components/QuestionTicket.jsx`, `lib/questions.js`, `lib/positions.js`;
- Derive's docs, read from source on 4 October 2026 (`https://docs.derive.xyz/llms.txt`, the pages it lists, and `/openapi.json`);
- public, read-only calls to V3 testnet (`testnet.api.derive.xyz/v3`) and V2 mainnet (`api.lyra.finance`) on 4 October 2026 around 04:20 UTC. No private endpoint was called, and no key or account was created.

**In one paragraph.** Stage 2 turns each Saloon answer into one tap. The user's own browser asks Derive for a firm price on the whole package (an RFQ) and shows that price with Derive's fees and the most the user can lose. One tap fills every leg at once. The fill is signed by a small key that lives only in the user's browser. That key can trade Saloon answers in one Derive account set aside for the Saloon, for a week, and can never withdraw or move money. Cowboy runs no server and holds no keys. The plan is to build on Derive V3 testnet now: dry run first, then testnet fills. Mainnet waits for V3 mainnet, which has no date yet, and for the owner's approval.

---

## 0. What the research found

| Question | Answer, with source |
|---|---|
| Does RFQ work for small retail takers? | **Yes, on both networks.** V2 mainnet public trade history (BTC and ETH options, about 3.6 days to 4 Oct) holds 1,011 RFQ executions. Their sizes run from 0.002 contracts to 5,000, with a median of 0.6. 332 executions were under 1 contract. They were 1-leg (326), 2-leg (291), 3-leg (17) and 4-leg (7); one 4-leg fill was a BTC 86/87/88/89 call condor. V3 testnet holds 25 RFQ executions over about 8.5 days, mostly 2-leg call spreads of 0.01 contracts. |
| Can a fill be one atomic package? | Yes. "Multi-leg RFQs ... fill all-or-nothing at a single `total_cost`" (RFQ Trading). This removes stage 1's leg risk. |
| Can a firm price be shown without trading? | Yes, but only with an account. `private/rfq_get_best_quote` with an open `rfq_id` returns the best maker quote, `estimated_total_cost`, `estimated_fee`, `suggested_max_fee`, `orderbook_total_cost` and `post_initial_margin`, and creates nothing. Without an `rfq_id` it returns only estimates at mark. `public/order_quote` covers one instrument and needs a signed order for an existing subaccount, so it cannot price a package. `public/execute_quote_debug` checks a signed execution byte for byte and fills nothing. |
| Session keys | `private/set_session_key`: the owner wallet signs an EIP-712 action that grants a new key protocol scopes, a list of subaccounts and an expiry. `trade:rfq:option` is enough for every RFQ call on option legs. An empty subaccount list means **all** subaccounts, so Cowboy must always pass exactly one. A key is retired by setting it again with a nearer expiry, which takes effect after a cooldown of 5-15 minutes. The key's expiry must be at least 5 minutes. |
| Accounts | On V3 the user's own Ethereum wallet owns the account. There is no separate "Derive Wallet". The first deposit creates the subaccount, plus a fallback subaccount. A deposit can come from a direct L1 contract call or from a per-user deposit address (`public/register_deposit_address`, public and unsigned). Derive's own app bridges from other chains through Li.Fi. |
| Which manager | BTC and ETH options sit in the **PRIME** universe. On V3 testnet its Standard manager is `manager_id` 1 (Portfolio is 5). Other coins sit in separate universes: MIDCAP (HYPE), ALT (SOL, XRP, ZEC, ADA, CC, LIT, PUMP, VVV) and RWA (XAUT). Each needs its own subaccount, because trades never cross universes. The minimum deposit is $5 per collateral on testnet (`min_deposit_usd`). |
| Calling Derive from a browser | **Use the WebSocket.** On 4 Oct, a V3 testnet HTTP preflight listed the `X-Derive*` headers as allowed but returned no `Access-Control-Allow-Origin`, even for Derive's own testnet app origin. A WebSocket from a foreign origin connected and answered `public/get_time`. The TypeScript SDK `@derivexyz/derive-ts` (3.0.29, 2 Oct 2026, MIT) uses the browser's own WebSocket and recommends session keys "for bots and frontends". |
| Builder fee unit | Evidence points to a **total in USDC per order**, not per contract. On V3 testnet, book trades carry `extra_fee` of 0.25 on 1 contract and also 0.25 on 0.01 contracts; smaller values look like part-fills of the same order. `extra_fee` is accepted on `send_rfq` and `rfq_get_best_quote`. `execute_quote` takes `referral_code` but has no `extra_fee` field. |
| V2 vs V3 | V2's docs are no longer hosted, and V2 uses a smart-contract "Derive Wallet" on Derive Chain. V3 has full docs, an SDK, and plain Ethereum wallets. V3 mainnet has no date (CLAUDE.md). |

Open points to confirm on testnet or with Derive are collected in 7.0.

**Status (4 October 2026).** The owner approved the plan; P1 to P5 are built behind `VITE_SALOON_TRADE` (README "Saloon stage 2"). Built as designed, with these notes:
- P2 uses a thin JSON-RPC client over the browser's WebSocket plus the SDK's action encoders (`@derivexyz/derive-ts/codecs`) and ethers, rather than the SDK's client: the client signs with a raw key, while the owner's grant has to go through the browser wallet's `eth_signTypedData_v4`, and it pulls in a Node WebSocket package.
- `public/execute_quote_debug` signs over the subaccount's real owner (it reads the owner from the subaccount, not from the request), and the browser's encoding matched it byte for byte on V3 testnet.
- `private/get_pending_deposits` reports new-subaccount deposits under subaccount 0, so the Saloon account is found after the first deposit as the one new, unlabelled PRIME Standard subaccount, then labelled "Cowboy".
- The session key holds no off-chain scope (the SDK's default would add `account_info`).
- Sell back is in the maths and the dry run but not on screen: it needs positions in the Saloon account, which come with P6.

**P6 (4 October 2026, owner's approval: real fills on V3 testnet only).** Built as in the P6 section, with these notes:
- `execute_quote`'s answer carries no trade ids; the fill is read from `private/get_trade_history` by the taker's own quote id (a taker's trade rows carry the taker's quote id, not the maker's, as V3 testnet's public trades show), else by RFQ id.
- Settlement of testnet positions uses the testnet's own settlement price (`public/get_option_settlement_prices`), not the mainnet price the board publishes.
- The caps on testnet are the mainnet ones the owner approved for P6 ($250 per answer, $1,000 a day), not the $1,000 per answer proposed in section 6.
- My seat is "Positions"; its one-tap records live in the testnet journal (`cowboy-questions:testnet`), matched to Derive's positions by their legs.

---

## 1. The user's journey

In this table, "Signs" means a prompt in the user's own wallet. "Gas" means an Ethereum transaction the user pays for in ETH. Everything else is off-chain and free.

| Step | What the user sees and does | Signs | Gas |
|---|---|---|---|
| 1. First visit | The Saloon as today. Every answer carries its board price and a **Buy** button (stage 1's "I placed it" ticket stays as a fallback). | none | none |
| 2. Connect wallet | **Connect wallet** (an injected browser wallet; EOAs only at first). Cowboy reads the wallet's Derive subaccounts. | one login message (EIP-191, a timestamp) | none |
| 3. Check who may use Derive | One-time notice: Derive's restricted persons, linked to Derive's Terms, with a checkbox. Cowboy keeps the answer in this browser. | none | none |
| 4. Fund the Saloon account | **Add USDC.** Cowboy shows a deposit address registered for (this wallet, a new subaccount, PRIME Standard manager). The user sends USDC on Ethereum from the connected wallet (one button) or from an exchange. Coming from another chain: a link to Derive's own deposit screen. Cowboy shows "Arriving" until Derive credits it (about 2 minutes of confirmations, then the batch), then "Ready: $X". | the wallet's transfer | **yes**: one ERC-20 transfer on Ethereum (or the bridge's fees on the source chain) |
| 5. Approve Cowboy once | **Let Cowboy place Saloon trades.** A panel spells out the grant: "Buy and sell Saloon answers in your Saloon account · for 7 days · nothing else. Cowboy cannot withdraw, transfer, or touch your other Derive accounts. You can switch this off at any time." The browser makes a new key, and the wallet signs the grant. | one EIP-712 signature (the session-key action) | none |
| 6. Pick an answer and amount | As today: the question, Yes or No, the amount ($25 / $100 / $500 or typed), the pay zone, "Pays up to", "Most you can lose". | none | none |
| 7. See the firm price | **Get price.** The browser sends an RFQ to Derive and shows the best firm quote within a few seconds: "38c per $1 · firm for 12 s". Below it: "Derive fees $1.62", "Most you can lose $101.61", "Pays up to $264". If the quote is worse than the board allows (2.4), the screen says so and asks again. | none | none |
| 8. Confirm | **Buy for $101.61.** One tap. The key in the page signs the fill, and Derive fills all legs at once. "Done · in My seat". | none (the session key signs) | none |
| 9. My seat | Each answer shows what was paid, its value at Derive's mark ("Now worth about $112"), the countdown, and **Sell back**. Derive's own positions are the record. | none | none |
| 10. Sell back | **Sell back** sends the same package as an RFQ in the other direction and shows the firm amount: "Sell for $108.40 · firm for 12 s". One tap. | none | none |
| 11. Settlement | From 07:30 UTC the answer reads "Settling". Derive settles at the 30-minute average to 08:00 UTC and pays USDC into the Saloon account. My seat then shows "Got $X (74c per $1)" from Derive's settlement history. | none | none |
| 12. Take money out | **Withdraw on Derive** (a link; stage 2 does not build withdrawals). The wallet signs a withdrawal there, and Derive charges a small sequencer fee. | owner signature on Derive | Derive pays the L1 batch; the user pays the sequencer fee in USDC |

**Minimum sensible deposit.** Derive's floor is $5 (testnet `min_deposit_usd`). A deposit below the subaccount-creation fee lands in the fallback subaccount, where it cannot trade. The real floor is set by the smallest ticket:
- BTC trades in 0.01 contracts. On a $6,000 zone that is $60 of payout for about $24.
- ETH trades in 0.1 contracts. On a $200 zone that is $20 of payout.

Proposal: suggest **$50 or more**, and refuse below $10. Before the user sends, show the wallet's own gas estimate. If gas is over 5% of the deposit, say so plainly: "Ethereum fee about $3.10, 6% of this deposit."

**Why a separate Saloon account.** A new subaccount, created by the first deposit through Cowboy and labelled "Cowboy", keeps Saloon money apart from anything else the user holds on Derive. The session key is limited to that one subaccount. The most a misused key could reach is what the user chose to put there.

---

## 2. Architecture: everything in the browser

### 2.1 Who talks to whom

```
Board prices (unchanged)      GitHub Action -> site-data JSON -> every visitor  (fetch once, serve everyone)
The user's own trading        user's browser <-> Derive WebSocket               (the user trading for themselves)
Deposits                      user's wallet -> Ethereum (deposit address)        (the user's own transaction)
```

- **No Cowboy server.** Nothing holds keys, relays orders, or stores accounts. The app stays static on Vercel at no added cost.
- **This does not break the fetch-once rule.** That rule is about public market data: one read, published to everyone. Stage 2's private calls are the user operating their own Derive account from their own browser, the same as using Derive's app. Board prices, history and settlement prices still come only from published files. Ticket pages make no public market reads of their own.
- **WebSocket, not HTTP.** All private calls go over `wss://…/v3/ws` after `public/login`, because browser HTTP calls look blocked by CORS (section 0).

### 2.2 Calls the browser makes

| When | Call | Signed by |
|---|---|---|
| connect | `public/login` (owner, once per visit until a key exists), then `private/get_subaccounts`, `private/session_keys` | login: wallet (EIP-191) |
| fund | `public/register_deposit_address` (wallet, subaccount 0, manager PRIME Standard), `public/get_pending_deposits`; the user's wallet sends USDC | wallet transaction |
| approve | `private/set_session_key`: protocol scopes `["trade:rfq:option"]`, `subaccount_ids: [the Saloon subaccount]`, `expiry_sec` now + 7 days, label "Cowboy Saloon" | wallet (EIP-712) |
| every later visit | `public/login` signed by the session key (no wallet prompt) | session key |
| price | `private/send_rfq` (legs, `max_total_cost` for a buy or `min_total_cost` for a sell, `partial_fill_step`, `label` = question id and side, `referral_code`, `extra_fee` "0"), then `private/rfq_get_best_quote` with that `rfq_id` every 1-2 s while the ticket is open | none (an unsigned intent) |
| buy or sell | `private/execute_quote` (quote id, the quote's legs, `max_fee`, `enable_taker_protection: true`, `referral_code`) | session key (EIP-712 under the RFQ module) |
| close the ticket | `private/cancel_rfq` | none |
| My seat | `private/get_positions`, `private/get_rfqs` (filled, labelled), `private/get_option_settlement_history`; while the page is open, the `{subaccount_id}.balances` channel | session key login |
| status | `public/get_live_incidents` when a ticket opens | none |
| switch off | `private/set_session_key` for the same key with a near expiry | wallet (EIP-712) |

All of these are within Derive's standard trader limits (5 requests per second non-matching, bursts of 5x). `set_session_key` shares the wallet's 1-per-second "proven" budget.

### 2.3 The session key: where it lives, what it can do, and the risks

- **Where.** It is made in the browser, kept in this browser's storage for the Cowboy site only, and never sent anywhere. **Switch off** retires it on Derive and deletes it from the browser. A second device needs its own approval.
- **What it can do.** It can request quotes, fill and cancel RFQs on option legs, in the Saloon subaccount only, until it expires.
- **What it cannot do.** It cannot withdraw, transfer, create keys, use the order book, trade perps, or reach the user's other subaccounts. The protocol checks its scopes on every signed action.
- **The risk.** Anyone who can run code inside the Cowboy page (a compromised build or dependency, a malicious browser extension) could use the key until it expires. They could not take funds out. They could, however, trade the Saloon account's balance away at bad prices. Three things limit this:
  - Derive's maker price bands: RFQ quotes must sit within a spot shock of 1.5% for BTC and ETH;
  - the short expiry;
  - the user keeping only Saloon money in that account.

  The approval panel says this in one line, with (i): "Keep only what you use in the Saloon in this account."
- **The owner's rule holds.** The owner's key is never on any server. Cowboy's only "credential" is its public referral code.
- **Trading code is the trust boundary.** Changes to `lib/trade/` and the approval panel need the owner's review before merge, like trading changes in general.

### 2.4 How the ticket handles what can go wrong

| Case | Handling |
|---|---|
| **No quote** | Wait up to 10 s for a quote (makers answer RFQs; the RFQ itself stays open up to 30 minutes). Then show "No price from Derive right now", cancel the RFQ, and offer **Try again** and **Place by hand** (stage 1's ticket). Never fall back to book orders automatically. |
| **Price beyond the shown price** | The board price can be 5-30 minutes old. The RFQ carries a hard ceiling: `max_total_cost` = payout x min(board buy + T, 99c), with T = 2c for BTC/ETH and 3c for thin coins (decision 7). A sell carries a floor: `min_total_cost` = payout x max(board sell-back - T, 1c). A quote inside the ceiling is shown as it is, even when it is better than the board. A quote outside it is not offered: "Derive's price is 43c now; the board showed 38c." **Ask again** starts a new RFQ, and the user confirms the new number. |
| **Price changes after it is shown** | The Buy button carries the exact `total_cost` the user saw. Execution signs the quote's own legs and prices. If the best quote changed, the ticket refreshes the number and requires a fresh tap. It never fills at a number the user did not see. |
| **Quote lifetime** | A maker can pull a quote at any time. Cowboy shows each quote "firm for 12 s" (its own window, decision 7) and re-reads the best quote every 1-2 s. When the window lapses, the button changes to **Get a new price**. If execution fails with `quote_rfq_not_open` (11104), Cowboy re-reads quietly and asks for a fresh tap. |
| **Taker protection** | `enable_taker_protection: true`: Derive rejects a quote worse than the same package on its own book (11110). Shown as "Derive's screen has a better price; asking again". |
| **Fees beyond the estimate** | `max_fee` is `suggested_max_fee` from `rfq_get_best_quote`, capped at Cowboy's ceiling: the RFQ schedule estimate x 1.5 plus $0.50. A higher suggestion blocks the ticket: "Derive's fee is higher than usual right now." |
| **Partial fills** | `partial_fill_step` set to all-or-none (see 7.0: the docs default of "1" reads as a fraction of the RFQ, which is all-or-none). If a fill still comes back below 100% (`rfq_filled_pct` < 1), My seat shows exactly what filled, with "Filled $X of $Y". The rest is cancelled and never retried automatically. |
| **No answer after tapping Buy** | Never re-send. Read `private/get_rfqs` and positions until the RFQ shows `filled`, `cancelled` or `expired`, and show "Checking your fill…" meanwhile. |
| **Margin** | Before showing Buy, require the initial margin used (`pre_initial_margin` - `post_initial_margin`) to be at most the package's price plus fee, so the package locks no cash beyond its price (corrected 5 October 2026: the first version required no change at all, which refused every purchase, since paying uses margin). Debit spreads under Standard margin need none (questions-design 2.1, measured on V2). This check confirms it on V3 for every ticket. |
| **Leg order** | It does not matter for risk: the package fills atomically. Legs are sent in a fixed order (by instrument name), with unique instruments, one currency, one expiry and equal amounts. A butterfly's body is a single leg of twice the amount. Instrument names keep Derive's underscore (`1_35`), and strikes are parsed with "_" as "." everywhere. |
| **Derive down or degraded** | A WebSocket drop, error 9002, a rate limit (-32000) or an open incident turns the buttons to an em dash with "Derive isn't taking orders right now". Positions are unaffected: they settle by Derive's rules whether or not Cowboy is up. If Derive's operator goes offline, withdrawals have an Ethereum "escape hatch" (Derive's design). Cowboy links to Derive's docs rather than building it. |
| **Compliance cancel** | An RFQ cancelled with reason `compliance` shows "Derive did not accept this trade" and links to Derive's Terms. Cowboy does not explain further. |
| **Board stale or paused** | The stage 1 rule holds: after 90 minutes, buying is off. A firm RFQ quote does not depend on the board, but the ceiling does, so stale means paused. **Sell back** stays available with a floor taken from Derive's mark (`rfq_get_best_quote` without `rfq_id`) minus T, because getting out must not depend on Cowboy's pipeline. |

### 2.5 Packages: one per answer, bought or sold

Stage 2 uses **debit forms only**. RFQ makers price the package as a whole, so the put-call twin that stage 1 uses to save on book spreads no longer helps much. Debit forms also lock no extra cash, and their wording is simplest.

| Answer | Legs (taker side when buying) |
|---|---|
| Yes, "above K" (zone lo-hi) | buy call lo, sell call hi |
| No, "above K" | buy put hi, sell put lo |
| Up / Down | the same as Yes / No at the headline level |

- Selling back is the **same legs with `direction: sell`**, so there is one package per answer.
- Contracts = payout / width, floored to Derive's amount step, as today (`lib/questions.js` `ticket`).
- The 2.2 example: $100 of Yes on BTC above $86,000 (83,000/89,000) is 0.04407 contracts.

---

## 3. "Between" questions through RFQ

A between question pays $1 when the settlement price is inside a band. On the screen it cost 12-30c over fair, so stage 1 left it out (questions-design 3.4). Through RFQ it becomes one package, with no leg risk.

| Answer | Package (s = one listed strike step) | Payout per $1 at settlement S |
|---|---|---|
| **Inside**: "BTC between $84,000 and $86,000 on Fri 9 Oct?" | call condor: buy call L-s, sell call L, sell call H, buy call H+s. Or a butterfly (buy L-s, sell 2 x K, buy K+s) when L = H = K. | $1 for L <= S <= H, a one-step ramp on each side, 0 outside |
| **Outside** (its No) | buy put L, sell put L-s, buy call H, sell call H+s (two debit spreads) | 1 minus the Inside payout, so Inside + Outside = $1 at every S |

- Both are debit packages and lock no extra cash.
- A sold condor would hold the full width as margin, so it is never used.
- 4-leg condors already fill by RFQ on V2 mainnet (section 0). The maximum number of legs is not published (error 11112 exists), so it goes on the list for Derive.

**How the price is shown.**
- **Board row:** "Between $84,000 and $86,000". Instead of a number, the button reads **Get price**: makers' RFQ pricing for these packages has not been measured, and the screen price is not fair. The (i) carries "At Derive's mark: about 47c" and the ramp picture.
- **After Get price:** the firm quote ("44c per $1 · firm for 12 s"), then the same fee, "Most you can lose" and "Pays up to" lines as above/below.
- **Ceiling:** the clipped mark of the package + 5c (decision 9). A quote above it shows "Derive's price is far from its mark right now".
- **Before between goes on mainnet:** measure RFQ fills of 3- and 4-leg packages against mark from V2 mainnet's public trade history, as was done for verticals. This uses public data only. Then decide whether the board can show a number.

---

## 4. Fees

**Derive's RFQ fees** (Trading Fees page):
- Both sides pay the taker notional rate (0.03% of index x contracts, capped at 12.5% of the option's price). The taker adds one $0.50 base fee per package.
- Legs are grouped into long calls, long puts, short calls, short puts and perps. The most expensive group pays in full, the cheapest group pays nothing, and the second and third cheapest pay half.
  - **Above/below (vertical):** one leg pays.
  - **Condor or butterfly:** two groups (longs, shorts), so only one group pays.
  - **Outside:** four groups. Full, half, half and free.
- Example, $100 of Yes on BTC above $86,000: 0.04407 contracts. The fee is $0.50 + 0.0003 x 84,823 x 0.04407 = **$1.62**, against $3.01 for two book orders.
- The V3 testnet fill of a 0.01 BTC call spread paid 0.526 on one leg and 0 on the other, as the schedule says (the 12.5% cap applied).
- The ticket shows `estimated_fee` from Derive. `total_cost` excludes fees.

**Builder fee (`extra_fee`), paid by the user to Cowboy.**
- It is set on `send_rfq`, together with `referral_code`, and is paid to the builder's Derive wallet every 4 weeks.
- The evidence reads it as a flat USDC amount per order (section 0); confirm with Derive.
- Size: $0.25 on the $100 example would add 0.1c per $1 of payout.
- **Proposal: zero** (`extra_fee: "0"`), as the owner wants, and no Cowboy fee anywhere.

**API Broker programme.**
- Cowboy passes its referral code on every `send_rfq` and `execute_quote` (`VITE_DERIVE_REFERRAL`, a public code; empty today).
- Derive then pays Cowboy 10% of its net exchange fees on referred trades, with higher tiers at large volume. That is about $0.16 on the $100 example.
- It costs the user nothing.
- Joining needs the application form, which names the payout wallet. Rewards start with the first referred trade, but the form must be in within two weeks of it.
- The same code can go on stage 1's "Open Derive" link.

**Lean start (proposed):** no Cowboy fee, no builder fee, the referral code on, and a revisit once volume exists.

---

## 5. V2 vs V3

| | V2 mainnet (live, `api.lyra.finance`) | V3 testnet (`testnet.api.derive.xyz/v3`) | V3 mainnet (`api.derive.xyz/v3`) |
|---|---|---|---|
| RFQ for small takers | works (fills from 0.002 contracts, 2-4 legs) | works (0.01-contract call spreads; few makers, and prices are not market prices: one fill priced a leg at 0) | as testnet, once live |
| Scoped session keys | existed, but the docs are no longer hosted | documented: `trade:rfq:option`, subaccount list, expiry | same |
| Account | smart-contract "Derive Wallet" on Derive Chain; deposits bridged to Derive Chain | the user's Ethereum wallet; deposit address or direct L1 call; testnet tokens are mintable in Derive's testnet app | same, real USDC |
| Signing domain | v2 constants | chainId 11155111 (Sepolia) | chainId 1 (Ethereum) |
| Docs and SDK | none hosted | full docs, `@derivexyz/derive-ts` 3.0.29 | same |
| Date | live | live | none ("awaiting a governance vote", CLAUDE.md) |

**What to build against: V3 testnet, then V3 mainnet. No V2 path.**
- A V2 build would rest on undocumented flows and a wallet model V3 removes. The move would then mean rewriting accounts, keys and signing.
- V3 testnet has everything stage 2 needs today, so the whole of stage 2 can be built and proven there.

**Migration impact.**
- Question ids key on expiry and strikes, so they carry over.
- The board switches source with the recorder (`DERIVE_SNAPSHOT_SOURCES=v3_mainnet`). Until then, board prices come from V2 mainnet while testnet trading uses V3 testnet instruments, which copy mainnet prices almost exactly (CLAUDE.md).
- A testnet ticket uses the same instrument names. A leg that does not exist on testnet gives "No price from Derive right now".
- Derive's migration moves V2 subaccounts to the user's own wallet. Cowboy's Saloon accounts start on V3, so there is nothing to migrate.

**Timeline risk.** Stage 2 cannot reach real users before V3 mainnet, which has no date. Stage 1 stays the live product meanwhile. If V3 mainnet slips by months, revisit then. Do not start V2 work now.

---

## 6. Safety and limits

1. **Testnet and dry-run first.** The build flag `VITE_SALOON_TRADE` takes `off` (default), `dryrun`, `testnet` or `mainnet`.
   - `dryrun`: the full flow up to the firm quote. The execution is signed and checked with `public/execute_quote_debug`, nothing fills, and the RFQ is cancelled.
   - `mainnet`: a production build only, after the owner's written approval.
2. **Caps** (decision 6). These are client-side guards against mistakes, not controls. The real limit is what the user deposits.
   - Per answer: "Most you can lose" up to **$250**.
   - Per day: **$1,000** of answers bought per wallet in this browser.
   - Testnet: $1,000 per answer.
   - The values sit in one `TRADE_LIMITS` object.
3. **Kill switch, at no added cost.** A `trading` field in the published `questions/index.json` takes `on`, `sell_only` or `off`, set from an Action variable (`QUESTIONS_TRADING`). The app reads the file it already loads, so the owner can stop buying, or all trading, within one publish cycle (5-15 minutes) without a redeploy. `sell_only` keeps getting out possible. A redeploy with the build flag at `off` is the hard stop.
4. **The worst case, always visible.** "Most you can lose: $X" sits above every Buy button. X = the quote's total cost + Derive's fee. The margin check in 2.4 guarantees nothing more is locked. The button carries the same number: "Buy for $101.61".
5. **Restricted persons.** Before the first approval, a one-time notice with checkbox. Derive's Terms exclude, among others, US persons, Australian tax residents, residents of Canada and Ontario, Panama residents and sanctioned regions, and limit UK access to professionals and high-net-worth entities (questions-design 8). The final wording comes from the owner's legal contacts. Cowboy does not geo-block on its own; that is part of decision 13.
6. **If Derive is down**, follow 2.4: buttons off, positions untouched, settlement by Derive's rules.
7. **Wording.** Every new string passes the existing stem wordcheck (`BANNED` in `lib/questions.js`). Proposed copy uses: "Get price", "firm for 12 s", "Buy for $X", "Sell for $X", "Most you can lose", "Pays up to", "No price from Derive right now", "Let Cowboy place Saloon trades", "Switch off". No chance, odds or forecast words; no "guarantee" or "risk-free".
8. **Market makers stay invisible.** `poll_quotes` returns the maker's wallet. Cowboy never shows or stores it, only the package price.

---

## 7. Build plan

### 7.0 Before any code (no code; the owner, Derive, the builder)

Owner decisions (section 8). Questions for Derive, sent with the data-consent email:
1. Is the WebSocket the supported route for browser apps, or will HTTP CORS allow third-party origins?
2. What is the maximum number of RFQ legs, and the minimum RFQ size?
3. Is `partial_fill_step` a fraction of the RFQ, so that "1" means all-or-none?
4. Do makers on V3 mainnet quote small retail packages (0.01-0.5 contracts)? Are there makers on testnet to test against?
5. Is `extra_fee` a USDC total per order (pro-rated on part-fills)?
6. Is it acceptable for a dry-run mode to send RFQs and cancel them, and at what rate?
7. Does taker protection work for packages with no equivalent on the book?
8. What is the mainnet subaccount-creation fee or minimum deposit?
9. Does Derive expect integrators to screen restricted persons themselves?
10. Do V2 and V3 mainnet overlap, and is there a date?

### P1. Package maths (pure functions)

**Files:**
- `frontend/src/lib/trade/package.js`:
  - the legs for Yes, No, Up, Down, Inside and Outside;
  - contracts from dollars;
  - `max_total_cost` and `min_total_cost` from the board and T;
  - the RFQ fee estimate (fee groups);
  - the fee ceiling;
  - quote checks (ceiling, margin unchanged, fee);
  - the caps and `TRADE_LIMITS`.
- `lib/trade/package.test.js`.

**Tests:**
- The 2.2 example: 0.04407 contracts and a $1.62 RFQ fee.
- Debit forms only.
- Legs unique, one currency, sorted.
- Inside + Outside payout = 1 at every price.
- Butterfly body at twice the amount.
- `1_35` round-trips.
- The ceiling never exceeds 99c per $1.

**Done when:** tests pass and nothing in the folder touches the network.

### P2. Derive connection in the browser

**Files:**
- `lib/trade/derive.js`: wraps `@derivexyz/derive-ts` over the browser WebSocket. It also handles:
  - the network (testnet or mainnet) from the flag;
  - error-code mapping to plain messages (11104, 11110, 11112, 9002, -32000, compliance);
  - the incident check;
  - a fake transport for tests.
- New dependencies: the SDK (with ethers) and a small wallet connector for injected wallets. They load only in builds with `VITE_SALOON_TRADE` other than `off`, as lazy chunks, so the research pages keep their size.

**Tests:**
- The fake socket replays recorded frames.
- Every error code maps to a plain message.
- A flag-off build contains no SDK code (bundle check).

**Done when:** a flag-off build is byte-identical in its research routes, and a testnet build connects to testnet and reads `public/get_time`.

### P3. Connect and fund (testnet)

**Files:**
- `components/SeatSetup.jsx`: connect, login, the restricted-persons notice, the deposit address (PRIME Standard, new subaccount), pending deposits, "Ready: $X".
- `lib/trade/account.js`: finding the Saloon subaccount by its label "Cowboy" and its PRIME manager.

**Tests:**
- Address registration uses manager PRIME Standard and subaccount 0.
- A wallet with an existing Cowboy subaccount reuses it.
- The minimum and gas warnings show.

**Done when:** on testnet, a fresh wallet mints test USDC in Derive's testnet app, deposits through Cowboy, and sees "Ready".

### P4. Approve Cowboy (testnet)

**Files:**
- `components/ApproveCowboy.jsx`;
- `lib/trade/sessionKey.js`: make, register, list, switch off.

**Tests:**
- The grant is exactly `["trade:rfq:option"]`, one subaccount id and 7 days.
- Registration is refused if the subaccount list would be empty, or if any other scope (admin, withdraw, transfer, `trade:all`) appears.
- Switch off sets a near expiry and clears the browser copy.
- The wallet prompt is preceded by the plain-English panel.

**Done when:** on testnet, `private/session_keys` lists the key with that one scope and one subaccount, and switch off retires it.

### P5. Dry run: the firm price, nothing filled (testnet, then mainnet with Derive's OK)

**Files:**
- `components/QuestionTicket.jsx` gains a stage 2 mode beside stage 1's ticket;
- `lib/trade/rfq.js`: send, re-read the best quote, check, sign execute → `public/execute_quote_debug`, cancel.

**Tests:**
- No-quote timeout.
- Ceiling breach shows "Derive's price is 43c now".
- Quote lapse.
- The debug result matches the local encoding.
- The RFQ is always cancelled on close.
- Wordcheck on every new string.

**Done when:** 20 dry runs on testnet (BTC and ETH, Yes and No, buy and sell back) each end in a shown firm quote or a handled "no price", the debug check matches every time, and the subaccount's trade history is empty.

### P6. Testnet fills, My seat, sell-back, settlement

**Files:**
- `lib/trade/rfq.js` execute;
- `pages/MyQuestions.jsx` reads Derive (positions, labelled RFQs, settlement history) as the record. `lib/positions.js` keeps stage 1's hand-placed entries, marked "Placed by hand".
- The kill switch: `trading` in `questions/index.json`, from `QUESTIONS_TRADING` in `record.yml`.

**Tests:**
- No resend after a timeout.
- A partial fill is shown as filled.
- `sell_only` hides Buy and keeps Sell back.
- `off` hides both.
- The caps.
- My seat matches a recorded set of positions and RFQs.

**Done when:** on testnet, at least 10 answers have been bought, 5 sold back and 5 held to an 08:00 settlement, and My seat agrees with Derive's own records to the cent.

### P7. Between through RFQ (testnet)

**Files:**
- Inside and Outside packages in `package.js`;
- the board rows with **Get price**;
- `backend/derive/questions.py` gains between rows (levels, the zone step, the clipped mark) with no buy prices.
- Before showing numbers on the board, a public-data study of V2 mainnet RFQ fills of 3- and 4-leg packages against mark.

**Done when:** dry runs and fills of Inside and Outside on testnet behave as in P5-P6, and the study is written up.

### P8. Mainnet (owner approval gate)

**Preconditions:**
- V3 mainnet is live;
- Derive has answered 7.0;
- data consent;
- the legal review of wording, restricted persons and the referral code;
- the broker application;
- caps fixed.

**Work:**
- `VITE_SALOON_TRADE=mainnet` in production.
- The first two weeks with `trading` = `on` only for wallets listed in the published file (the owner first), then open.

**Done when:** the owner has bought, sold back and settled real answers, and approves opening.

---

## 8. Decisions for the owner

1. **Go ahead with stage 2 on V3 testnet**, dry run first. No V2 build; mainnet only once V3 mainnet is live, and with your approval.
2. **Approval length:** 7 days (proposed) or 24 hours. A shorter approval is safer but means one more wallet signature per day.
3. **A separate Saloon account** on Derive (proposed), rather than trading from the user's existing Derive account.
4. **Funding:** a deposit address for USDC on Ethereum inside Cowboy, plus a link to Derive's own screen for other chains (proposed). Bridging inside Cowboy can come later.
5. **Fees:** no Cowboy fee and no builder fee; Cowboy's referral code on every trade; apply to Derive's API Broker programme (the form names your payout wallet).
6. **Caps at mainnet launch:** $250 per answer and $1,000 per day (proposed).
7. **Price tolerance:** the board price + 2c for BTC and ETH (+3c thin coins) as the most a quote may cost, and a firm quote shown for 12 s (proposed).
8. **Debit-only packages in stage 2.** No is bought as a put spread rather than the cheaper-on-screen credit twin; RFQ makers price the whole package, and no extra cash is locked.
9. **Between:** offer Inside and Outside through RFQ on testnet first, with a **Get price** button instead of a board number until fills are measured (proposed).
10. **Kill switch:** `on` / `sell_only` / `off` in the published file, set from the Action (proposed).
11. **Coins:** BTC and ETH only in stage 2 (one PRIME account). Other coins need one account per Derive risk universe and come later.
12. **Wallets:** ordinary wallets only at first. Multisigs need an extra Ethereum transaction to approve Cowboy.
13. **Send Derive the questions in 7.0** with the data-consent email, including whether integrators must screen restricted persons and whether dry-run RFQs are welcome.
14. **Legal review scope adds:** the one-tap flow, the approval wording, and the referral code.

---

Sources (all read 4 October 2026):
- **Derive docs:**
  - Introduction, Programmatic Onboarding, Gasless Onboarding, Contracts;
  - Session Keys, Session Login, Action Signing, Access Scopes;
  - Managers & Risk Universes, RFQ Trading, Price Banding, Transfers & Withdrawals, Settlement;
  - Trading Fees, Builder Fees, API Broker Program, Rate Limits;
  - DevEx improvements, New features, Migration skill, Coming soon, Changelog, Error Codes;
  - the API reference pages for `send_rfq`, `rfq_get_best_quote`, `execute_quote`, `cancel_rfq`, `poll_quotes`, `set_session_key`, `order_quote`, `get_positions`, `get_option_settlement_history`, `register_deposit_address`, `register_bridge_deposit`;
  - `/openapi.json`.
- **npm:** `@derivexyz/derive-ts` 3.0.29.
- **Public calls:**
  - V3 testnet: `public/get_time`, `public/get_risk_universes`, `public/get_all_instruments`, `public/get_trade_history`, `public/get_live_incidents`; a CORS preflight; a WebSocket `public/get_time` from a foreign origin.
  - V2 mainnet: `public/get_trade_history`, and a CORS preflight.

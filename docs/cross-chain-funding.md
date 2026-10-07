# Funding hub: EVM deposits, wallet purchases and the Rysk preview

Implemented 7 October 2026: an optional EVM funding route into the user's Derive account, wallet purchase guidance for Apple Pay, and a separate Rysk illustration. The two new flags are **off by default**. Public quotes and deterministic wallet/provider tests have been checked; no real cross-chain transfer has been signed or sent in this work. The first owner deposit is still pending.

The hub shares an entry point, not a balance or product. Buying an outcome on Derive remains distinct from locking collateral to sell an option on Rysk. This build funds Derive only; it does not fund or trade on Rysk.

## Build switches

| Switch | Prerequisites and effect |
| --- | --- |
| `VITE_FUND_ANYCHAIN=1` | Requires `VITE_QUESTIONS=1` and a supported `VITE_SALOON_TRADE` mode. Adds **Pay from another chain** beside direct Ethereum USDC funding. Actual cross-chain transfers require `VITE_SALOON_TRADE=mainnet` and the existing wallet/pilot eligibility. Other modes cannot send real bridge transfers. |
| `VITE_RYSK_MOCK=1` | Requires `VITE_QUESTIONS=1`. Adds the lazily loaded **Receive premium** illustration beside **Buy outcome**. It uses fabricated figures and has no wallet, live-price or execution action. |

Unset flags remove their optional implementation from ordinary bundles. Neither flag enables the published trading switch or bypasses pilot eligibility. The existing direct Ethereum deposit and Derive link remain available. Mainnet account setup also includes Apple Pay guidance; it needs no funding-hub flag or embedded payment API.

## Supported chains and balance discovery

The initial implementation supports **Ethereum (1), Base (8453), Arbitrum (42161) and HyperEVM (999)** with the connected EVM wallet. Solana quotes in the historical research below are not implemented wallet support.

LI.FI's public `/chains` and `/tokens` catalogues provide network and token metadata. Balances are read through approved public RPCs and Multicall3, **not a LI.FI balances endpoint**. The approved RPCs are Ethereum, Base and Arbitrum PublicNode endpoints, plus `https://rpc.hyperliquid.xyz/evm` for HyperEVM. A chain must also have matching provider metadata and a valid Multicall3 address.

The first scan checks native currency and up to **40 common catalogue tokens per chain** (including USDC, USDT, DAI, WETH, WBTC and HYPE). **Find other tokens** expands to the published catalogue. Reads are bounded and timed; failed chain or token reads remain unavailable rather than being treated as a zero balance. This is four-chain EVM coverage, not every asset on every network.

## Quote, confirmation and credit

1. Choose a supported source chain, a token with a successfully read balance, and an amount. The destination is the user's registered Derive deposit address for PRIME Standard, receiving official USDC on Ethereum.
2. Request LI.FI's **FASTEST** route with 0.5% slippage and `fee=0` for Cowboy's integrator fee. Provider/bridge and network fees still apply. Routes without complete source-gas and route-cost estimates, or with an estimated bridge duration over **120 seconds**, are refused. The estimate is not a delivery guarantee.
3. Show expected arrival, guaranteed minimum arrival, **Estimated total cost** and bridge time. The quote expires after **60 seconds**. An ERC-20 transfer may need a separate exact-amount approval: its necessity is checked against the allowance through the source RPC, and its estimated gas is included in the total with an **Approval gas, included** row. A missing allowance or approval-gas estimate stops the quote rather than guessing a fee. The wallet shows the final network fee before each confirmation.
4. Requote and recheck the runtime deposit minimum before sending. A lower guaranteed arrival, higher estimated cost, changed provider or materially worse time stops the operation and requires reviewing a new quote. After approval, its already-spent estimate remains in the compared total. Source account, chain, balance and native gas are checked before approval and again before transfer. Each approval or transfer requires the wallet's confirmation; source transactions also carry the selected chain ID.
5. Save the source transaction receipt before tracking it. Register it with Derive so pending-deposit tracking can show the bridge; registration is tracking metadata, not a second transfer or proof of account credit. Any sign-in needed for this flow happens before the source transfer, not while polling its result.
6. Track **bridge delivery**, then **Derive credit**, separately. The bridge first delivers Ethereum USDC. Derive's keeper then applies the deposit; its documented normal interval is 1–2 minutes. The account must actually show credited funds before trading readiness changes.

The minimum is read from Derive's `public/get_risk_universes`; an unreadable minimum stops the quote instead of using a fixed fallback. Guaranteed arrival after fees and slippage must cover:

`min_deposit_usd + max($0.50, 10% of min_deposit_usd)`

Destination USDC is valued conservatively at no more than $1. On the 7 October read-only check the minimum was $5, so at least $5.50 had to arrive by that calculation. The minimum is not promised to stay $5: Derive deposits below its minimum are not credited and are donated to its security module. Derive's final deposit record also carries its own fee; the real credited amount and that fee still need the first owner deposit.

Quote validation checks source/destination chains and tokens, decimals, exact source amount, wallet, recipient, transaction chain/from and calldata. A native-token route must send exactly the selected native amount; an ERC-20 route must not add an unexplained native transaction value. No Cowboy server holds keys or funds.

## Recovery and persistence

Receipts, pending bridge state and history are stored per wallet and network in the browser. Account changes or disconnects cancel further actions; a transfer already broadcast retains its receipt for the original wallet. A late response cannot overwrite a newer funding receipt. Returning to the account resumes read-only, single-flight bridge status checks. Polling and **Retry tracking** do not send a transfer or request a new wallet signature. The explicit **Check again** action can return the wallet to Ethereum and request sign-in to discover the newly credited account; it never resends the transfer.

Before opening the source transfer confirmation, Cowboy also stores a **sending outcome unknown** intent. A reload or lost wallet response keeps funding on hold even without a transaction hash. A known rejection in the active request releases that intent; an ambiguous error does not. If the page was reloaded and the wallet request was then cancelled, Cowboy cannot automatically prove the cancellation or clear the hold: wallet activity must be checked manually and the transfer reconciled before another route is attempted. There is no automatic retry or resend.

Provider `DONE` alone is insufficient. Its reported receiving transaction must match Ethereum USDC, the registered recipient and at least the quoted minimum; it still does not prove Derive account credit. Partial delivery, a refund, an unexpected asset or an unverified report remains an attention state, not available Derive cash. A proved source revert or refund, plus a fresh source balance check, can offer **Choose another funding route**. That action preserves the old receipt and reopens funding; it does not send money. Unknown or partial outcomes remain held for reconciliation.

Bridge estimates cover the bridge leg, not Ethereum confirmations, keeper credit or account setup. Credit tracking conservatively requires the observed received amount to increase the account balance; an unexpected nonzero Derive deposit fee can leave this check pending and must be reconciled from the authoritative deposit record during the first owner test. Browser-local history cannot replace the chain or Derive's authoritative records.

## Read-only validation: 7 October 2026

The public route review at **21:41 UTC** used real Derive metadata and a real LI.FI quote with mocked wallet balances. It made no private-account call, wallet signature, approval or transfer. The [captured public response](qa/funding-hub/captured-public-route.json) and [screen replay evidence](qa/funding-hub/funding-quote-evidence.json) are included for review. The screen uses explicitly synthetic balances and approval-gas reads; the route and deposit minimum are the captured public responses.

| Input | Route | Expected / guaranteed arrival | Bridge estimate | Minimum including margin |
| --- | --- | --- | --- | --- |
| 10 USDC on Base | Mayan (Swift) via LI.FI | 9.46525 USDC on Ethereum | 3 seconds | $5.50, using the runtime $5 minimum |

Cowboy's requested integrator fee was zero. LI.FI/provider costs remained; the quoted LI.FI fee was 0.25% and source-send gas was about $0.0068. The dollar-value floor uses the quoted USDC price conservatively, not an assumption that every USDC is worth exactly $1. This is evidence that the quote passes the checks, not evidence of a successful deposit or a standing price.

Deterministic tests use fake wallets, provider responses and chain receipts to cover approvals, changed quotes, gas/balance failures, account switches, delayed sends, partial/refunded delivery and recovery. Bundle tests cover optional-code removal. A first small owner mainnet deposit is still needed to measure actual source/approval gas, arrived USDC, Derive's fee, final credited balance and end-to-end time. This PR does not turn the new flags on in production.

## Historical quotes: 6 October 2026

The following research is retained as captured, rather than presented as today's available routes. Quotes came from LI.FI's public `/quote` API around **13:45 UTC**, delivering Ethereum USDC to a deposit address. Cost was what the user sent minus what arrived, plus source-chain gas. Solana rows are research only; the implemented wallet flow is EVM-only.

| From | $10 | $50 | $100 | Route, time |
| --- | --- | --- | --- | --- |
| USDC on Solana | $0.24 (2.4%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 4 s |
| SOL on Solana | $0.25 (2.5%) | $0.40 (0.8%) | $0.41 (0.4%) | Relay, 5 s; Layerswap at $100, 24 s |
| USDC on Base | $0.24 (2.4%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 3 s |
| ETH on Base | $0.26 (2.6%) | $0.44 (0.9%) | $0.66 (0.7%) | Relay, 4 s |
| USDC on Arbitrum | $0.25 (2.5%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 3 s |
| USDC on HyperEVM | $0.24 (2.4%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 3 s |

At that time, cheapest-first ordering selected an approximately 18-minute route from Base, Arbitrum and HyperEVM: $9.975 arrived for $10. The implemented flow instead requests FASTEST and refuses bridge estimates beyond 120 seconds.

The captured Relay breakdown was:

| Part | $10 | $100 |
| --- | --- | --- |
| Li.Fi's own fee | $0.025 (0.25%) | $0.25 (0.25%) |
| Ethereum gas the solver pays | $0.14 | $0.14 |
| Relay's service fee | $0.02 | $0.03 |

These snapshots explain why fixed destination costs weigh more heavily on a small deposit. They do not select a provider, guarantee today's cost or establish the eventual Derive credit time. The 7 October check selected Mayan rather than Relay.

## Apple Pay: buy in the connected wallet

Mainnet funding has **No crypto yet? Buy with Apple Pay in your wallet** guidance. The user opens their wallet's Buy screen, chooses USDC on the selected funding network (Ethereum for direct funding), chooses Apple Pay **if offered**, then returns to Cowboy to fund Derive.

This is not an embedded onramp, a Cowboy payment integration or a purchase directly into Derive. The wallet's provider sets fees, identity checks, country availability and supported assets/networks. Buying USDC into the wallet and depositing it into Derive are separate steps. A connected MetaMask or Coinbase Wallet identified by its EIP-6963 announcement gets its official guide; other wallets get generic instructions and both guides. This implementation requires no owner business-onramp account or API key.

## Rysk: an illustration, not a live venue

The default-off **Receive premium** tab shows covered-call and cash-secured-put examples. It first states what is locked, the possible sale or purchase, a **fabricated seven-day term from locking**, physical settlement and no early exit; premium dollars and three settlement examples follow. The figures and term are made up, actual Rysk assets/dates are unconfirmed, fees are not modelled, and no prices are fetched or orders placed.

A future HyperEVM destination adapter could share funding discovery and receipt tracking. It is not built here: Derive trading cash, Rysk locked collateral and pending transfers must retain separate meanings, with explicit transfer and venue-readiness checks. API/SDK access, fees, supported dates/sizes, exit rules and settlement reporting need the owner's Rysk call. See [Rysk discussion brief and mock design](rysk-design.md).

## Official references

- Derive: [Depositing](https://docs.derive.xyz/getting-started/depositing.md), [Register bridge deposit](https://docs.derive.xyz/api-reference/onchain-actions/privateregister_bridge_deposit.md), [Pending deposits](https://docs.derive.xyz/api-reference/onchain-actions/publicget_pending_deposits.md), [Risk universes](https://docs.derive.xyz/api-reference/market-data/publicget_risk_universes.md) and [Session login](https://docs.derive.xyz/authentication/session-login.md).
- LI.FI: [Quote API](https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer), [Transfer status](https://docs.li.fi/api-reference/check-the-status-of-a-cross-chain-transfer), [Status tracking](https://docs.li.fi/introduction/user-flows-and-examples/status-tracking) and [Current documentation catalogue](https://docs.li.fi/llms-full.txt). Public metadata is at [`/chains`](https://li.quest/v1/chains) and [`/tokens`](https://li.quest/v1/tokens); `/quote` and `/status` use `https://li.quest/v1`.
- Wallet purchases: [MetaMask guide](https://support.metamask.io/manage-crypto/move-crypto/buy/how-to-buy-crypto-in-metamask/) and [Coinbase Wallet guide](https://help.coinbase.com/en/wallet/managing-account/buy-crypto).
- Implementation: [quote and balance checks](../frontend/src/lib/trade/anychain.js), [wallet checks](../frontend/src/lib/trade/wallet.js), [funding state and recovery](../frontend/src/lib/trade/seat.js).

# Funding from any chain, and later Apple Pay

Owner's ask (6 October 2026): a trader should be able to put $10 into Cowboy from whatever chain or token they hold, or pay with Apple Pay, and buy an answer from one screen, at the lowest cost. This note prices that with real quotes and proposes the build. Nothing here is built.

## How Derive takes deposits

Derive V3 settles on Ethereum, and its deposit contracts live on Ethereum L1 (Derive docs, Programmatic Onboarding):

- **Deposit address.** `public/register_deposit_address` returns a fixed address for a wallet, subaccount and manager. Any USDC sent to it on Ethereum is swept into the account by Derive's keeper, in 1 to 2 minutes. Cowboy's testnet funding step already uses this.
- **Other chains.** Derive's own app bridges deposits through **Li.Fi**, and the API has `private/register_bridge_deposit`: once the source transaction is sent, `public/get_pending_deposits` shows the deposit as "bridging" with its quoted amount. Derive's docs say any bridge can be used.
- **Minimum.** Each collateral has `min_deposit_usd`, and a deposit below it is donated to Derive's security module, so the user loses it. On V3 mainnet today, USDC's minimum is **$5** (read from `public/get_risk_universes`, 6 October 2026). Cowboy must never let an amount under the minimum arrive after bridge costs.
- **Fee.** Each deposit record carries a `fee`, and the credited amount is `amount − fee`. Derive's docs show `"0"` in their example. We measure the real figure on the first mainnet deposit.

## Real quotes

Quotes come from Li.Fi's public API (`li.quest/v1/quote`) on 6 October 2026, about 13:45 UTC. Each one delivers USDC on Ethereum to a deposit address. Cost is what the user sends minus what arrives, plus source-chain gas.

| From | $10 | $50 | $100 | Route, time |
| --- | --- | --- | --- | --- |
| USDC on Solana | $0.24 (2.4%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 4 s |
| SOL on Solana | $0.25 (2.5%) | $0.40 (0.8%) | $0.41 (0.4%) | Relay, 5 s; Layerswap at $100, 24 s |
| USDC on Base | $0.24 (2.4%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 3 s |
| ETH on Base | $0.26 (2.6%) | $0.44 (0.9%) | $0.66 (0.7%) | Relay, 4 s |
| USDC on Arbitrum | $0.25 (2.5%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 3 s |
| USDC on HyperEVM | $0.24 (2.4%) | $0.35 (0.7%) | $0.48 (0.5%) | Relay, 3 s |

The cheapest-first order picks a slower standard route from Base, Arbitrum and HyperEVM: $9.975 arrives for $10, a 0.25% cost, but it takes about 18 minutes. That's too slow for a trader waiting to place a trade.

Where the money goes, in a Relay route from Base:

| Part | $10 | $100 |
| --- | --- | --- |
| Li.Fi's own fee | $0.025 (0.25%) | $0.25 (0.25%) |
| Ethereum gas the solver pays | $0.14 | $0.14 |
| Relay's service fee | $0.02 | $0.03 |

What the quotes show:

- **What you saw on Derive was almost certainly Relay.** It is a solver bridge: someone already holding USDC on the destination chain pays you out at once and collects your funds on the source chain afterwards. That is why the countdown is seconds, not minutes. Circle's CCTP is the other way to move USDC; Li.Fi offers it as a route, but it was not the cheapest or fastest one here.
- **There is a flat part of about $0.15**, mostly Ethereum gas, which is why $10 costs about 2.4% and $100 about 0.5%. A $10 deposit is fine (it clears Derive's $5 minimum); topping up $50 to $100 and trading $10 at a time is the efficient pattern.
- **Li.Fi takes 0.25%.** Calling Relay's API directly would remove that and keep the 3 to 5 second speed, but covers fewer chains and tokens. Li.Fi keeps the widest coverage (71 chains, including HyperEVM, Hyperliquid and Solana) and is what Derive's own app uses.
- **Derive's trading fee** of $0.50 per answer is 5% of a $10 trade, so for small trades it costs more than the bridge.

## Proposed flow (testnet first)

1. Fund step, beside today's "send USDC on Ethereum": "Pay from another chain". The user picks a chain and token from their wallet (EVM wallets first, Solana wallets after).
2. Cowboy asks for a quote to the user's own Derive deposit address (`register_deposit_address`, as today). It shows what arrives, the total cost and the time, and refuses any amount where what arrives would fall under `min_deposit_usd` with a margin.
3. The user signs once in their wallet. Cowboy calls `private/register_bridge_deposit` with the source transaction, so the fund step reads "Your deposit is on its way" at once (the same state the testnet flow has).
4. The bridge delivers in seconds. Derive's keeper credits it within 1 to 2 minutes, and the seat moves to Approve or Ready as it does today.

Everything runs in the browser with the user's wallet: no Cowboy server holds funds or keys, the same principle as the Saloon. Li.Fi's API is free to call. An integrator fee is optional and off, in line with "no Cowboy fee".

**Route provider:** Li.Fi first, for coverage and because Derive uses it, so their "bridging" state already understands it. Measure a direct Relay route as a second option once volumes justify saving the 0.25%.

**Testnet caveat:** solver bridges mostly don't run on test networks, so the testnet build can show the quote and flow but not complete a real bridge. The first real run is a small mainnet deposit by the owner.

## Rysk

Li.Fi lists HyperEVM, where Rysk runs, so the same picker can fund a Rysk position from Solana, Base or Ethereum. That waits for the Rysk mode itself (after the owner's talk with Rysk).

## Apple Pay

Card and Apple Pay onramps (Coinbase Onramp, Stripe's crypto onramp, MoonPay, Transak) take payment, run their own identity check on first use, and deliver crypto to an address we give them. Two ways to use them:

- **Straight to the deposit address:** USDC on Ethereum. This is simplest, but onramps price Ethereum delivery with its gas.
- **To a cheap chain first** (USDC on Base or Solana), then the route above in one more signature. Usually cheaper, one extra step.

To settle before choosing a provider: fees per purchase (typically a few percent on cards), minimum purchase, which countries have Apple Pay, whether delivery to a third-party address (the deposit address) is allowed, and whether the provider needs a business agreement. Each needs an account and API key from the owner. As with bridging, "top up once, trade small" keeps the percentage down.

## Next steps

1. Build "Pay from another chain" in the testnet fund step: quote, refusal under the minimum, one signature, `register_bridge_deposit`, the "on its way" state.
2. Owner's first real cross-chain deposit on mainnet with a small amount, to measure Derive's deposit fee and the end-to-end time.
3. Pick an onramp after comparing the points above. The owner opens the account.

# Rysk: Receive premium from the Saloon

Built 10 October 2026 after the owner's go ("try it first and see where the blockers are"). The trade panel's **Receive premium** tab sells an option on Rysk V12 (HyperEVM) from the user's own wallet: a covered call ("Sell ETH at a level": lock the coin) or a cash-secured put ("Buy ETH at a level": lock USDC). It is off unless a build sets `VITE_RYSK`; with it off, builds carry none of this code (bundle test).

## How a trade goes (as Rysk's own trade page does it)

Read from Rysk's app (app.rysk.finance, 10 October 2026) and checked against one live quote.

1. **Listing.** One socket, `wss://v12.rysk.finance/taker` (testnet `wss://rip-testnet.rysk.finance/taker`), JSON-RPC 2.0 frames whose `id` is the method name. `assets` (tokens per chain, minimum and maximum sizes, prices), `inventory` (per coin: Friday 08:00 UTC expiries, strikes, Rysk's listed APR, the products per strike) and `caps` (room left). Read on open and every minute while the tab is on screen.
2. **Firm premium.** `request` with `{asset, assetName, chainId, expiry, isPut, quantity (contracts, 18 decimals), strike (8 decimals), taker, usd, collateralAsset, isEIP1271}`; the taker may be the zero address before a wallet connects. Makers answer under the same id with a signed quote `{assetAddress, chainId, expiry, isPut, isTakerBuy: false, maker, nonce, price (dollars per contract, 18 decimals), quantity, strike, validUntil, usd, collateralAsset, signature, apy}`. The ticket keeps only a quote for exactly what it asked and asks again before it lapses (Rysk's rule: every 3 s, when 20 s are left or after 15 s without an answer).
3. **Approve.** Only when the allowance is short: an exact-amount ERC-20 approval of the collateral to Rysk's margin pool. A put locks strike x contracts in USDC (6 decimals); a call locks the contracts in the coin's token.
4. **Rysk's gas fee.** `POST /api/gas` with the confirmation body; Rysk echoes it with `gasFee` (6 decimals, taken from the premium). The ticket refuses a reply that does not echo every signed field, and a fee at or above the premium.
5. **Sign.** One EIP-712 `Confirmation` on the domain `{name: "rysk", version: "0.0.0", chainId, verifyingContract}`: maker, asset, chain, expiry, side, a millisecond nonce, price, quantity, the quote's nonce and signature, strike, taker, `isTakerBuy: false`, premium token, collateral, collateral amount and gas fee.
6. **Send.** `confirm` with the echoed body, the gas fee, `isEIP1271: false` and the signature. Rysk sends the transaction on HyperEVM and answers with its hash; the premium lands in the wallet in USDC. A `confirm` that gets no answer is reported as unknown and never resent.
7. **Positions.** `positions {address}` lists what the wallet holds; settlement is physical, about two hours after 08:00 UTC on the date; no early exit.

Each step is timed (owner: "we should actually chrono this time") and shown in the ticket; each trade and its timings are kept in this browser (`cowboy-rysk:{network}`).

## Contracts (from Rysk's app)

| | HyperEVM (999) | HyperEVM testnet (998) |
| --- | --- | --- |
| Signing domain contract | `0x8c8bcb6d2c0e31c5789253ecc8431ca6209b4e35` | `0x0122db8Ed9B9B49F3FD8774d93773C2e2A564E81` |
| Margin pool (approval spender) | `0x24a44f1dc25540c62c1196FfC297dFC951C91aB4` | `0xB586aBB1b69611284A855BAECE6707bf353C035b` |
| USDC (put collateral, premiums) | `0xb88339cb7199b77e23db6e890353e22632ba630f` | `0x69E37eCb273a23B8864A5f39520Bf97c6768b65C` |

Calls lock the coin's own token on HyperEVM: WHYPE (wrap HYPE first), UBTC, UETH, USOL, PURR, UPUMP. Rysk also runs on Ethereum (WETH, WBTC; puts in USDC or USDT), not used yet.

## On the Saloon chart

Builds with `VITE_RYSK` add a switch under the coin tabs, "Derive · higher or lower" (unchanged) and "Rysk · get paid to wait" (`?venue=rysk`, `components/rysk/RyskView.jsx`, `RyskChart.jsx`). The Rysk view draws the coin's 4-hour candles, a Now line and one column per Friday Rysk lists; each level is a bubble, blue above the price (sell: lock the coin) and lilac below it (buy: lock USDC), with about what Rysk's smallest size pays now, worked out from Rysk's listed APR on what it locks for the days left (it matched the live quote: $13.07). A bubble opens the panel held on that level with a picture of the settlement (`FridayPicture.jsx`): the level splitting the price line, the price now, and what you end with on each side, the premium on both. One Rysk connection serves the chart and the panel.

## Lab site

The owner's test site (10 October 2026: "test it somewhere without touching anything"): Vercel project `cowboy-lab`, the same repository, root `frontend`, built only from the `lab` branch (its ignore-build rule skips every other branch), with `VITE_QUESTIONS=1` and `VITE_RYSK=testnet` since 11 October 2026 (owner: no $1,000 test with real money; Rysk's testnet on HyperEVM testnet, chain 998, lists HYPE only: sell at a level locks WHYPE, 10 HYPE minimum, and the ticket offers to wrap HYPE; buy at a level locks Rysk's test USDC). Test HYPE comes from Hyperliquid's testnet faucet; Rysk's test USDC from Rysk (no public faucet). A premium that never comes reads "No premium from Rysk's makers right now." after 20 s. Its vercel.app address needs a Vercel login. Preview builds are off for the project (it had tried to build every push, the recorder's `data` branch included, which has no `frontend` and failed every 15 minutes), and Vercel counts `lab` as a preview branch, so a push to `lab` does not build by itself: each lab update is deployed as a production build of `lab` from the Vercel API or dashboard. cowboy.trading (`torq`, from `main`) is not changed.

## Switches

| Variable (Vercel) | Effect |
| --- | --- |
| `VITE_RYSK=testnet` | Rysk's testnet on HyperEVM testnet. Test tokens are needed; no faucet was found (ask Rysk). |
| `VITE_RYSK=mainnet` | Real money on HyperEVM. Fills only for wallets on `VITE_RYSK_PILOT` (comma-separated; `all` is everyone; empty is nobody) and only while the published `trading_mainnet` switch is on, re-read before anything leaves the browser. |

Both need `VITE_QUESTIONS=1`. `VITE_RYSK` replaces the made-up illustration (`VITE_RYSK_MOCK`). Rysk's hosts and HyperEVM's RPCs are in the CSP.

## Measured and found, 10 October 2026

- **Rysk's makers answer Cowboy.** One anonymous request from Cowboy's origin (0.5 ETH at $2,550, Fri 16 Oct) got a firm quote in 2.25 s: $13.07 premium ($26.14 per ETH), 67.9% APR, valid about 38 s. The socket takes any origin for reads and quotes; `confirm` from another origin is not tested yet (the owner's first trade settles it).
- **Minimum sizes are large.** Rysk's minimum per trade: 0.5 ETH (about $1,250), 0.025 BTC (about $2,070), 25 HYPE (about $2,130), 10 SOL (about $1,100). Cowboy's $25-$500 budgets do not reach them.
- **No integrator field.** Request, quote and confirmation carry no builder or referral field; referral is bound to the wallet (`use_referral {account, code}`), so a Cowboy referral code would have to come from Rysk.
- **Terms.** Rysk's site terms licence its own site, exclude US, UK and Taiwan residents and forbid VPNs; there are no published taker API terms. Public launch needs Rysk's agreement and Cowboy's own geo check; the pilot is the owner's.
- **Gas.** The wallet needs a little HYPE on HyperEVM for the approval (about $0.001); Rysk pays the trade's gas and takes it from the premium.

## Derive cash to Rysk (not built yet)

Mapped the same day, read-only:

- Derive V3 pays USDC out only on Ethereum (`private/withdraw`, signed by the owner's wallet: Cowboy's key may only trade), once its batch settles there: measured 4.3 min at best, **10.9 min median**, 15.2 min p90, with a payout queue of 1-4 h seen that day. Derive charges $1 per withdrawal (seen in payouts). Derive's forwarded withdrawals reach HyperEVM for HYPE and kHYPE only, not USDC.
- Ethereum to HyperEVM USDC: Across, about 20 s observed (Li.Fi adds 0.25%; Across directly about $0.10 per $100). The user needs a little ETH for the bridge transaction on Ethereum.
- So Derive to a Rysk position is about 11-12 minutes typical, not seconds. Other chains are fast: Base or Arbitrum USDC to HyperEVM is 1-20 s through the funding hub's existing Li.Fi plumbing (`lib/trade/anychain.js`), which needs a HyperEVM destination instead of Derive's deposit address.

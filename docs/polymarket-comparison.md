# Polymarket vs Derive on the same question

Owner's question (6 October 2026): should Cowboy aggregate Polymarket, Derive and Rysk? Before building anything, we measured whether Derive is cheaper than Polymarket on the questions both venues price. A cheaper Derive would have been the hook for a "same question, cheaper here" comparison.

**Result: on Derive's order book, it is not.** Polymarket was cheaper on the same question about 9 times out of 10. Over the median hour, a $100 trade on Derive returned about $8 less in expected payout than the same $100 on Polymarket.

## What was compared

- **Polymarket.** The daily "Bitcoin above ___ on October D?" and "Ethereum above ___" events for 2 to 12 October 2026: 11 strikes per date, 242 questions. Each resolves on the Binance BTC/USDT (ETH/USDT) 1-minute close at 12:00 ET, which is 16:00 UTC. Hourly prices come from the CLOB `prices-history` endpoint, which gives the midpoint. The taker fee is `0.07 × p × (1 − p)` per share, from Polymarket's fee docs (crypto category); makers pay nothing.
- **Derive.** The V2 mainnet hourly chains recorded by Cowboy, 1 to 6 October 2026 (105 hours), on the expiry for the same date, which settles at 08:00 UTC. "Above K" is built as the call spread from K − w to K + w, with w = $1,000 or $2,000 for BTC and $50 or $100 for ETH. "At or below K" is built as the put spread over the same strikes. Each package is bought at the ask and sold at the bid, with Derive's fees: $0.50 per leg plus min(0.03% of index, 12.5% of the option price) per contract per leg, the formula the Saloon uses. Figures are for $100 all-in, fees included.
- **Fair value.** Each venue is measured against fair value:
  - Derive's own marks for the same package.
  - For Polymarket, the same mark value moved forward 8 hours to its 16:00 resolution, using Derive's implied volatility at K. This keeps the skew.
- **The cost of a trade** is the share of the money paid above fair value. Only questions priced between 5c and 95c are counted, and each question takes the narrowest width available.

In total, 4,554 matched observations over 71 questions.

## Numbers

| | Polymarket | Derive order book |
| --- | --- | --- |
| Paid above fair value, median, all | 4.4% | 14.1% |
| Longshots (5-25c) | 16.2% | 26.0% |
| Middle (25-75c) | 6.1% | 13.4% |
| Favourites (75-95c) | 1.6% | 9.2% |
| Cost per $1 of payout, BTC ±$1,000 | ~2.7c (half-spread + fee) | 5.0c spread over mark + 3.1c fees |
| Cost per $1 of payout, BTC ±$2,000 | ~2.5c | 2.8c + 1.7c |
| Size at the top of the book | ~$28k liquidity per strike | ~$1,000 of payout (median) |

- **How often Derive costs less above fair value:** 7% of observations overall. For ETH it is 34% with the wider ±$100 package.
- **Sensitivity to Polymarket's spread:** Polymarket's spread was measured live on 6 October (median 1.6 to 3c) and set as the half-spread in each price band. With a 1c spread, Derive costs less 3% of the time. With a pessimistic 5c spread, it costs less 17% of the time. The conclusion holds either way.
- **Polymarket prices these questions on the options market's fair value.** Its midpoint sits within 0.3c of Derive's options-implied value in every price band, median 0.0c. There is no crowd mispricing to point at.

## Why Derive costs more here

- **Derive charges for every option leg.** Each contract pays about 0.03% of the index per leg, plus $0.50 per leg on every order. A narrow package needs many contracts, so fees reach 2 to 3c per $1 of payout. Polymarket's fee is 0 to 1.75c per share and is lowest at the extremes.
- **Two legs mean paying two spreads.** On the daily expiries, the bid-ask over two strikes adds another 2 to 5c per $1. Polymarket has one book per question with a 1 to 3c spread.
- **Wider packages cost less, but they move away from "above K".** A wider package pays in part over a broad zone, so it is no longer a yes/no question.

## What this does not cover

- **RFQ.** The Saloon's one-tap trades go through Derive's RFQ, not the book. Derive refuses an RFQ quote that is worse than the book, so RFQ can only match or beat these numbers. By how much is unknown until mainnet RFQ quotes exist (V3 order books were empty at the time of writing).
- **Settlement.** The products settle 8 hours apart (08:00 vs 16:00 UTC) on different references (Derive's index vs Binance USDT). The model moves fair value across the time gap; the USDT basis is ignored.
- **The sample.** Six days of BTC and ETH dailies. Derive's weeklies and monthlies have no Polymarket equivalent that resolves on a price at a fixed time, so they could not be compared.

## What it means

- **No "cheaper than Polymarket" angle.** A comparison feature would mostly advertise Polymarket.
- **Derive's edge is not price on short-dated yes/no questions.** It lies in what Polymarket lacks: dates out to quarters, levels anywhere on the strike grid, partial-payout zones, selling back at any time, and the research layer.
- **Measure mainnet RFQ prices first.** If one-tap RFQ quotes for Saloon packages come in near the mark, rerun this comparison with RFQ prices in place of the book.

Reproduce: `backend/research/polymarket_compare/compare.py` and `summary.py`. Inputs are the Derive chains from the `data` branch plus the Polymarket markets and history; the header of each script lists the files it needs.

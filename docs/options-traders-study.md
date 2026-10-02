# Options traders on Derive: history rebuild and declared study

Status: DRAFT for the owner's approval (2 October 2026). Under the declared-study protocol nothing in "Rules" may change once approved, and no result is computed before approval. The data rebuild (part 1) may start before approval: it computes no results.

## Question

Do the positions of directional options traders on Derive, in particular the ones who have been profitable, lead the price of the underlying? This is the options counterpart of Reflex's profitable perp traders.

Whatever the answer, the positioning views stay in the app as context (who holds what, where, at what price).

## Part 1: rebuilding the history (data only)

Source: Derive V2 public trade history (`public/get_trade_history`), available since at least June 2024. Every trade leg carries wallet, subaccount, instrument, side, size, price, index price, liquidity role (maker or taker), RFQ id and realised PnL.

Steps:
1. Fetch every option and perp trade leg since the first available day, all underlyings with options, once; then extend daily from the live recorder.
2. Implied volatility at each option trade from its price (Black-76 on the index forward at the time; no extrapolation).
3. Per wallet: open positions by instrument through time (signed contracts), closed by trades or settled at expiry against the index.
4. Per wallet, per underlying, per day: net option delta (contracts x delta x index), net perp position, premium paid and received, realised PnL.

Storage: daily per-wallet aggregates only (compressed), not raw legs, so the repository stays small. Raw legs can be refetched from Derive.

## Part 2: rules (fixed before any result)

### Wallet classes (applied with information available at the time only)

- Market makers: more than 60% of option legs as maker, or both sides of the same instrument within 24 hours on more than half the instruments traded. Excluded.
- Income sellers (vaults, covered calls, cash-secured puts): more than 80% of option premium sold, mostly out-of-the-money. Excluded from the directional set; shown separately as structure.
- Hedgers: a perp position opposite to their option delta covering at least half of it. Excluded.
- Directional: the rest, with at least 20 option legs and at least 90 days active.
- Skilled directional: the top fifth of directional wallets by realised PnL in the training window, using only trades closed inside it.

### Measure and outcome

- Positioning, per underlying per day: the net option delta added over the previous 7 days by skilled directional wallets, as a share of all directional delta added.
- Outcome: the underlying's return over the next 3, 7 and 14 days (index close to index close).

### Test

- Walk-forward: wallets are ranked on June 2024 to June 2025; positioning is measured and scored on July 2025 to the newest data, never re-ranked with test-window outcomes.
- Main statistic: Spearman rank correlation between positioning and the 7-day forward return, per underlying, with a block bootstrap by week for the confidence interval.
- Controls: the same statistic for all directional wallets, and for 1,000 random sets of directional wallets of the same size (permutation).

### Bar for a verdict

"Signal" only if all of these hold for the 7-day horizon:
1. Spearman correlation at least 0.10 on BTC, with the 99% bootstrap interval above zero.
2. Positive in both halves of the test window.
3. Above the 95th percentile of the random-wallet sets.
4. Same sign on ETH.

Otherwise the result is "context, not a signal", and positioning is shown without any claim. The 3- and 14-day horizons are reported but do not decide the verdict.

### Known limits

- Fewer active options wallets than Hyperliquid has perp traders: a real effect has to be large to clear the bar.
- Hedges inside a wallet that uses another venue cannot be seen.
- Derive's V3 docs describe public trades as anonymised; wallet-level tracking may stop when V3 replaces V2.

## In the app before any verdict

- Priced outcomes (built 2 October 2026): the price ranges option prices imply per expiry, drawn on the coin chart; labelled as market pricing, never as a forecast.
- Who is buying (built 2 October 2026): taker buying and selling of calls, puts and the perp, 24 hours and 7 days.
- After part 1: positioning by wallet class (skilled directional, income sellers, hedgers) per coin, as context.

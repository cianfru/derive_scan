# Options traders on Derive: history rebuild and declared study

Status: APPROVED by the owner on 2 October 2026, before any result was computed. Under the declared-study protocol nothing in "Rules" changes from here. The owner's emphasis: skilled traders are the ones who profit from directional positioning; market makers are noise and are never shown in the app.

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

Built 2 October 2026: `backend/derive/history.py`, run by `history_once.py` in the recorder's Action (a time budget per run until it has caught up, then one new day a day). Derive's public trades start mid-December 2023, so the rebuild starts there. Operational details, fixed with the rules and before any result:
- A wallet's position in an instrument is the running sum of its daily buys minus sells; an option held to expiry settles at Derive's settlement price (`public/get_option_settlement_prices`). Option PnL per instrument = premium received - premium paid + contracts held at expiry x settlement value.
- "Both sides of the same instrument within 24 hours" is read per UTC day.
- "Mostly out of the money" for income sellers: at least half of the premium sold was out of the money at the trade.
- Hedgers are read per day and underlying: on more than half of the days a wallet traded options, its perp trades that day offset at least half of the option delta it added.

## Part 2: rules (fixed before any result)

### Wallet classes (applied with information available at the time only)

- Market makers: more than 60% of option legs as maker, or both sides of the same instrument within 24 hours on more than half the instruments traded. Excluded.
- Income sellers (vaults, covered calls, cash-secured puts): more than 80% of option premium sold, mostly out-of-the-money. Excluded from the directional set; shown separately as structure.
- Hedgers: a perp position opposite to their option delta covering at least half of it. Excluded.
- Directional: the rest, with at least 20 option legs and at least 90 days active.
- Skilled directional: the top fifth of directional wallets by realised PnL in the training window, using only trades closed inside it. This is the "Top" tier and the set the verdict is decided on.
- Added by the owner on 2 October 2026, before any result: two wider tiers for depth, ranked the same way and among wallets with positive PnL only. "Smart": the best 50 (and every Top wallet). "Profitable": every directional wallet in profit. The test reports the main statistic for both; they do not decide the verdict. The app shows Smart by default.

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
- Option levels (built 2 October 2026): call wall, put wall and max pain over the next 30 days, on the coin chart.
- Options lean (built 2 October 2026): skew against its own range, taker premium (market makers left out), put/call change, short-dated stress; beside the engine's signal, never part of it.
- Market makers left out of Flow and of taker sides as soon as the rebuilt history classes them; every other wallet shows its type.
- Alignment (built 2 October 2026): for the next 7 and 30 days, the engine (4H, 1D), option prices and the Smart tier's open positions on expiries inside the window (net delta as a share of gross, from `history/positions.json`), each read as up, neutral or defensive. Side by side, never combined into a signal.

## Addendum A: did their side settle in the money? (APPROVED by the owner on 7 October 2026 as written, before any result)

Owner, 7 October 2026: "see if directional traders ... actually predict price movements into the future by looking at their bets and then the price that followed". A track record for the Saloon's directional traders' line, with its own rules, fixed before any result.

### Reading and outcome

- Unit: one reading per coin and settlement date, never one per day (daily readings of the same date are not independent).
- Reading: the line's own measure, net over gross delta of every directional wallet's open options of that settlement date. Wallets are classed with information up to the reading time only. Delta comes from the implied volatility of the trades at the time (Black-76 on the index). Long at +0.25 or more, Short at -0.25 or less, else Balanced. It needs $10,000 and 3 positions.
- Lead: the reading is taken 7 days before settlement for dates listed at least 7 days ahead (main test), and 1 day before for every date (reported, not deciding).
- Outcome: Derive's settlement price against the index at the reading time. "Their way" when Long settled above it or Short settled below it. Balanced and unreadable dates are counted but not scored.
- Window: every settlement from the start of the rebuilt history (December 2023) to the newest settled date. BTC and ETH decide; other coins are reported.

### Comparison (chance is not 50%)

- Base rate: a coin that rose over the window makes "Long" right more often by drift alone. The expected hit rate by chance is p_up x share Long + (1 - p_up) x share Short, where p_up is the share of the same dates that settled above their reading-time index.
- Permutation: the Long/Short labels are shuffled across the same dates 10,000 times, and the observed hit rate is placed among the shuffles.

### Bar

"Their side has settled their way more often than chance" may be shown only if all of these hold at the 7-day lead:
1. BTC has at least 60 scored dates, and its hit rate is above the 99th percentile of the permutations.
2. The same direction holds in both halves of the window.
3. ETH's hit rate is above its own chance rate.

Otherwise the app shows the record as history only: "Of N dates, their side settled their way M times (X%); by chance about Y%." The headline is "no better than chance so far" unless the bar is met. No probability, odds, likely or predict wording appears in the app in either case.

### Result (computed 7 October 2026, after the approval above)

Run: `python backend/research/settlement_record/run.py DATA_DIR` on the data branch's day files through 6 October 2026 (settlements through 7 October). Readings at 00:00 UTC, 7 days (1 day) before the settlement day, from the day files up to then.

**Verdict: the bar is not met. Their side has settled their way no more often than chance so far.**

| 7 days before | Dates | Scored (Long or Short) | Their way | Chance | Shuffles at least as good | First half vs chance | Second half |
|---|---|---|---|---|---|---|---|
| BTC | 100 | 50 | 27 (54%) | 51% | 45% | -11 pts | +17 pts |
| ETH | 100 | 49 | 29 (59%) | 55% | 34% | -6 pts | +13 pts |

- **Why it fails.** BTC has 50 scored dates, short of the 60 the bar needs. Its 54% beats chance (51%) by 3 points, and 45% of random shuffles do at least as well. The two halves point opposite ways. ETH's 59% is 4 points over its chance rate (55%), and 34% of shuffles match it.
- **The app's current count form** (each wallet counted from $1,000, 3 wallets; reported, not deciding):
  - BTC: 75 scored, 55% against 51% by chance, 33% of shuffles at least as good.
  - ETH: 57% against 53%, 31% of shuffles.
- **1 day before** (reported, not deciding):
  - BTC: 318 scored, 54% against 51% by chance, 11% of shuffles at least as good. The halves are +5 and +3 points.
  - ETH: 382 scored, 48% against 50%.
- **Other coins** (7 days before, too few dates to read):
  - HYPE: 28 scored, 39% against 45%.
  - SOL, XRP, XAUT and ZEC: 5 to 9 each.
- **What it means.** The line stays context, not a signal. If the app shows the record, it shows it as history with "no better than chance so far". The test can be rerun as dates settle; BTC reaches 60 scored dates at the 7-day lead in two to three months at the current pace (about 4 to 5 a month).

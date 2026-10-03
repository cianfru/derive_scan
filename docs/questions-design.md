# Questions: design document

Torq, to be renamed Cowboy. 3 October 2026. Written for the owner and for whoever builds the feature.

It draws on three research notes in this folder:
- `economics.md`: prices from the recorded chains;
- `ux.md`: the screens and their wording;
- the mechanics research: Derive's docs and live V2 calls, saved in `work-mechanics/`.

Every worked example uses the Derive V2 BTC and ETH chains recorded on 3 October 2026 at 14:00 UTC. They were recomputed for this version:
- `work-design2/ex2.py`: the examples;
- `work-design2/policy.py`, `coingate.py` and `at14.py`: the zone and gate study over all 42 hourly snapshots;
- `work-design2/coins.py` and `coins2.py`: the other coins.

**Read this first.** Without written consent, Derive's Terms of Use (section 10, in force from 3 October 2026) and its Data Usage Policy forbid:
- republishing Derive data;
- using it in a dashboard, analytics or signals product;
- deriving pricing services from it;
- collecting it by API polling.

Questions would do all four. So does the rest of the app as it stands today. This is owner decision 1 in section 9. Building can start now; a public launch should wait for that answer. This is the text as written, not a legal opinion.

---

## 1. What Questions is

Questions turns Derive's options into price questions with two answers. For each coin and each date Derive lists, the user sees questions such as "BTC above $86,000 on Fri 9 Oct?". Each has a Yes and a No button, and each button shows what $1 of payout costs right now, for example 38c.

Behind every answer sits a small, defined-risk package of Derive options: a call spread or a put spread (and later a butterfly or condor). The most the user can lose is the price paid plus fees, and Derive asks for no margin beyond that.

Settlement:
- Derive settles the package in USDC at the 30-minute average price ending at 08:00 UTC.
- The user does not need to do anything at expiry.
- The user can sell back at any time before then.

A spread is not a pure yes/no bet. Between its two strikes it pays part of the $1. So every question shows its pay zone, the band where the payout climbs from $0 to $1.

Questions never shows a chance, a percentage or a forecast. It shows a price, what the answer pays, and the worst case.

- **Stage 1.** Cowboy publishes the questions and their prices from data it already reads, and the user places the legs on Derive by hand.
- **Stage 2** (only with the owner's approval). The same thing becomes one tap through Derive's RFQ, using the user's own account and signature.

## 2. How each question maps to Derive options

### 2.1 The question types

A Derive option pays its intrinsic value at expiry. Take a long call at strike K1 plus a short call at K2 (K1 < K2):
- it pays 0 below K1;
- it pays the full width (K2 - K1) above K2;
- it pays a straight line in between.

Dividing by the width gives a payout from $0 to $1 per $1, which is the question's unit. The band from K1 to K2 is the **zone**. Its middle K is the level the question is named after.

| Question | Yes is built as | No is built as | Payout per $1 at the settlement price S |
|---|---|---|---|
| above K (zone K1-K2) | buy call K1, sell call K2 (debit call spread), or the put twin: buy put K1, sell put K2 | buy put K2, sell put K1 (debit put spread), or the call twin: sell call K1, buy call K2 | Yes: 0 at or below K1, $1 at or above K2, clip((S - K1)/w, 0, 1) between. No: 1 minus that |
| below K | the No of "above K" | the Yes of "above K" | mirror of above |
| up or down from K | Up = the Yes of "above K" at the headline level (3.3) | Down = the No of the same | as above |
| between L and H (later) | call condor: buy call L-s, sell calls L and H, buy call H+s (s = one strike step), or the put version | not offered as one package | $1 for L <= S <= H, a ramp one step wide on each side, 0 outside |

Rules that follow from the mechanics research:

- **Strikes must be listed strikes.** The level and both ends of its zone are Derive strikes, so the app cannot offer an arbitrary level. "End of month" means Derive's last-Friday expiry, not the calendar month end.
- **Above and below are one package.** "Below K" is exactly "No on above K", so each level has one id and one Yes/No pair. The Yes and No payouts add up to exactly $1 at every settlement price.
- **Build from out-of-the-money options.** For every question the builder prices both constructions (the named spread and its put-call twin) and uses the cheaper. Buying on the in-the-money side costs two to three times as much: for BTC "above" at 1-4 days, the median book markup before fees was 9.0c for the named construction against 3.0c for the cheaper one (economics.md; all-in, fees included, the cheaper one was 6.2c).
- **Zero margin, but only in debit form, and only with the bought leg first.** Derive's margin calculator (`public/get_margin`, standard margin) returns 0 for a long call spread, long put spread, long butterfly and long condor. It has three consequences:
  - Selling the short leg first leaves a naked short. One BTC 87,000 call held alone needs about $11.5k of initial margin (live: 11,548.68; the saved run gave 11,543.78), and Derive rejects the trade without that cash.
  - A credit twin (for example selling call K1 and buying call K2 for a No) makes Derive hold the full width as margin. For a 1-contract 84,000/88,000 credit spread it holds $4,000. With the $1,298 credit in the account it still needs $2,702 of the user's cash, which is exactly the No price. The cash at risk is the same as the debit form, but the ticket has to say it differently (F4).
  - A sold iron condor holds the full width as margin. "Between" is therefore only ever offered as a debit butterfly or condor.

### 2.2 Worked example: BTC above $86,000 on Fri 9 Oct

**Inputs.**
- The chain at 3 Oct 14:00 UTC; BTC index $84,823.1; expiry Fri 9 Oct 08:00 UTC.
- The zone for this date is $6,000, 7.1% of the index (section 3.3), so "above $86,000" is the 83,000/89,000 package.
- The board's headline for this date is "Up or down from $85,000" (82,000/88,000); "above $86,000" is the next row up.

| Leg | Bid | Ask | Mark | Top size (bid / ask) |
|---|---|---|---|---|
| BTC-20261009-83000-C | 2,268 | 2,431 | 2,291 | 5.0 / 5.0 |
| BTC-20261009-89000-C | 162 | 190 | 190 | 4.416 / 0.12 |
| BTC-20261009-83000-P | 451 | 490 | 443 | 4.416 / 0.12 |
| BTC-20261009-89000-P | 4,219 | 4,412 | 4,338 | 7.074 / 3.537 |

**Fair price (Derive's mark).**
- Yes: (2,291 - 190) / 6,000 = **35.0c** per $1. The put twin gives 35.1c, so the marks agree.
- In the app, each leg's mark is first clipped into that leg's bid-ask range (section 4.1). Here neither call needs clipping.

**Executable price on Derive's screen** (taker on both legs, fees excluded):
- **Yes, buy.** Buy the 83,000 call at its ask and sell the 89,000 call at its bid: (2,431 - 162) / 6,000 = **37.82c**. The put twin costs 37.85c, so the call spread is used. Shown as **38c** (buy prices round up).
- **Yes, sell back now.** (2,268 - 190) / 6,000 = **34.63c**, shown as **34c** (sell-back prices round down).
- **No, buy.** The debit put spread costs (4,412 - 451) / 6,000 = 66.02c. The call twin (sell the 83,000 call at 2,268, buy the 89,000 call at 190) costs 1 - 2,078 / 6,000 = **65.37c**, so the twin is used. Shown as **66c**.
- **The gap.** Defined once and used everywhere: shown buy minus shown sell-back, 38c - 34c = **4c**. When No uses the call twin, as here, this equals shown Yes + shown No - $1 (38c + 66c = 104c). When No uses the debit put spread, the sum can only be smaller. Unrounded, the gap is 3.18c, the two calls' bid-ask (163 + 28) over 6,000.

**Size at that price.**
- The Yes package is limited by the 89,000 call's bid size of 4.416 contracts: **$26,496** of payout.
- The No twin is limited by the 0.12-contract ask on the 89,000 call: **$720** of payout. Beyond that the price gets worse.

**Fees.** They are the same on every BTC and ETH option (`public/get_instruments`, checked on all 794 BTC and 966 ETH):
- On the order book, per leg: $0.50 + min(0.03% x index, 12.5% x premium) x contracts. At $84,823 the notional part is $25.45 per contract per leg. The 12.5% cap applies only to legs priced under about $204, as on the 89,000 call at 162.
- Through RFQ (stage 2): one $0.50 base fee per package. The most expensive leg group pays in full and the cheapest group is free, so a 2-leg spread pays on one leg only.

**Payout per contract and scaling.** One contract of the package pays up to $6,000, the width. A payout of P dollars needs P / 6,000 contracts, rounded down to Derive's amount step (BTC 0.00001).

| Ticket | Contracts | Premium | Book fees | All-in per $1 | Pays up to | At $86,000 exactly |
|---|---|---|---|---|---|---|
| $100 typed | 0.04407 | $99.99 | $3.01 | 39.0c | $264.42 | $132.21 |
| $1,000 of payout | 0.16667 | $378.17 | $8.62 | 38.7c | $1,000 | $500 |
| Derive minimum | 0.01 | $22.69 | $1.46 | 40.2c | $60 | $30 |

- **Minimum ticket.** Derive's minimum amount is 0.01 contracts for BTC and 0.1 for ETH. On this zone the smallest BTC ticket is $60 of payout for $24.15 all-in. At that size the two $0.50 base fees alone add 1.7c per $1.
- **The same $100 through RFQ (stage 2).** Recorded RFQ fills on 2-leg verticals paid a median 0.49c over mark for BTC. At 35.5c per $1, the same $264.42 payout costs $93.89, plus $1.62 in fees on the RFQ schedule: **about 36.1c all-in**, against 39.0c on the screen. This is an estimate from other people's fills, not a quote (section 7).
- **The gate check for this level** (section 3.3), all-in at $1,000 of payout over the clipped fair:
  - Yes is 3.66c over and No is 1.30c over, both inside G = 5c;
  - the smaller side's size is $720, above S = $100;
  - so the row is live.

**Ticket in stage 1** (the bought leg always comes first):

```
1  BUY   BTC-20261009-83000-C   0.04407   limit 2431
2  SELL  BTC-20261009-89000-C   0.04407   limit 162
   Place line 2 only after line 1 has filled.
   If both fill at these limits: net 2,269 per contract, $99.99 in all.
   Settles Fri 9 Oct, 30-minute average to 08:00 UTC.
```

### 2.3 Two more examples, chosen because they show the limits

**ETH above $2,700 on Fri 9 Oct.** The zone is $200, 2,600/2,800, which is 7.5% of the $2,680.74 index. It is also this date's headline.

| | Yes | No |
|---|---|---|
| Mark | 43.25c raw, 43.05c clipped (the 2,800 call's mark of 13.5 sits below its 13.9 bid) | |
| Buy | 46.05c, shown 47c | 59.60c through the call twin, shown 60c |
| Sell-back | 40.40c, shown 40c | |
| Gap | 7c shown, 5.65c raw | |

- **The $100 ticket.** ETH's amount step is 0.01, so a $100 Yes ticket is 1.08 contracts: $99.47 of premium, up to $216 of payout, and $2.74 in book fees.
- **Size is the limit.** At the shown price there are only 0.2 contracts ($40 of payout) on Yes, set by the 2,600 call's ask, and $148 on No.
- **Gate result.** The cost passes (Yes 3.90c, No 3.55c over fair), but the size does not reach S = $100, so **this date is not live for ETH at this snapshot**. At 14:00, ETH's 5, 6 and 7 Oct dates pass. 9 Oct, 16 Oct and 30 Oct fail on size ($40-60), and 23 Oct fails on cost (8.1c on Yes).

**BTC between $84,000 and $86,000 on Fri 9 Oct.**
- As a condor (buy the 83,000 call, sell the 84,000 and 86,000 calls, buy the 87,000 call), the mark is 47.0c and the screen buy is 62.4c: 15c over fair.
- The 84/85/86 butterfly has a mark of 16.1c and a buy of 32.2c.
- Neither can be offered on the screen (section 3.4).

## 3. Which questions to offer

The rule in short: **one fixed zone per date, wide enough that the screen price stays close to fair**. Hourly gates then decide what is live.

The evidence:
- `economics.md`: 475,665 questions over 42 hourly snapshots, 1 Oct 21:00 to 3 Oct 14:00 UTC.
- The zone study in `work-design2/`, run over the same 42 snapshots.

Unless a line says otherwise, the economics.md figures are measured against Derive's raw mark. The gates below use the clipped mark.

### 3.1 Coins

**BTC and ETH only in stage 1.** The reason is the cost and depth on the screen, not missing quotes.

Near-the-money coverage on the real dates is high for several other coins. The figures below are two-sided quotes within 10% of the index, from each coin's latest kept chain (3 Oct 00:00), for expiries 1-35 days out:

| Coin | Two-sided near the money | All-in over fair at a 7-11% zone (worse side) | Top size |
|---|---|---|---|
| HYPE | 25/32 (4 Oct); 28/28 (9 Oct); 16/16 (16, 23, 30 Oct) | 3.8-6.5c | $60 on 4 and 9 Oct; $5,000 on 16-30 Oct |
| SOL | 18/18 to 26/26 on 9-30 Oct | 5.7-14.7c | $48 to $2,000 |
| XRP | 100% on 9-30 Oct | 12.9-22.0c | $40 to $674 |
| ZEC | 100% on 9-30 Oct | 13.7-19.0c | $1,000-1,530 |
| XAUT | 21/22 to 14/14 | 2.3-5.7c | $56 to $4,000 |
| VVV | 9/12 to 14/14 | 27-31c | $216 |
| ADA, CC | 0 | none | none |

That is one snapshot per coin, so treat it as indicative. Two facts follow:
- HYPE and XAUT sit near the gate. SOL, XRP, ZEC and VVV are far off it.
- The earlier citations ("SOL 13 of 56", "HYPE 1 of 60") were same-day expiries read eight hours before expiry. They do not describe the dates Questions would offer.

**A coin opens by itself** when at least 3 of its dates pass the date gate (3.2) in at least 18 of the last 24 hourly checks. On the recorded data:
- BTC has 3 or more passing dates in 42 of 42 snapshots.
- ETH has 3 or more in 38 of 42, so both open.

**The gate check costs nothing for every coin.** The recorder already reads every coin's full tickers every 15 minutes (4.2). The only extra need is a chart for those coins (decision 11).

### 3.2 Dates

| Time to expiry | Stage 1 | Reason |
|---|---|---|
| under 1 day | **leave out** | BTC adjacent all-in 11.6c; no listed width clears 3c; top size about $40 (economics.md) |
| 1-35 days | offer, when the date passes the gate | dailies, the coming Fridays and the month end |
| over 35 days | **leave out** | about half the strikes lack a two-sided quote |

**What that gives on the real list at 3 Oct 14:00.** The live BTC and ETH expiries are 4, 5, 6, 7, 9, 16, 23 and 30 Oct, then 27 Nov, 25 Dec, 26 Mar, 25 Jun and 24 Sep.
- **4 Oct is out:** 18 hours from 14:00.
- **8 Oct is not there yet.** Derive lists it, but it becomes tradable only at 4 Oct 08:00 (`scheduled_activation`; dailies open about four days ahead).
- **27 Nov and later are out:** more than 35 days.
- **That leaves seven dates per coin: 5, 6, 7, 9, 16, 23 and 30 Oct.** All seven pass for BTC at 14:00. For ETH, three pass (5, 6 and 7 Oct).

**Date gate.**
- A date tab appears when its headline level (3.3) has passed the cost and size gates in at least 3 of the last 4 hourly checks.
- The default tab is the nearest date shown.
- A date whose gate lapses keeps its tab until it has failed 4 hourly checks in a row, so tabs do not flicker.
- While a date fails, its rows show their prices but their buttons follow the level rule in 3.3.

**Labels.**
- Dailies: "Mon 5 Oct".
- The coming Friday: "This Friday · 9 Oct".
- Later Fridays: "Fri 16 Oct".
- The last Friday of a month: "End of Oct · Fri 30 Oct".
- Later, when dates over 35 days are added: "End of Q1" and "End of year".

**There is no "Tomorrow" label.** Under the 1-day rule, the next day's 08:00 expiry is on the board only between 00:00 and 08:00 UTC. A label that exists for 8 hours a day is more confusing than a plain date.

### 3.3 Zone width, levels and the gates

**Width is the lever.** Cost per $1 falls roughly as 1/width. The table gives all-in cost on the screen near the money (fair about 50c) at $1,000 of payout, from economics.md against the raw mark. The 9-35 day columns give their actual widths in brackets:

| Zone as % of spot (1-4 day columns) | BTC 1-4d | BTC 9-35d | ETH 1-4d | ETH 9-35d |
|---|---|---|---|---|
| about 1% (adjacent strikes) | 11.3c | 7.4c (2.3%) | 18.6c | 11.7c (1.9%) |
| about 2.4-2.8% | 5.8c | 3.9c (4.7%) | 7.4c | 6.0c (3.7%) |
| about 4.7-5.6% | 3.3c | 2.8c (6.9%) | 3.8c | 3.3c (7.4%) |
| about 7-9% | 2.0-2.4c | 2.2c (9.2%) | 2.6-3.2c | 2.9c (9.3%) |

**Why the zone is fixed rather than picked hourly.** A picker that chose "the narrowest zone that passes the gate" on each snapshot changed its width on 27-42% of hourly steps (BTC 74-107, ETH 88-115 of 276, at G = 5c and S between $50 and $200). Question ids encode their strikes, so every flip would put a second set of questions on the same date. The width must therefore be fixed.

**The zone rule.**
- **Choosing it.** When a date first enters the board, its zone is set to the smallest symmetric width made of listed strikes near the forward that is **at least 6.5% of the index** (`min_zone_pct`, one value per coin, 6.5% for both today) **and gives at least 4 valid levels within 7% of the forward**. The second condition matters on coarse grids: on BTC 30 Oct a $6,000 zone gives only one valid level (85,000), so the rule takes $8,000, which gives six. If no width qualifies, the date stays off the board and the rule is tried again at the next check; nothing is frozen until a width qualifies.
- **Keeping it.** The zone then stays fixed for the life of that date.
- **One exception.** The zone may change at most once, and only toward 6.5%. That can happen when Derive lists new strikes that allow a narrower width that is still at least 6.5%, and only while the date is more than 7 days out.
- **Old ids.** When the zone changes, the old zone's ids become `retired`: they are off the ladder, still priced in the file until they settle, and still shown in My questions and at their own page.

At 3 Oct 14:00, treated as the first sight, the rule gives:
- BTC: **$6,000** (7.1%) for 5, 6, 7 and 9 Oct, and **$8,000** (9.4%) for 16, 23 and 30 Oct, where strikes near the money are mostly $2,000 apart.
- ETH: **$200** (7.5%) for every date.

**Levels.**
- A level is a listed strike K whose zone ends K - w/2 and K + w/2 are also listed.
- The ladder shows **up to seven valid levels centred on the price now**. "More levels" shows up to 15.
- Spacing follows Derive's listed strikes and can be uneven, because a level needs both zone ends listed. At 14:00 the valid levels within 7% were:
  - BTC 9 Oct ($6,000 zone): 81, 83, 84, 85, 86, 87 and 89k (82k and 88k are missing because 79k and 91k are not listed);
  - BTC 16 Oct ($8,000): every $2,000 from 80k to 90k;
  - BTC 23 Oct: only four levels;
  - ETH 9 Oct ($200): every $50 from 2,500 to 2,850, plus 2,725.
- The board never invents a level to fill a gap.
- Only levels whose Yes buy lies between 3c and 97c are shown.

**The headline "Up or down from $K".**
- K is the valid level nearest the expiry's forward (the median `option_pricing.f` of that expiry's options).
- It moves to a new level only after the forward has been nearer that level for two slots in a row (30 minutes).
- When it moves, the old headline stays in the file as an ordinary row, so a holder can still find it.
- At 14:00 the headlines were:
  - BTC 9 Oct: $85,000, as 82,000/88,000. Up pays in full from $88,000 (3.7% above the index) and 50c at $85,000.
  - ETH 9 Oct: $2,700, as 2,600/2,800.

**The gates.** One definition, in one `QUESTION_GATES` dict, used everywhere:

| Gate | Definition | Proposed value |
|---|---|---|
| Fair | each leg's mark clipped into its own [bid, ask] when both exist, then combined as the package | none |
| Cost G | all-in cost over fair at $1,000 of payout, fees included at the book schedule, on the cheaper construction, tested on **both** Yes and No; the **worse** side must clear | 5c in stage 1; 3c once RFQ exists |
| Size S | top-of-book size of the construction used, in dollars of payout, on **both** sides; the **smaller** must clear | $100 |
| Date gate | the headline passes G and S in at least 3 of the last 4 hourly checks | none |
| Coin gate | at least 3 dates pass in at least 18 of the last 24 hourly checks | none |
| Level buttons | a side is live when that side clears G at $1,000 of payout and has at least $50 of payout at the top of the book; otherwise it shows an em dash (state `screen_wide` or `no_quote`) | none |

**What these settings give over the 42 recorded snapshots** (headline level of every date 1-35 days out, `policy.py`):

| Coin | Zone | S = $200 | S = $100 | S = $50 |
|---|---|---|---|---|
| BTC | 6,000 / 8,000 (min 6.5%) | 88% of date-checks pass; 3+ dates live in 41 of 42 | 95%; 3+ dates in 42 of 42 | 95% |
| ETH | 200 (min 6.5%) | 61%; 3+ dates in 33 of 42 | 75%; 3+ dates in 38 of 42 | 86%; 39 of 42 |
| ETH | 250 / 300 (min 9%) | 60% | 84%; 3+ dates in 40 of 42 | 94%; 42 of 42 |

- **For BTC, cost is rarely the binding gate.** At 6.5% zones the worse side is 1.9-4.0c over fair at 14:00 on all seven dates.
- **For ETH, size is the binding gate.** Near-the-money ETH options often show only 0.2-0.7 contracts at the top of the book, which is $40-150 of payout on a $200 zone. The proposal is S = $100 for both coins. Lowering ETH to $50, or widening ETH zones to 9%, are the owner's alternatives (decision 2).
- **Above the shown size, the ticket caps the amount** ("Up to $720 at this price").
- **Narrower zones fail more often.** A 4.7% BTC zone (4,000) passes 62-67% of checks, and ETH at 5.6% (150) passes 54-76%.
- **Part-pays are common.** With adjacent strikes, 13-22% of above/below questions settled inside their zone on 1-3 October. A 6.5% zone makes part-pays more common still, which is why the pay zone is always shown (decision 3).

### 3.4 Left out of stage 1

- **Between (condors and butterflies).** On the screen they cost 12-30c over fair, wings are often unquoted, and some asks are absurd (a 5c fair asking 86c). Show the bands with an em dash on both buttons, or hide them until RFQ (decision 4).
- **Dates under 1 day and over 35 days**, as in 3.2.
- **Adjacent-strike and other narrow zones near the money**, which cost 6-19c all-in.
- **Any side whose computed buy is over $1 or whose sell-back is under $0.** That is 1.2% and 13% of leg-by-leg prices: OTM legs with no real bid, or ITM legs with stale asks. These sides are treated as unquoted.
- **Every coin other than BTC and ETH**, until the coin gate in 3.1 passes.

## 4. The price we show, and how fresh it is

### 4.1 Fair, executable, or both

**The buttons show the executable buy price** per $1:
- taken leg by leg at the top of Derive's book;
- on the cheaper of the two constructions;
- with fees excluded.

Buy prices round up to a whole cent and sell-back prices round down, so the screen never shows a better price than the book. (ux.md's example shows "Yes 36c" for 36.03c. Under its own round-up rule that is 37c; this document follows the rule.)

**Fair appears only as shape and in detail.** Fair is Derive's mark, clipped per leg into [bid, ask]. It is used in three places:
- the thin unlabelled bar on each board row;
- the line on the question's chart;
- one line in the price (i): "Mark on Derive 35c".

It is never on a button, never called a chance, and never shown as a percentage.

**Why the clip.** Derive's mark can sit outside its own book. At 14:00 the 84,000 call's mark of 1,582 was below its 1,598 bid. Unclipped, the 84,000/88,000 Yes would show a sell-back (32.45c) above its fair (32.22c). Clipped, fair is 32.62c and the order is always sell-back <= fair <= buy.

**The gap is visible.** "Gap 4c" appears on the question page: the shown buy minus the shown sell-back, the one definition from 2.2. An (i) beside Yes and No explains why the two prices add up to more than $1.

**Fees have their own line in the ticket**, from Derive's schedule. Against 4,358 recorded fills the schedule is an upper bound: 62% matched it exactly and the rest paid less.

**Stage 2 shows the RFQ quote** plus Derive's fees. The quote's `total_cost` does not include the taker fee or the base fee, so the screen adds them before showing the price.

### 4.2 Freshness: 15-minute prices at no added cost

The recorder already reads every quote the board needs, every 15 minutes, for every coin with options:

- **Every slot.** In every 15-minute slot, `Recorder.snapshot` (`backend/derive/recorder.py`) calls `public/get_tickers` for every live expiry of every coin, plus the perp. Each ticker carries bid, ask, their sizes, mark, the forward and the index.
- **What is kept.** Only the storage of the raw chain is hourly (BTC, ETH) or daily (other coins), set by `DERIVE_CHAIN_EVERY_SEC=3600` and `minor_chain_every_sec=86400`. "Hourly chains" is a storage choice, not a fetch rate.
- **When the step runs.** The workflow's Record step runs whenever a 15-minute slot is due.

Questions computed in `record_once.py`, from the tickers already in memory, therefore come every 15 minutes:

- **No added exchange reads in the record step.** The request count per run is unchanged.
  - The one addition is one `public/get_option_settlement_prices` call per coin per day after the 08:00 expiry. It is needed because `history_once.py` refreshes settlements only when it adds a day, around 01:00 UTC.
- **No added data-branch storage for prices.** `questions/{UND}.json` lives on `site-data`, which is replaced every run (about 40-60 KB for BTC).
  - The only data-branch addition is a small gate-state file (B2).
- **Under a second of CPU** in the record step.

**How old the prices are when someone looks.**
- `prices_ts` is the slot start (:00, :15, :30, :45).
- The external cron starts the Action every 5 minutes, so the tickers are read 1-6 minutes into the slot. Showing the slot start therefore overstates the age slightly, which errs on the safe side.
- The run then publishes `site-data` a few minutes later.
- raw.githubusercontent.com can cache a file for up to about 5 minutes, and the app re-reads each file every 5 minutes (`useData`).
- Typical age is 5-15 minutes. The worst case with nothing failing is about 25-30 minutes.

**Stale rule.** This replaces ux.md 8.2, which assumed hourly prices.

| Age of `prices_ts` | Treatment |
|---|---|
| up to 35 min | normal; the time sits beside the coin price ("prices 14:15 UTC") |
| 35-90 min | the time turns amber ("40 min old") as plain text, not a pill; the ticket adds "Check Derive's screen first" |
| over 90 min | buttons become em dashes, bars turn grey, and a line reads "Prices paused since 13:00 UTC" |

A live worker would cost about $5-10 a month. The owner decided on 3 October to stay on 15-minute updates, and that holds here.

**What the ticket's limits protect, and what they do not.** Derive's order book takes two separate limit orders. It has no package or net limit.
- Each per-leg limit keeps that leg from filling at a worse price than shown.
- The net shown (2,269 per contract in 2.2) is reached only if both legs fill.
- If the book moves before the second leg fills, the user is left holding the bought leg alone. That position has defined risk and needs no margin, and the user has three choices:
  - wait;
  - lower the sell limit and accept a worse net;
  - sell the bought leg back.
- The ticket says this in one line, with the detail in (i) (section 8, leg risk).

## 5. Settlement and sell-back

**Settlement.** Every BTC and ETH option expires at 08:00 UTC, and trading stops 60 s before (`scheduled_deactivation`).
- Derive settles in USDC at the average of 1-minute index prints from 07:30 to 08:00 UTC. The published prices for 1-3 October matched that average within 0.1-1.3 bp.
- No exercise is needed. Derive's fee schedule lists no settlement fee.
- The settlement can land well away from the 08:00 price. On 2 October BTC stood at $86,097 at 08:00 but settled at $85,870.84, so the 85,500/86,000 question paid 74c (0.7417).
- Copy therefore always says "the 30-minute average to 08:00 UTC", never "the price at 08:00".
- The question's rule, clip((S - K1)/w, 0, 1), matched the legs' intrinsic values on all 8,243 checked rows.

**In the app:**
- From 07:30 UTC on the settlement day, a question reads "Settling" (plain text, not a pill), and its buttons and sell-back go away.
- Once Derive publishes the price, the row reads "Settled $85,871 · Yes paid 74c" for 24 hours, then leaves the board.
- The question page keeps working at its id, with the final point on the chart.
- A settled result is always worded as an amount paid per $1, never just Yes or No, because part-pays are routine: on 1-3 October, 13-22% of above/below and 24-35% of between questions settled inside their zone.
- Derive may delay or rerun a settlement in a disruption (its Oracle, Mark Price and Settlement Policy, section 4.2). Until the price is published, the row stays "Settling".

**Sell-back in stage 1.** The user can close at any time before 07:59 UTC by reversing the legs on Derive:
- **The short leg is bought back first**, then the bought leg is sold, so the account never holds a lone short.
- The sell-back ticket gives limits at the current sell-back prices, with the same caveat about separate orders.
- The real cost of getting out early is the screen's gap. For BTC 9 Oct 86,000/87,000 the buy-to-sell gap stayed between 5c and 15c over 41 hours, while fair moved about 9c for each 1% move in BTC (economics.md, adjacent strikes). Wider zones narrow it: 4c on the 6,000 zone in 2.2.
- Doing nothing is always fine, because the package settles by itself.
- When one leg has no bid, My questions shows "Now worth: —" and notes that it settles by itself.

**Sell-back in stage 2.** One RFQ in the opposite direction, one signature.

## 6. Stage 1 build plan

Stage 1 is built in passes, in order, and each pass is merged on its own. It builds on the current repo:
- **Recorder:** `backend/derive/recorder.py` and `backend/record_once.py`.
- **Publish step:** `backend/publish_site.py`. Each run restores `site-data` from the previous run (the "Previous app data" step) and force-pushes it.
- **Action:** `.github/workflows/record.yml`. The Record step runs `record_once.py --out ../store --site ../site` whenever a slot is due.
- **Frontend:** `frontend/src` (React 18, react-router 7, lightweight-charts, vitest). Each screen reads published files through `lib/data.js` `useData`. Page tests sit in `src/*.test.jsx` and lib tests beside the lib.

Nothing in stage 1 calls a private endpoint, holds a key, or places an order.

**Release gate.** The Questions nav item and routes stay behind a build flag (`VITE_QUESTIONS=1`, off in production) until the owner has answered decision 1.

### B1. Question maths and the zone policy

**Files:**
- `backend/derive/questions.py`: pure functions, with no network and no IO.
  - Parse instrument names, always replacing "_" with "." in strikes.
  - Build a level's legs for both constructions.
  - Price per $1: clipped fair, buy and sell-back, with clamping and validity.
  - Top-of-book size as dollars of payout.
  - Book and RFQ fee estimates per Derive's schedule. Read the taker rate, base fee and cap from the instrument fields; do not hard-code them.
  - Date labels: "Mon 5 Oct", "This Friday", "Fri 16 Oct", "End of Oct"; no "Tomorrow".
  - The zone rule: the smallest width of at least `min_zone_pct` with at least 4 valid levels within 7% of the forward, set when a date first qualifies; at most one change toward `min_zone_pct`; old ids marked `retired`.
  - The headline rule (nearest valid level to the forward, two-slot hold).
  - The gates of 3.3.
  - Level selection: 7 or 15 levels, Yes inside 3c-97c.
  - The question id `{UND}-{YYYYMMDD}-A-{lo}-{hi}`.
  - States: `open`, `screen_wide`, `no_quote`, `tail`, `retired`, `settling`, `settled`, `paused`.
  - The payout rule.
- All gates and thresholds live in one `QUESTION_GATES` dict: G, S, the $50 side minimum, `min_zone_pct` per coin, the 4-level minimum and its 7% band, the 3-of-4 and 18-of-24 windows, and the 1-day and 35-day limits.
- `backend/questions_sweep.py`: a report script that replays the zone rule and gates over every kept hourly chain on the data branch. It reports:
  - per coin and date, the frozen zone and the share of checks the headline passes;
  - how many dates pass per snapshot;
  - how many times a date's zone or headline changed.

  Run it before G, S and `min_zone_pct` are fixed, and again after a few weeks of recording.

**Tests** (`backend/tests/test_questions.py`). The fixture is `tests/fixtures/chain_btc_eth_20261003_14.json.gz`, a trimmed copy of the 3 Oct 14:00 BTC and ETH chains (the 5 Oct to 30 Oct expiries and the perps). The tests check:
- **The 2.2 example exactly:**
  - fair 0.3502;
  - buy 0.3782, shown 38c;
  - sell-back 0.3463, shown 34c;
  - No 0.6537 through the call twin, shown 66c;
  - gap 4c shown (0.0318 raw);
  - Yes size $26,496 and No size $720;
  - a $100 ticket of 0.04407 contracts, $99.99, $264.42 payout and $3.01 in book fees;
  - minimum 0.01 = $60 of payout for $22.69 plus $1.46;
  - gate: Yes 3.66c and No 1.30c over fair, so the level is live.
- **The ETH example:**
  - 1.08 contracts (step 0.01), $99.47, $216 payout, $2.74 in fees;
  - Yes size $40, so the date fails S = $100.
- **The clip:** the 84,000/88,000 Yes has fair 0.3262 after clipping, and the test checks that sell-back <= fair <= buy on every fixture level.
- **Payout identities:** Yes + No payout equals 1 at every settlement price, and the payout rule equals the legs' intrinsic sum at the recorded 2-3 October settlements.
- **Parsing:** `1_35` parses as 1.35.
- **Unusable prices:** a buy over $1 or a sell-back under $0 gives `no_quote`.
- **The date list:** from the fixture chain at 14:00, the board's dates are exactly 5, 6, 7, 9, 16, 23 and 30 Oct, with labels "Mon 5 Oct", "Tue 6 Oct", "Wed 7 Oct", "This Friday · 9 Oct", "Fri 16 Oct", "Fri 23 Oct" and "End of Oct · Fri 30 Oct".
  - 4 Oct is out (18 hours).
  - 27 Nov and later are out.
  - A synthetic expiry 30 hours ahead at 02:00 UTC is in; the same expiry at 09:00 UTC (23 hours ahead) is out.
- **The zone rule, with the fixture as first sight:**
  - BTC gets 6,000 for 5, 6, 7 and 9 Oct and 8,000 for 16, 23 and 30 Oct (30 Oct skips 6,000 because it gives one valid level);
  - ETH gets 200 for every date;
  - the BTC 9 Oct headline is 85,000 (82,000/88,000);
  - all seven BTC dates pass and ETH passes 5, 6 and 7 Oct.
- **Zone stability:** feeding the hourly snapshots in order never changes a date's zone except by the one allowed step, and a retired id stays priced.

**Done when:** `python -m pytest` passes, every number in sections 2 and 3.3 comes out of the code unchanged, and the sweep report on the copy of the data branch reproduces the 3.3 table.

### B2. Publish the board every 15 minutes

**Files:**
- `derive/recorder.py`: keep the newest tickers per key in memory (`self.chains[key] = {"options": tickers, "perp": perp, "ts": ts}`), the same way `self.strikes` is kept today. Nothing new is fetched.
- `record_once.py`: after recording, for each coin, call `questions.build(...)` and write `site/questions/{UND}.json` and `site/questions/index.json` (the coins and dates that pass, with `prices_ts`). This follows the existing `strikes/{UND}.json` pattern: written by `record_once.py`, then left in place by `publish_site.py`. The shape follows ux.md section 9, with these changes:
  - `prices_ts` is the 15-minute slot start;
  - each date carries its frozen `zone`, `zone_set_ts` and `headline`;
  - each side carries its `construction`, legs, the fee inputs, and a `size` in dollars;
  - `fair` is the clipped mark;
  - ids are sticky: once published for a live date, an id stays in the file (possibly as `tail`, `no_quote` or `retired`) until it settles, so My questions can always price a held position.
- `questions/state.json` on the data branch (a few KB): each date's zone and when it was set, the headline and its hold counter, and the hourly gate results for the 3-of-4 and 18-of-24 windows. The state has to survive across runs and cannot be rebuilt from `site-data` alone.
- `publish_site.py`: leave `questions/` untouched, and add it to the docstring's file list.
- `README.md`: the file shapes.

**Tests:**
- With a fake client, a recorder run makes exactly the same exchange calls with and without questions.
- `record_once` with `--site` writes valid files for the fixture.
- A run of `publish_site.py` afterwards leaves `site/questions/` byte-identical.
- A coin failing the coin gate gets no file.
- An expired date is dropped.
- `prices_ts` older than 90 minutes gives `paused` at publish time (the frontend checks as well).
- With `state.json` present, the zone does not change between two runs on different snapshots.

**Done when:**
- A local run on a copy of the data branch writes `questions/BTC.json` and `questions/ETH.json` (about 40-60 KB each).
- The Action's record step takes under 2 s longer.
- The request count in `runs/` is unchanged.

### B3. History, settlement, and the coin link

**History.** `derive/questions.py` and `record_once.py` keep an hourly history per date, `site/questions/history/{UND}-{YYYYMMDD}.json`. It is columnar: `ts[]`, `index[]`, and per id `fair[]`, `buy[]`, `sell[]`. Rows are appended at the hourly slots from the tickers in memory.
- **Storage.** It is a cache on `site-data`, carried from run to run by the "Previous app data" step. It adds no data-branch storage.
- **Rebuild.** When the cache is missing or its schema changes, it is rebuilt from the data branch's kept hourly chains, with the work bounded per run as the replay cache is. The first kept hourly chain is 1 Oct 21:00 UTC. The Railway data before 20:15 was not migrated, so a rebuild starts there.
- **Retention.** Settled dates are kept 90 days, thinned to 4 points a day.

**Settlement.** After 08:00 UTC, make one `public/get_option_settlement_prices` call per coin and write it to the existing `history/settlements/{UND}.json`. Each settled question then gets `settle_price` and `paid`.

**Coin link.** In `markets.json` and `coins/{UND}.json`, add `questions: true` when a coin passes the coin gate, so the Options step can show "Questions on BTC".

**Tests:**
- History appends once per hour, and a rebuild from the fixture chains equals the appended cache.
- A rebuild never expects rows before 1 Oct 21:00 UTC.
- `paid` equals the intrinsic payout at the recorded settlement prices: 2 Oct BTC at 85,870.84 makes 85,500/86,000 pay 0.7417.
- Questions from 07:30 to 08:00 are `settling`.
- The cache stays under its size limit (about 150 KB per date before gzip).

**Done when:**
- The Action runs twice on a copy of the data branch: the first run rebuilds the history from 1 Oct 21:00, and the second only appends.
- A settled date shows paid amounts.
- The published size across both coins stays under about 3 MB.

### F1. Data and maths on the client

**Files:**
- `frontend/src/lib/questions.js`:
  - load `questions/index.json`, `questions/{UND}.json` and the history through `useData`;
  - price formatting: round up for buy, round down for sell-back, whole cents, an em dash when missing;
  - the gap (shown buy minus shown sell-back);
  - the stale state from `prices_ts` (35 and 90 minutes);
  - contracts from a dollar amount, floored to the instrument's step and minimum (BTC 0.00001 and 0.01, ETH 0.01 and 0.1), and capped at the published size;
  - the fee estimate;
  - "Pays up to", "Most you can lose", "At $K" and "$1 from $K2";
  - the countdown.
- `frontend/src/lib/positions.js`: My questions storage in `localStorage`. Every read and write is wrapped in try/catch, with an in-memory fallback when storage is blocked.

**Tests:**
- `lib/questions.test.js` reproduces 2.2: a $100 ticket gives 0.04407 contracts, $99.99, $3.01 in fees, $264.42 payout and $132.21 at $86,000, with a gap of 4c.
- It reproduces 2.3 ETH: 1.08 contracts, $99.47 and $216; and $100 is capped at the $40 shown size.
- 0.01 BTC and 0.1 ETH are the minimums.
- Rounding goes in the right direction.
- The stale thresholds are 35 and 90 minutes.
- Fractional strikes parse.

**Done when:** all tests pass and nothing in `lib/` fetches anything except published files.

### F2. Board

**Files:**
- `frontend/src/pages/Questions.jsx` (routes `/questions` and `/questions/:und`);
- `components/QuestionLadder.jsx`;
- `questions.css`, using the existing tokens;
- routes in `main.jsx` behind the flag;
- the nav item in `components/Shell.jsx`.

**What it shows:**
- Coin tabs and date tabs, as underlined text.
- The "Up or down from $85,000" headline row.
- Seven levels, with the orange "now" hairline and the unlabelled fair bars.
- In every row: Yes and No buy prices, the pay-zone ramp, and the full-pay line ("$1 from $89,000"), not only in (i).
- Yes and No buttons that are neither green nor red.
- "More levels".
- A footer with the settlement time and the zone (i).
- Between handled per decision 4.

**Tests** (`src/questions.test.jsx`, rendering the fixture JSON):
- **Ramp and full-pay line:** every row with a Yes/No pair, the Up/Down headline included, renders the ramp and the "$1 from" line.
- **Wordcheck:** every visible string and every (i) on the route passes the banned-word check.
  - It matches word stems, not only exact words: `will`, `expect*`, `likely`, `predict*`, `target*`, `probab*`, `odds`, `chance*`, `forecast*`, `\bbet(s|ting)?\b` (so "between" passes), `\bedge(s)?\b`.
  - It also flags any `%` in Questions copy, except in the zone (i).
- **No pills:** no pill classes, and "Settling", stale and paused labels render as plain text.
- **States:** the stale and paused states render.
- **Gaps in the data:** an unquoted side shows an em dash, and a date that fails its gate has no tab.

**Done when:** the board renders at 375 px and 1440 px, in dark and light, with no sideways scroll, and the wordcheck passes on the route.

### F3. Question page

**Files:**
- `pages/Question.jsx` (`/q/:id`).
- `components/PayZone.jsx`: the 0-to-$1 ramp, which flips for No. It shows "At $86,000: 50c" and "$1 from $89,000".
- `components/QuestionChart.jsx` (lightweight-charts): the hourly fair with a buy/sell band, which can be switched to the coin's index with the level dotted.
- The amount panel.
- "Context, not advice": the three `Chain.jsx` tiles, 7-day for settlements within 10 days and 30-day beyond. No tile links to a side.
- Rules (i).
- Layout: three columns on desktop (board, question, ticket); one column on mobile with a sticky action bar.

**Tests:**
- The amount panel figures for 2.2.
- The "Most you can lose" line appears before any action button.
- A retired or settled id loads its view from an old link.
- The context tiles carry no "agrees" or "matches" text.

**Done when:** on mobile at 375 x 667 the question, the buttons and the ramp sit above the fold, and an old settled link shows the settled view.

### F4. Ticket (copy to Derive)

**Files:** `components/QuestionTicket.jsx`, a bottom sheet on mobile and the right column on desktop.

**What it shows:**
- The legs as numbered lines: exact instrument names (keeping Derive's underscore), contracts, and per-leg limits on the tick (BTC $1, ETH $0.10).
- The bought leg on line 1, and "Place line 2 only after line 1 has filled."
- "If both fill at these limits: net X", worded as the result of both fills, not as a guarantee. The (i) explains the lone-leg case and the three choices from 4.2.
- "Up to $X at this price" when the amount reaches the published size.
- "Copy both".
- "Open Derive", which links to the coin's options page only, since no deep link is documented.
- "I placed it", which saves to My questions.

**Credit twin, when used:**
- The money lines read: "You receive $X now. Derive holds $W against it. Most you can lose: $W - X + fees."
- The bought leg still comes first.

**Sell-back sheet:** the legs reversed, with the short leg bought back first.

**Tests:**
- The copied text for 2.2 is byte-exact.
- The bought leg is always line 1.
- On sell-back, the buy-back is line 1.
- Limits sit on the tick.
- A fractional-strike name round-trips.
- No ticket text promises a net price.

**Done when:** the copied text pastes cleanly, and a dry walk through the ticket on Derive's site (reading only, placing nothing) matches its fields.

### F5. My questions

**Files:** `pages/MyQuestions.jsx` (`/questions/mine`), with Open and Settled tabs.

**Open positions:**
- "Now worth" uses the published sell-back price.
- The fair value sits in (i).
- "Settling" from 07:30.
- An em dash when there is no sell-back price.

**Settled positions:**
- They show "Got $X (74c per $1)", from the published `paid`.
- They are kept for 90 days.

**Browser only, with no wallet matching.**
- The flow files keep only large trades and per-wallet totals, so they cannot confirm a $100 ticket.
- Matching wallets would also step closer to the data-terms issue.

**Export and import** as a JSON file is offered, since browser storage can be cleared.

**Tests:**
- Storage that throws falls back to memory.
- A position on a retired or off-ladder level is still priced.
- The settled maths.
- The empty state.

**Done when:** a position that is saved, reloaded, settled and exported behaves correctly with storage both on and blocked.

### F6. Finish and release check

**Work:**
- The "Questions on BTC" link in the coin page's Options step, from B3's flag.
- The wordcheck on every Questions route, including every (i).
- Screenshots at 375, 400 and 1440 px, in dark and light.
- A payload check: board under 60 KB, per-date history under 60 KB gzipped.
- `CLAUDE.md` and `README.md` updated.
- Derive's restriction notice (who may not use Derive) linked from Rules (i), worded per legal.

**Done when:**
- All frontend and backend tests pass.
- The Action has run for 24 hours on `main` with questions published every slot and no zone changes beyond the rule.
- The owner has reviewed a preview with the flag on.
- Decision 1 is answered before the flag goes on in production.

## 7. Stage 2 outline: one-tap execution through RFQ

Stage 2 is built only with the owner's explicit approval: on Derive testnet first, in dry-run, and on **V3 only**. V2's onboarding docs are no longer hosted, and V3 mainnet is listed as "coming soon".

What it needs:

1. **Wallet connect.**
   - The user's own EOA or multisig, through a standard browser wallet.
   - This means new frontend dependencies, not a server.
   - Cowboy never holds funds or the user's owner key.

2. **Deposit and subaccount (V3).**
   - The user deposits USDC on Ethereum L1, either directly through `depositToNewSubaccount` or through a per-user deposit address.
   - The first deposit creates the subaccount. The minimum on testnet is $5.
   - BTC and ETH sit in the PRIME risk universe under the standard margin manager. Other coins need a subaccount per universe (MIDCAP, ALT, RWA).
   - Cowboy shows the steps; Derive holds the funds.

3. **Session key.**
   - Generated in the user's browser.
   - Registered with `private/set_session_key` and signed by the user's wallet.
   - Scoped to `trade:rfq:option`, that one subaccount, and a short expiry (for example 7 days).
   - Kept in the browser only, never on a Cowboy server. It can quote and trade questions but cannot move funds.

4. **RFQ.**
   - `private/send_rfq` with the package legs and a `max_total_cost`.
   - The best quote comes from `private/rfq_get_best_quote` or the quotes channel.
   - The user signs `private/execute_quote`: EIP-712 under the RFQ module, with `max_fee`, under V3's nanosecond nonce and signature-expiry rules.
   - The package fills atomically at one total cost, and Derive's taker protection rejects a quote worse than the book.
   - **The quote screen never shows the maker or any counterparty**, only the package price plus Derive's fees (which `total_cost` excludes). This keeps the rule that market makers are never shown.
   - The "Review", "Sign and buy" and "Done" screens are in ux.md 5.2.
   - Sell-back is the same flow reversed. Positions come from the user's own `private/get_positions`.

5. **Builder fee.**
   - `extra_fee` with `referral_code` is accepted on `send_rfq` and `rfq_get_best_quote` after joining Derive's API Broker program. It is paid to the builder's wallet every 4 weeks.
   - Its unit, from the docs: the builder-fees page gives a range of 0.000001-1,000 USDC, and the trading-fees page's `max_fee` formula adds `extra_fee / amount` per contract. Both read as a **total in USDC per order**, not a per-contract rate. The API schema's wording ("per unit of volume") disagrees, so confirm with Derive before building.
   - Any builder fee adds directly to the 1-2c RFQ all-in cost. Keeping the total under 3c leaves about 1c.
   - Separately, the API Broker program pays brokers 10% (rising with volume) of net exchange fees on referred trades, with no builder fee needed. Its "referral links" pre-fill `referral_code`. Stage 1's "Open Derive" link could carry one at no cost to the user. That needs the owner's approval and belongs to decision 9.

6. **Cost model.**
   - Every private call goes from the user's browser to Derive, made by the user for the user's own trading. Cowboy adds no server and no shared exchange reads. Pages that do not trade stay on published JSON.
   - Open: whether Derive's API accepts calls from a browser origin (CORS). If it does not, a minimal relay costs money and needs a decision.

7. **Questions for Derive before building.**
   - The maximum number of RFQ legs (error `rfq_too_many_legs` exists; no number is published).
   - The minimum RFQ size.
   - Whether `partial_fill_step` (documented default 1, "the minimum fill increment") makes an RFQ for 0.04407 contracts fail, fill all-or-none, or need a smaller step.
   - Whether makers quote small retail packages.
   - The `extra_fee` unit.
   - CORS.

8. **Gates before launch.**
   - A legal opinion covering the framing, Derive's restricted persons, the UK limits and the builder fee.
   - Answers to the questions above.
   - Testnet dry runs.
   - The owner's approval of each step.

**Expected economics.** Recorded RFQ fills on 2-leg verticals paid a median 0.5c (BTC) and 0.4c (ETH) over mark, about 1-1.6c all-in for BTC at 1-35 days. That would let 4-5% zones come in under 3c and could open dates under 1 day. Butterflies and condors through RFQ have not been measured, because measuring them needs an account.

## 8. Risks and limits

- **Data terms (high).** Read as written, Derive's Terms section 10 and its Data Usage Policy cover:
  - publishing Derive prices;
  - derived pricing;
  - dashboards;
  - API polling;
  - wallet-level analysis.

  That reaches Questions, and also the existing recorder, the published JSON, and the Traders and Flow pages. This is the text as written, not a legal opinion.

- **Depth.** Top-of-book size is small, and it is ETH's binding limit:
  - BTC 1-8 days: a median $120-250 of payout on adjacent strikes, and $720 or more on the 6,000 zone at 14:00.
  - ETH near the money: often $40-150 on a $200 zone.
  - Under 1 day: $40.

  Larger tickets walk the book at worse prices. Stage 1 caps the amount at "Up to $X at this price"; stage 2 relies on makers quoting.

- **Strike gaps and part-pays.**
  - Levels are only listed strikes, $1,000-5,000 apart for BTC and $25-200 for ETH depending on the date.
  - Dailies open about 4 days ahead.
  - Zones are 6.5% or more of the index (up to 9.4% on coarse grids), so "above $86,000" pays in part anywhere from $83,000 to $89,000.
  - Ladder spacing is uneven where Derive's grid has holes, and some dates have only four levels.
  - The ramp, the "At $K" line and the full-pay line must stay visible in every row.

- **Zone and headline changes.**
  - The zone is fixed per date, with at most one allowed change; the headline moves only after a two-slot hold.
  - A date that enters the board 35 days out on a coarse strike grid can keep a wider zone than later dates. The one allowed change covers the common case.

- **Stale prices and leg risk.**
  - Prices are 5-30 minutes old when seen (4.2).
  - In stage 1 the user places two separate orders, and Derive's book has no net limit. The market can move between them, the first can fill only partly, or the second may not fill.
  - The ticket gives per-leg limits, the buy-first order and a sell-back path, but the user still carries this risk. RFQ removes it.

- **Naked-short mistakes.** Selling first creates a naked short, about $11.5k of initial margin per BTC contract, which Derive rejects without that cash. The ticket order prevents this only if the user follows it.

- **Data hygiene.** Some leg prices are impossible: buys over $1, sell-backs under $0, condors with absurd asks. Derive's mark can also sit outside its own book.
  - Such sides are treated as unquoted.
  - Sides with under $50 of payout at the top of the book count as unquoted.
  - The mark is clipped into [bid, ask].

- **Settlement surprises.**
  - The 30-minute average can differ from the 08:00 price by a few tenths of a percent.
  - Derive may delay or adjust a settlement in a disruption.

- **Thin evidence.** The gate study rests on 42 hourly snapshots over 41 hours and two settled dailies, with no weekend or high-volatility day. Run `questions_sweep.py` (B1) again after a few weeks of recording, before G, S and `min_zone_pct` are fixed.

- **Pipeline dependencies.**
  - Prices depend on the external cron service, whose token expires about 30 December 2026, and on GitHub Actions running every few minutes.
  - When either stops, prices pause by rule (4.2) rather than going stale silently.

- **The V3 move.**
  - `public/get_instruments` is replaced by the paginated `get_all_instruments`. The recorder already plans a one-setting switch.
  - Instrument names, specs, fees and the 08:00 average settlement carry over.
  - Question ids key on expiry and strikes, so they survive the move.
  - Subaccounts become per risk universe.
  - RFQ signing changes: nonces, signature windows and the domain separator.
  - The board switches source with the recorder. Whether V2 and V3 run side by side for a while is not documented.

- **Regulatory framing.**
  - A yes/no price question priced per $1 looks like a binary option or a prediction market, even though it is a standard options spread on Derive.
  - Derive excludes US persons, Australian tax residents, Canada and Ontario residents, Panama residents and sanctioned regions, and it limits UK access to investment professionals and high-net-worth entities.
  - Wording, geography and any fee need the owner's legal contacts.

- **Wording drift.** A banned word in a new (i) would break an owner rule. The automated stem-based wordcheck on every Questions route is part of done.

## 9. Decisions for the owner

1. **Derive's data terms.** Seek Derive's written consent or a data agreement, or a legal opinion, before Questions goes public (and arguably before the current app does). Questions sends users to trade on Derive, and Derive's broker program suggests it has an interest. Proposed: build stage 1 behind a flag now, and switch the flag on once this is answered.

2. **Cost gate, size gate and zone width.**
   - G = 5c in stage 1 (proposed) or a strict 3c. At 3c, BTC passes about two-thirds of checks and ETH about a quarter.
   - S = $100 per side for both coins (proposed: BTC 95% and ETH 75% of date-checks pass).
   - Minimum zone of 6.5% of the index for both coins (proposed). The alternatives for ETH are S = $50 (86%) or a 9% zone (84% at $100).
   - One fixed zone per date (proposed), or a Narrow / Standard / Wide choice for experienced users.

3. **How a level is named.** At the middle of its zone (proposed): "above $86,000" pays 50c at $86,000 and $1 from $89,000, with the ramp and the full-pay line in every row. The alternative is to name it at the full-pay line.

4. **Between in stage 1.** Show the bands with an em dash on both buttons, or hide them until RFQ. At 12-30c over fair they cannot be offered on the screen.

5. **Dates in stage 1.** Leave out dates under 1 day and over 35 days (proposed), and revisit with RFQ. There is no "Tomorrow" label.

6. **Prices on the buttons.** Proposed: the executable buy price, rounded up to whole cents, with fees in the ticket. The clipped fair appears only as the unlabelled bar, on the chart and in (i). The alternative is to show fair, which cannot be had on the screen.

7. **Credit twins in stage-1 tickets.** Proposed: always use the cheaper construction, even when it is a credit form with margin held, with the credit wording from F4. For No near the money it often is: in 2.2 the call twin costs 65.37c against 66.02c for the debit put spread. The alternative is debit forms only, for simpler wording, at the cost of a slightly higher No price (66.02c, shown 67c, in 2.2). That would also break the rule that the gap equals Yes + No - $1, and would change the 2.2 test values.

8. **My questions.** Browser-only storage with export and import, and no wallet matching in stage 1 (proposed).

9. **Stage 2 and fees.**
   - Whether to go ahead: on V3 only, testnet and dry-run first.
   - Whether Cowboy charges a builder fee, and how large. Any fee adds to the 1-2c RFQ cost.
   - Whether to join Derive's API Broker program. It pays a share of exchange fees on referred trades, and could carry a referral link from stage 1's "Open Derive".

10. **Legal review scope.** The yes/no framing and the words "question" and "answer", Derive's restricted persons and the UK limits, the builder fee and referral links.

11. **More coins.** Coins open by themselves when they pass the gates. The other coins' prices are already read every 15 minutes, so their board costs nothing extra. Their question chart can be built forward from the live readings into the `site-data` cache, also at no cost, but a lost cache could then be rebuilt only from daily chains. Keeping hourly chains for them would cost about 1 MB a day of data-branch storage per coin at BTC's size, and less for thin coins.

12. **Name.** Ship Questions under Torq, or wait for the Cowboy rebrand.

---

Sources and working files:
- `economics.md` and `work-economics/`: priced questions, RFQ fills, settlement checks.
- `ux.md`: screens, words, edge cases.
- `work-mechanics/`: instruments (with activation times), settlement prices, margin checks, public trades, and the text of Derive's terms and data policy.
- `work-review/`: the critic's zone check and live margin run.
- `work-design2/`:
  - `ex2.py`: the examples in section 2;
  - `picker.py`, `sweep.py`, `freeze.py`, `widthrate.py`, `policy.py`, `coingate.py`, `at14.py`: the zone and gate study;
  - `coins.py`, `coins2.py`: the other coins.
- Repo reads: `backend/derive/recorder.py`, `backend/derive/config.py`, `backend/record_once.py`, `backend/publish_site.py`, `.github/workflows/record.yml`, `frontend/src/main.jsx`, `frontend/src/lib/data.js`, `frontend/src/components/`.

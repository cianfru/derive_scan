# Cowboy tokenomics proposal

Date: 4 October 2026

Status: discussion draft. Recording these ideas does not approve a token launch, sale, rewards programme or changes to trading fees. Allocation percentages and release schedules below are illustrative.

## Purpose and timing

Design Cowboy's incentives around useful contributions, repeat use and actual product revenue. Consider a tradable token once the product has working mainnet execution, organic retention and a clear function that benefits from a transferable asset.

Derive and Rysk provide execution, liquidity and settlement. Cowboy contributes distribution, a simple trading interface, market research and a record of each trading decision. A token needs a useful role in that business.

The immediate work is a revenue and rewards policy. Product delivery, the pilot and measurement come first; a token is a later decision.

## 1. Start with non-transferable points

Use a modest recognition programme for early testers and contributors. Possible activities include useful feedback, verified fixes, documented research contributions and successful referrals that bring sustained use.

Publish the rules before awarding points. Points carry no promise of conversion into tokens or financial value.

Do not award points for raw trading volume, leverage, losses or winning trades. Those incentives can encourage unnecessary trading and reward activity that exists only to collect an incentive. Any future execution rebate should remain within a conservative share of Cowboy's actual incremental receipts.

Manual journal entries and browser-local counters are user-controlled and cannot verify eligibility for monetary rewards. Keep private journals private; participation in a rewards programme should be optional. A reward programme needs its own verifiable record before it can distribute anything valuable.

## 2. Keep core product access independent of the token

Users can trade, keep their journal and access their venue funds without buying or holding a Cowboy token. Trading payments, collateral and settlement stay in each venue's supported currencies.

Potential future benefits could include credits for optional paid alerts, advanced exports or API access. These services need to exist and have customers before they become credible utility. Ordinary subscriptions and service credits remain viable alternatives if transferability adds no useful function.

A stronger token case could develop if Cowboy becomes a network of contributors supplying research, outcome curation or data services that customers pay for. Useful work and the method for verifying it must be defined first.

## 3. Give governance a defined scope

Potential token governance could cover:

- Contributor grants and community programmes.
- Product budgets and development priorities.
- Treasury spending within a published policy.

Governance does not control customer funds or Derive and Rysk's settlement rules. Research results follow their declared protocols; a vote cannot decide a verdict. Market context and outcome rankings continue to follow Cowboy's published data and product rules.

## 4. Build benefits around actual revenue

### Revenue assumptions

The current trading plan has no Cowboy fee or builder fee. Its proposed Derive revenue source is the API Broker programme's share of eligible net exchange fees. Programme acceptance, attribution and actual receipts need to be verified before they enter a funded rewards budget.

No Rysk income is assumed before the owner has agreed integration and commercial terms with Rysk. Optional paid products are a possible later source of revenue, rather than current income.

### Illustrative unit economics

The [Saloon stage 2 design](saloon-stage2-design.md#4-fees) estimates about $1.62 in Derive fees on one worked $100 package. Assuming the full fee amount is eligible under the programme's net-fee definition and a 10% broker share applies, Cowboy receives approximately $0.16 on that example. Eligibility rules and deductions can reduce actual receipts.

| Similar packages per month | Illustrative Cowboy revenue before expenses |
|---|---:|
| 1,000 | $160 |
| 10,000 | $1,600 |
| 100,000 | $16,000 |

These figures use a rounded $0.16 per package. They are arithmetic examples, not a forecast or a general conversion from trading volume to revenue. Different instruments, sizes, fees and attribution change the result.

### Cash policy

1. Account for actual receipts and operating costs, including development and support.
2. Build an operating reserve.
3. Set an affordable budget for user fee credits and contributor rewards.
4. Consider any future buybacks only from remaining cash, under a separately defined policy.

Token distributions are an acquisition or contributor expense. They do not create revenue and cannot sustainably fund recurring service costs or staking yield. There is no promised yield, automatic appreciation or holder entitlement to revenue in this proposal.

## 5. Illustrative future supply and allocation

If a token becomes justified, consider a fixed supply with the following allocation:

| Allocation | Share | Proposed release principle |
|---|---:|---|
| Users and contributors | 40% | Small initial distribution; remainder over several years against published programme budgets |
| Product treasury | 25% | Released through published budgets and grants |
| Team | 20% | Four-year vesting with a one-year cliff |
| Future strategic funding | 10% | Reserved; allocated only when needed, with defined vesting |
| Market liquidity | 5% | Transparent deployment and accounting |
| **Total** | **100%** | |

The nominal supply, such as 100 million or one billion units, is mainly a denomination choice. Circulating supply, future unlocks, treasury spending and actual demand matter more.

Before launch, publish the full release schedule and distribution criteria. The reserved strategic allocation does not imply a financing round. No valuation, launch price or fundraising target is set here.

## 6. Launch conditions

A tradable-token proposal should proceed only once there is evidence of:

- Working mainnet execution and dependable position accounting.
- Repeat use and organic retention without token rewards.
- Verified revenue, attribution and unit economics.
- A defined function that benefits from a transferable token.
- Affordable, published rewards budgets and release schedules.
- Token-specific legal review of any sale, financial rights and distribution terms.

A date, follower count or trading-volume headline alone does not satisfy these conditions. If the product can deliver the proposed benefits through ordinary credits or subscriptions, a token remains optional.

## 7. Decisions left open

Before moving beyond this discussion draft, decide:

1. Which contributor or customer relationship actually needs a transferable asset?
2. Which activities can be verified fairly without collecting private journal data?
3. What are Cowboy's actual receipts, operating costs and required reserve?
4. Which optional paid services have demonstrated demand?
5. What are the final supply, circulating allocation and unlock schedule?
6. What governance powers and legal rights does the token carry?

The next concrete step is to document actual product revenue and a modest recognition policy after the pilot. Token design can then follow the economic relationships Cowboy has demonstrated.

## Owner's direction and implementation notes (4 October 2026)

Owner: the token distributes voting rights through Cowboy, to wallets that connected to the app and traded through it. It does not pay traders. This draft is kept for later development, not for building now.

### Rules that hold

- **Attribution comes from Derive.** Cowboy has no server; everything runs in the browser, so Cowboy itself records no wallet activity, and journals and Follow are browser-local and user-entered. The only usable record is Derive's per-wallet reporting of trades carrying Cowboy's referral or broker code. Ask Derive whether that reporting exists. Do not use V3 public trades as the source, since they may be anonymised.
- **Only one-tap trades are reliably attributable.** These are stage 2 RFQ trades from a connected wallet. Stage 1 manual orders count only if Derive credits the "Open Derive" referral link.
- **Weight voting power against capture, not by volume.** Volume weighting hands the votes to the largest and most mechanical traders. Prefer:
  - distinct active weeks;
  - the fees each wallet generated for Cowboy, as a floor against wash activity;
  - a cap per wallet;
  - a minimum to qualify.
- **Expect wallet splitting.** One person can split across wallets. Per-wallet caps and weighting by weeks blunt this; unannounced snapshot dates stop a rush of trades just before them. Publish the rules before any snapshot.
- **Governance scope (section 3) stands.** Votes cover grants, budgets, priorities and treasury. They cannot decide research verdicts, which follow the declared-study protocol, or the board's ordering, which follows price facts only.
- **Core access stays token-free (section 2).** Trading, the journal and venue funds never require the token.
- **Nothing in the app mentions a token, points or a distribution** until the owner approves it.

### Rules that no longer apply, or matter less

- **Rebates and execution rewards (section 1, last sentence).** These are out: traders are not paid.
- **Points as a separate recognition layer (section 1).** These are optional for traders, since a connected wallet's attributed activity is the record and no Cowboy account is needed. A handle such as GitHub is needed only for non-trading contributors (feedback, fixes, research).
- **Revenue-funded reward budgets and buybacks (section 4, cash policy items 3 and 4).** These are not needed for a voting-rights distribution. Unit economics stay as business context only.
- **Service credits as token utility (section 2).** This is secondary to governance and can be dropped.

### Corrections to the figures

- **The $1.62 fee is from an earlier calculation.** It is the RFQ fee on a $100 premium, worked out before the fee-inclusive budget rule. On $100 total spend it is about $1.57.
- **The manual path pays more in fees.** Two book orders cost about $2.95 in fees on example 2.2. Whether those fees count toward Cowboy depends on referral attribution.
- **The 10% broker share is unconfirmed.** It is our reading of Derive's docs; the actual terms come with programme acceptance.
- **Earning revenue adds a hosting cost.** Vercel's Hobby plan is for non-commercial use, so once Cowboy earns, Pro (about $20 a month) is the first operating cost.

## Owner's direction, second pass (4 October 2026)

- **Registering one-tap wallets.**
  - **Direction:** Cowboy needs its own record of wallets that connect and trade through one-tap. Manual trading is temporary and will be sunset, so attribution is designed for one-tap only.
  - **Derive's side:** every one-tap order already carries Cowboy's `referral_code`. Derive's broker dashboard shows accrued rewards per code; whether Derive reports them per wallet is a question for Derive.
  - **Fallback:** a small registry. At connect, the wallet signs a "register with Cowboy" message. After each fill, the browser reports the trade id, which is checked against Derive's trade record for that wallet. This needs a small store, the first piece of Cowboy-side infrastructure; design it when one-tap reaches mainnet.
- **How votes are allocated to wallets:** to be designed later.
- **Wallet splitting:** the only lever is a maximum distribution per wallet.
- **Fees, a staged plan.**
  - **Stage one:** no Cowboy fee while traffic builds.
  - **Stage two:** once there is traction, a small Cowboy fee, kept low enough not to be felt.
  - **Mechanism:** Derive V3 builder codes: each order carries `referral_code` plus an optional `extra_fee`, which accrues to the builder's Derive wallet and is paid every four weeks, on top of the API Broker share. Because the browser sets `extra_fee` per order, a discount is simply a lower `extra_fee` for qualifying wallets.
- **Token utility: lower fees for stakers.** Reference model: Definitive's EDGE.
  - **Definitive's own rules:** stake any amount and unstake any time, with a 7-day cooldown during which the unstaked tokens cannot be traded or withdrawn. Staking unlocks lower fee tiers set by trading volume over a rolling 30-day window; larger stakes extend that lookback, from 30 days up to 180.
  - **The owner's variant:** while tokens are staked, the discount grows with each month of consistent trading and resets to zero after a month without.
  - **Open design points:** the definition of "consistent" (active weeks or a minimum number of trades a month); the discount steps; whether unstaking resets the discount; and a cooldown on unstaking, so tokens cannot be staked just before a trade and withdrawn right after.
- **Supersedes:** "Using Cowboy never requires the token" now reads: using Cowboy never requires the token, and holding and staking it lowers Cowboy's own fee once that fee exists. Derive's exchange fees are unaffected.

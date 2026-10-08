# Next stage: market agent and social presence

Recorded 8 October 2026 from a conversation with the owner. Nothing here is built. It waits until the owner has a clear path and the budget to build it.

## The umbrella agent

- A private agent above both products, its own small project (not in Cowboy's app or repo). It reads Reflex's outputs (perps, open interest, funding, leverage, Hyperliquid smart money) and Cowboy's (options, Derive smart wallets) and writes one combined message: what is happening on Hyperliquid, what on Derive, where smart wallets line up on both, and the one setup of the day with its reasons.
- Reflex and Cowboy stay independent. They share the regime engine and the ribbon; the data feeding each stays separate.
- Watching is plain code, not a model: collectors and event detection (signal changes, smart money flipping, unusual open interest, funding or skew moves) run all the time at no model cost. A model is called only on events and once a day for a brief.
- Two tiers: a cheap model sorts events (Haiku, about $0.001 a check), a strong model makes the daily pick and writes the reasoning (Opus or Sonnet, about $0.20 a decision call with about 30,000 tokens in and 3,000 out).
- Telegram for the owner only: daily brief, alerts, questions about the history ("when did smart wallets last flip short on ETH while the regime was trending up?").
- No trading keys on the agent's machine. Trading stays behind the owner's explicit approval.

## The log comes first

- Every day the agent saves, before the outcome is known: every candidate setup, the full state behind it from both products, the pick and why. Code fills in what happened 1, 3 and 7 days later.
- After 3 to 6 months the picks are scored against a simple fixed rule. Until they beat it, the agent's setups are context, not a signal (the declared-study protocol).
- The log needs no hardware and can start in the current pipelines; every day not recorded is lost.

## Cost: API versus a Mac mini (owner's question)

- Opus 5.5 is $4 in and $20 out per million tokens; Haiku 5.5 $0.10 and $0.50 (8 October 2026). About 10 decisions a day is about $60 a month; Haiku sorting 300 events a day about $10.
- Expected monthly bill without hardware: Railway (Reflex today, about $15, plus an always-on collector) about $15-25, Haiku about $10, Opus about $60, so about $85-95 in all.
- A 64 GB Mac mini (about $3,000) does not remove the Opus bill: a local model (Qwen-class, about 30B) is comparable to the cheap sorting tier, not to Opus. It saves about $25 a month, so about 10 years to pay back; free electricity does not change that.
- Decision (owner, 8 October 2026): stay on recurring costs. Decide on hardware after 3 to 6 months of real numbers; it starts to make sense if the bill passes about $200 a month, if thousands of events a day are worth a model's look, or for fine-tuning on the logged data.
- Local experiments first on the owner's M1 MacBook Air (LM Studio or Ollama; 8 GB runs 3-4B models, 16 GB runs 7-8B). Not for 24/7 (no fan, sleeps with the lid closed). Test: give the local model and Haiku the same logged events and compare their sorting with Opus's and with what happened.
- If a home machine ever runs collectors, the public sites keep publishing from the cloud, so a home power or internet cut never takes Cowboy or Reflex down.

## Social presence (X)

- Next stage after the agent's design: open Cowboy's X account (no impersonation-like name; see the X cards entry in CLAUDE.md) once there is a clear path.
- No posting through a logged-in browser. X forbids automated posting outside its API and detects automated browsers, and an agent with the machine and a logged-in session is the riskiest setup. Posts go through the X API or by hand.
- The agent designs new cards, not only the existing catalogue: it writes the chart (SVG or HTML) in Cowboy's colours, fonts and layout, renders it to PNG in a headless browser, looks at its own image and redraws until it reads well on a phone. Every figure on a card comes from the data and is checked against it; no forecast words; the copy rule (hook, then the why, with a comparison) holds.
- Sonnet 5.5 is the fit for card design (a few cents per card with redraws); Haiku can write text but designs weakly; a small local model does not design well.
- Stages:
  1. The agent detects, writes and designs; drafts go to the owner on Telegram (Post, Edit, Skip).
  2. After a few weeks of clean drafts, formats the owner has approved several times post through the API on their own; new formats and unusual calls still go to the owner.
  3. Only with a track record: posts on its own within limits (a few a day, approved formats, every post logged), with a Telegram off switch.
- This extends the plan in CLAUDE.md's X cards entry: "the watcher drafting posts on changes, then the bot."

## Market makers (owner, 8 October 2026)

- Level 1, a full trading front end on Derive (weeks, browser only): Derive's referral and API Broker programme, later a small Cowboy fee through the builder code; the order-book fallback when an RFQ quote is worse than Derive's book (design and owner approval first; the largest friction in one tap today); single options, other spreads, "between" on mainnet, limit orders; an account view (margin, every leg, Greeks behind an (i)).
- Level 2, market makers who quote Cowboy's flow on Derive's rails (months): retail flow is what makers want, and tighter quotes close the gap measured against Polymarket (about 14% over fair on Derive, about 4% on Polymarket). Work: check Derive's RFQ docs for directed or tagged requests (unknown; otherwise part of the broker conversation), a maker package (flow spec, testnet, response times), weekly volume, sizes and how often fills turn against the maker, agreements per maker. Payment-for-flow arrangements are regulated in many places: the owner's lawyer before anything is signed.
- Level 3, Cowboy's own venue (matching, risk and margin, liquidations, settlement contracts, price feeds, custody, audits, licence): advised against; Derive is that, and the multi-venue idea was dropped on 5 October 2026.
- Makers follow volume: finish level 1, measure flow from the start, then approach Derive and 2-3 makers together.
- Talking to makers: first ask Derive (in the referral and broker thread) to introduce the 2-3 makers most active on its RFQ; Derive knows who quotes, our data only shows wallets. Then direct outreach (websites, LinkedIn or X heads of options or business development, Derive's Discord, conferences). Bring a one-page summary: what Cowboy is, the flow, honest numbers, the ask. Start relationships now, return with numbers after a few weeks of trading.

## Unified account across venues (owner, 8 October 2026)

- The idea: one Cowboy account and one portfolio across Derive (its own chain) and Rysk (HyperEVM), money moved between them in one click, low cost. Not cheapest-venue routing (dropped 5 October 2026): the two sell different products (Derive: buying Higher/Lower spreads; Rysk: selling covered calls and cash-secured puts), so the value is doing both, seeing both and moving money easily.
- Limits: crossing chains takes about 1 to 5 minutes, not seconds (Derive's exact withdrawal timing to be read in its docs); Rysk locks collateral until expiry with no early exit, so money moves into Rysk in a click but not back out before settlement; Rysk has no public trading API, so nothing is possible there until Rysk offers an API, partnership or SDK (first question for the owner's call).
- Not custodial: Cowboy holding users' money (one balance, internal ledger) would be instant but needs a licence, identity checks and insurance, is a hacking target, and breaks the rule that no Cowboy server holds keys or funds. Money stays in the user's own accounts; Cowboy reads and orchestrates.
- Steps:
  1. One portfolio: Derive and Rysk positions, P&L and cash on one Positions page (needs Rysk to allow reading positions).
  2. Move with a few signatures: withdraw from Derive, bridge, deposit on Rysk, with a live tracker; 2-4 wallet signatures, 1-5 minutes; reuses the bridge flow behind `VITE_FUND_ANYCHAIN`, the Derive connection and the deposit tracker.
  3. One click: one signature approves the whole move, run in the background only to the user's own addresses, through a smart account per user with limited permissions; needs a security audit and the owner's explicit approval (a Cowboy service would hold a limited key).
  4. Feels instant: the user's money kept split across both venues and rebalanced in the background, or bridges where a third party fronts funds on arrival; Cowboy never fronts money itself.
- Build steps 1 and 2 after the Rysk call if Rysk gives access; hold step 3 until users move money between venues often; no Cowboy-held accounts. The owner's lawyer on a service that moves users' money between venues, even non-custodially.
- Questions for Rysk: can a third-party app place orders and read positions for users (API, partner programme, SDK); referral or integrator fee; coins, dates and minimum sizes; early close; how fills and settlement are reported; terms on showing their prices.

## Bridge choice (owner, 8 October 2026: Li.Fi is not the cheapest)

- `lib/trade/anychain.js` calls Li.Fi only (`FUNDING_API`); its checks (Derive's minimum deposit after fees, the 120-second limit, no Cowboy fee) apply to any provider.
- Candidates to compare on real quotes (support for Derive's deposit chains and HyperEVM to be confirmed from each provider's docs, never assumed): Circle's CCTP (native USDC burned and minted, no slippage, gas plus a small fee for its fast mode; usually the cheapest for USDC to USDC), intent bridges such as Relay and Across (a filler pays out on arrival within seconds, cheap for USDC on major chains), Bungee (Socket's aggregator; Derive's own bridging runs on Socket), deBridge, and Li.Fi.
- Plan: a small measurement first (same routes, $100 and $1,000, USDC and ETH from Ethereum, Base, Arbitrum and HyperEVM to the Derive deposit address; what arrives, time, total cost), then quote two or three providers side by side in the browser and pick the one that delivers the most within the time limit, each behind the same checks. Also check in Derive's docs whether it accepts USDC directly from Base or Arbitrum, which would need no third-party bridge for USDC.

## "Built on" logos and contract verification (owner, 8 October 2026)

- A small "Built on" strip near the landing's footer, for trust. Only what users actually go through in production, never what is built but switched off or only planned:

  | When | The strip reads |
  |---|---|
  | Today | Built on Derive · Ethereum · USDC |
  | After the owner's funding test and switch-on of `VITE_FUND_ANYCHAIN` | + Li.Fi (and Base, Arbitrum if shown as source chains) |
  | After the bridge comparison, only bridges Cowboy calls directly | + those bridges (a route Li.Fi picks inside a transfer is not Cowboy's integration) |
  | After Rysk goes live | + Rysk · HyperEVM |

- Each brand's own one-colour logo as its brand kit allows (white in dark, ink in light; never recoloured orange, which is Cowboy's brand and interaction colour only), small and quiet; "Built on" or "Powered by", never "Partner"; the footer's "Not affiliated with Derive" stays. Check each brand kit; ask Derive directly. Inside the deposit step, the same name in small type ("Routed by Li.Fi").
- Contract verification: Cowboy has no contract of its own today (trades go through Derive's contracts). Any contract Cowboy deploys later (for example the per-user smart account of the unified account) gets its source verified on the block explorer and an audit before launch, as with Rainbow's verified contract.
- On-chain fingerprints of the agent's daily pick (a hash written to Base before the outcome, so anyone can check the published pick was not edited): comes with the agent stage.

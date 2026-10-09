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

## The synthesizer and agent trading, build order (owner, 8 October 2026)

Why (owner): the systems already detect what matters, but it does not reach the owner. Reflex's bell showed two profitable traders converging on a coin and opening longs, seen only by chance; traders leaving positions are seen only by watching every day. The owner wants an agent that watches both platforms, says what is happening and why, and later trades a small account by itself.

1. Synthesizer and alerts, first. One job reads what Reflex and Cowboy already publish, detects events in plain code, and a model writes the message and a daily brief to the owner's Telegram (including the "crowded" check: how many coins trend up at once, with Fear & Greed). Any "historically this marked a top" figure comes from our own recorded data, never the model's general knowledge. It can run in the existing 15-minute feed run (GitHub Actions), so no new server.
2. A paper book that follows smart money: each alert-worthy event opens a paper Higher/Lower spread on Derive, held to an exit rule, logged before the outcome, scored against following the regime engine alone.
3. Testnet, then $100 live, each with the owner's explicit go-ahead: a separate Derive account holding only that money, defined-risk spreads only (no perps), about $25 a trade, a few open at once, a Telegram stop, every decision and its reasons reported. The model suggests; code with hard limits decides.
4. Routing across venues waits until Hyperliquid's options launch (the first venue selling the same product as Derive); non-custodial as recorded above; money moves only once it is not locked in a position.

Where Reflex's events are (read 8 October 2026, Reflex commit 8ddccac; the agent reads them, Reflex is not changed for it): the bell reads Reflex's own HTTP API: `/api/notifications/convergence` (profitable traders converging: at least 2 open the same side of one coin within 24 h, each holding, entries within 5%, at most 2 others already on that side; `backend/convergence.py`, forward test in its `docs/reviews/trader-convergence-forward-test.md`), `/api/notifications/anomalies` (extreme funding, open-interest surges, volume spikes, long/short extremes), `/api/notifications/market-setups` (open interest against price on coins not held), `/api/notifications/exhaustion-opportunities`, and `/api/signals/recent-unified`. Reflex's API takes an access token only when its access code is set; the agent then needs one, which the owner adds as a secret.

Needed from the owner before the build: where the agent lives (a new private repository is suggested), a Telegram bot made with BotFather with its token added by the owner as a secret, and a Claude API key added the same way. Secrets are never handled in chat.

## Three repositories, and Cowboy on Railway (owner, 9 October 2026)

- The agent lives in its own private repository (proposed `cianfru/market-agent`), apart from Reflex (`cianfru/RCCE_Scanner`) and Cowboy (`derive_scan`). It only reads what each product publishes, so neither depends on it, and its Telegram bot and any trading key stay out of the products. Creating the repository from a session was refused by GitHub (the integration cannot create repositories); the owner creates it on github.com (private, with a README) and gives the Claude GitHub App access, then a session attaches it.
- Cowboy moves to Railway (owner: "Cowboy has potential ... websocket, faster scans and not every 15 mins"): one always-on worker on Derive's WebSocket (trades, option tickers, order books), a database instead of growing files in git (also ends the repo-size limit), publishing every minute or on change, and an API the agent reads within seconds. Fetch once, serve everyone still holds: visitors are served through a cache (Vercel edge or ETag/304), never their own reads from Derive. About $10-20 a month. Run in parallel with the GitHub feed first, compare, then switch the app's data address; the mainnet trading lease moves with it so an outage still closes trading.
- Order: (1) the agent repository and Telegram alerts from what both products publish today; (2) Cowboy on Railway; (3) the agent's paper book, then testnet and $100 live. Steps 1 and 2 are independent.

## Decision: Derive over WebSocket, engines stay separate (owner, 9 October 2026)

- Why live: option prices move constantly (the coin's price, time to settlement, expected movement), and market makers update quotes within seconds; the 30-minute average is only how Derive settles (the index over the 30 minutes before 08:00 UTC). The board's 15-minute snapshot can show "up to +78%" while the firm quote at the tap gives +72% (the trade itself is always the live firm quote, never the board's figure), and Positions' values lag by up to 15 minutes. Owner: "we really need to move to a WebSocket for Derive, so we have fresh data all the time".
- So Cowboy's Railway worker holds one connection to Derive's WebSocket and publishes the Saloon's prices and returns and the marks behind Positions every few seconds, through a cache (fetched once, served to everyone). Research data (open interest, smart wallets, skew, regime) can keep a slower pace.
- Candles, regime and signals stay separate per product (owner: "if the engine doesn't create much disruption in terms of cost, then we just keep it separated ... the easiest path"): computing them costs cents. Reflex runs its engine on Hyperliquid candles (Binance or Bybit for coins Hyperliquid lacks; Reflex `data_fetcher.fetch_ohlcv`); Cowboy keeps its own on Derive's data. Optional later, inside Cowboy alone: read Hyperliquid's public candles for the engine where Derive's perp volume is thin, keeping Derive's index for everything that settles.
- Memory: Cowboy keeps its own database in the same Railway account as Reflex. The $5 Hobby fee is shared; Cowboy's own usage (worker and database, about $10-15) adds to the bill. Reflex's assistant, memory and Telegram still move to the agent (it already exists in Reflex: `assistant.py`, `assistant_memory.py`, `telegram_bot.py`), so there is one assistant, not two; the agent reads both products' APIs.

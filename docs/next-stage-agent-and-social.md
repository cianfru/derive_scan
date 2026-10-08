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

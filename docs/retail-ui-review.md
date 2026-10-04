# Cowboy retail UI review against the owner's brief (4 October 2026)

Read-only review. Nothing in `/home/user/derive_scan` was changed. What was looked at:
- `CLAUDE.md`, `docs/questions-design.md`, `docs/saloon-stage2-design.md`.
- Frontend at `HEAD` (cd46b8f3): the pages, components, lib files and styles listed in the brief.
- The stage 2 work in progress, read only to know what exists: `components/trade/*`, `lib/trade/*` and the uncommitted `QuestionTicket.jsx` wrapper.
- Renders of `HEAD` with `VITE_QUESTIONS=1`, `VITE_SALOON_TRADE` off, using the `saloon-site` data. Clock frozen at BTC options ts + 5 min. Pages: `/`, `/saloon`, `/saloon/BTC`, `/q/BTC-20261005-A-80000-86000`, `/saloon/mine`, `/markets`, `/coin/BTC`, `/radar`, at 1440 and 390 px, dark theme. Shots are in `scratchpad/retail-ui/shots/`. There were no page errors and no sideways scroll at either width.

Caveat on the renders. The Markets file is stamped 19:34 UTC but the Saloon prices are stamped 13:15 UTC, so the frozen clock sits between the two. The Wallets and Options tiles read "Missing quotes" and "Stale reading", and Radar plotted 0 of 12 points. Some of that may come from the data copy rather than from production. The wording problem those states expose is real either way (G14).

---

## 1. What works today

**Trading surface (Saloon, stage 1)**
- **The worst case is visible before any action.** The amount panel shows "Most you can lose" (premium plus estimated fees) above the button, then "You pay ... + fees about", "Pays up to ... from $86,000", and the settlement date with a countdown. A test enforces this ordering (questions-design F3).
- **Sensible defaults.** The page opens on the nearest date whose headline can be bought on both sides, with an amount of $100 and $25 / $100 / $500 quick picks.
- **Honest prices.**
  - Buy prices round up and sell-back prices round down, so the screen never shows a better price than Derive's book.
  - A price-time stamp with (i) is shown, plus stale (35 min) and paused (90 min) states.
  - "Thin book" is marked with (i) on coins other than BTC and ETH.
  - "Up to $X at this price" appears when the amount exceeds the size available at that price.
  - A minimum-amount warning appears, and "Fees are a large share of small amounts" shows for small tickets.
- **The pay zone is drawn everywhere.** There is a mini ramp in every ladder row and the "$1 from $X" line, and a full ramp on the question page with "At $83,000: 50c / $1 from / Nothing at or below". Settled results are worded as cents per $1 ("Yes paid 74c"), never a bare Yes or No. Together these are the right foundation for "never imply binary".
- **The copy is checked.** A stem wordcheck (`BANNED` in `lib/questions.js`) runs across the Saloon routes and every (i). No "%", no forecast words, no pills: tabs are underlined text.
- **Selection is consistent.** The selected answer carries the same orange border in the ladder button, the big Yes/No pick and the ticket heading ("... Yes").
- **Mobile basics.**
  - At 390 px, the question, both answers and the ramp sit above the fold.
  - The ticket is a bottom sheet behind "Get Yes on Derive".
  - The ladder answer buttons are 44 px high.
- **"Context, not advice".** The three chain tiles sit beside the trade without choosing a side.
- **My seat.**
  - Shows Paid, Now worth (at the sell-back price, with Derive's mark in (i)), and Result (+/- dollars).
  - Has a "Settling" state, "Got $X (Nc per $1)" once settled, and Sell back (a reversed ticket).
  - Export and import work, and storage that throws is handled.
- **Flag hygiene.** The Saloon is invisible with the flag off (`questions-flag-off.test.jsx`). Stage 2 loads lazily, only when `TRADE_ON`.

**Stage 2 (in progress, flag-gated; read only)**
- **`TradePanel`** runs connect, then terms, fund, approve and ready. It always offers "Place by hand" and carries a visible "Testnet · dry run" tag, which is a good distinction between implemented and placeholder.
- **`TradeTicket` before a quote:** the board numbers are shown as "about", then "Get price", then "Asking Derive for a firm price…".
- **`TradeTicket` once quoted:** "firm for N s", "Derive's price moved. Check the new number.", and a ceiling breach shows "Derive's price is 43c now; the board showed 38c".
- **`TradeTicket` failure states:** lapsed, no quote (with Try again and Place by hand), blocked (fee or margin), Derive down, and a per-answer cap.
- **`rfq.js`** has no path to `private/execute_quote`, sends all-or-none `partial_fill_step`, and always cancels the RFQ on close.

**Research**
- **Markets** leads with a one-line takeaway ("Most coins trending up", 10/12), a regime-mix strip, signal filters and Fear & Greed. The board sorts by agreement and carries the Regime · Wallets · Options legend with Up / Balanced / Defensive / Building.
- **Coin pages** keep the numbered path:
  - a sticky chain strip;
  - the "BTC in the Saloon" card;
  - Regime, with its readout first and Engine detail collapsed.
- **Plain labels** (Leaning up, Trending up, Cooling off) with the engine terms inside (i). Explanations live behind (i) throughout.
- **The landing page** says what Cowboy does without live readings. "Enter the Saloon" is the primary button when the flag is on.

---

## 2. Gaps

Severity: **High** = a first-time user could misunderstand what they buy, what they pay or receive, or whether it executed. **Medium** = friction or confusion that slows understanding. **Low** = polish.

### Trade understanding

| # | Gap | Where | Why it matters for a first-time user | Sev |
|---|---|---|---|---|
| G1 | **No profit figure and no breakeven.** "Pays up to $122.94" is the total payout, and "At $83,000 $61.47" is a payout. Nothing says "profit". Worked example on the rendered question, $100 of Yes on "BTC above $83,000": the user pays $101.75, the most it pays is $122.94, so the most they can make is **$21.19**. Breakeven is a settlement price of **$84,966**, which is *above* today's $84,854. A user who reads "Yes 82c, BTC is already above $83k" assumes they are winning; at today's price this trade loses about $2.30 at expiry. | `Questions.jsx` `QuestionView` amount panel (`q-figs`); `QuestionTicket.jsx` money block; `TradeTicket.jsx` | This is the core of the brief: total payout vs profit, and what they could receive. Today the screen invites exactly the wrong reading. | **High** |
| G2 | **No dollar outcome examples and no expiry-price slider.** The ramp is static: three captions per $1, at mid, full and nothing. There are no dollar figures below, inside and above the zone, and no P/L at those prices. | `PayZone.jsx`, `Questions.jsx` | The brief explicitly asks for an interactive "if it settles at $X you get $Y, profit or loss $Z" view. Without it, the ramp is a picture of a rule, not of the user's money. | **High** |
| G3 | **Yes/No and Up/Down labels imply a binary outcome, but the payout ramps.** "Yes 82c" reads like a Polymarket share that pays $1 if true. Here, "BTC above $83,000" pays only 50c *at* $83,000 and reaches $1 only from $86,000. The headline "Up or down from $85,000" is worse: today's price is $84,854, so "Up" pays about 48c at today's price, and Up + Down = 103c. | `lib/questions.js` `answerNames`, `questionText`; `QuestionLadder.jsx`; `Questions.jsx` | The user's mental model (I am right, so I get $1) differs from the payout across about 7% of price. This is the main source of disappointment risk. | **High** |
| G4 | **"by Mon 5 Oct" on the headline question.** It settles *at* 08:00 UTC on that date, not "by" it. The other rows correctly say "on". | `questionText` (`headline` branch) | "By" reads as "at any time before", which is a different product (touch). | Medium |
| G5 | **"Cents per $1" next to a Yes/No reads like a percentage.** 82c is read as "82% likely". The owner's rule bans probability language, yet the format invites it. | ladder buttons, pick buttons | The no-probability rule is kept in words but broken in effect. See C2. | Medium |
| G6 | **Closing early vs holding to expiry is not explained where it is decided.** "Sell back" exists only in My seat. The question page says nothing about the sell-back price being lower than the buy price (the "Gap" is a mono footnote) or about the value before expiry following Derive's prices rather than the ramp. | `Questions.jsx` (only `Rules` (i) mentions it) | The brief requires the difference between expiry payout and closing early to be explained. | Medium |
| G7 | **A credit-twin No (the cheaper construction) shows "You receive now $X / Derive holds $Y".** The bundled data has many `no.form: "credit"` sides (for example on 80000-86000). It is the same cash at risk, but described in margin language. | `QuestionTicket.jsx` `credit` branch | For a retail user, "You receive now" on something they are paying for is alarming and wrong-sounding. Stage 2 is debit-only, so stage 1 and stage 2 already disagree. | **High** |

### Flow, disclosure and selection

| # | Gap | Where | Why it matters for a first-time user | Sev |
|---|---|---|---|---|
| G8 | **The flow order is not outlook -> expiry -> amount -> preview -> trade.** It is coin, then date, then a ladder of 7 to 15 strikes x 2 sides (up to 30 buttons), then amount. The direction is buried inside the choice of strike and side. | `Questions.jsx`, `QuestionLadder.jsx` | Too many competing choices on the first screen, and no "one primary action per step". | **High** |
| G9 | **Order mechanics come first, not inside details.** At 1280 px and wider, the third column shows the stage 1 ticket immediately: instrument names (`BTC-20261005-80000-C`), contracts (0.02049), per-leg limits, "net 4880 per contract", "Place line 2 only after line 1 has filled", Copy, Open Derive, and an orange **I placed it**. This happens before the user has chosen anything. | `Questions.jsx` `.q-sheet` (always visible at ≥1280, `questions.css` l.78/121); `QuestionTicket.jsx` | The brief says legs, quantities and limit prices belong in expandable order details. The most prominent orange button on the page records a trade the user may not have placed. | **High** |
| G10 | **The default question is not marked in the list.** On `/saloon/BTC` the main column shows the headline Up question, but the headline row's Up button is not highlighted, because `selectedId` is only set from the URL. | `Questions.jsx` (`selectedId={id}`) | The brief asks that the selected trade be obvious across list, preview and summary. | Medium |
| G11 | **On mobile, the cost and the action are below the fold.** At 390x900 the amount panel and "Get Yes on Derive" start at about y=860 to 1070, after the history chart. There is no sticky action bar (F3 specified one). | `Questions.jsx` order, `questions.css` | A first-time user scrolls past a chart of "price per $1 over time" before seeing what they pay. | Medium |
| G12 | **The per-$1 history chart sits in the main trade path.** Its axis is cents. A label overlaps at 48c and 50c (1440 shot). | `QuestionChart.jsx` | It is evidence, not a decision input: progressive disclosure says collapse it ("Price history"). | Low |

### Execution status and positions

| # | Gap | Where | Why it matters for a first-time user | Sev |
|---|---|---|---|---|
| G13 | **Stage 1 has no execution status, and My seat treats every "I placed it" as a complete two-leg package at the board's price.** `addPosition` stores `paid: t.mostLose`, an estimate with book fees, not what filled. Neither leg risk (only line 1 filled) nor a partial fill can be recorded. | `QuestionTicket.jsx` `place()`, `lib/positions.js`, `MyQuestions.jsx` | It breaks "never show an incomplete multi-leg trade as filled". Also, P/L in My seat is computed from a number the user never confirmed. | **High** |
| G14 | **Data-pipeline states are shown as readings.** "Missing quotes", "Stale reading", "Check timestamp" and "Insufficient data" appear as the tile text in the chain beside a trade and on coin pages. The coin page's 4H panel reads "Stale reading —". | `lib/presentation.js` `STATUS_NAMES`, `Chain.jsx`, `Questions.jsx` `Context`, `Coin.jsx` | It is jargon at the moment of decision. It should read "Not available yet", with the reason in (i). | Medium |
| G15 | **Missing values are bare em dashes.** Saloon examples: "Yes —" dashed buttons, "Now worth —", "Result —". On Radar, every Options and Wallets cell in this render was "—", as were Delta balance and Gross delta. The Saloon buttons have an `aria-label` of "no price now", but nothing explains *why* (no two-sided quote, failed checks, paused). | `QuestionLadder.jsx` l.12, `MyQuestions.jsx` l.39/41, `Radar.jsx` l.458/479, `ui.jsx` `Empty` | The brief asks for "Unavailable" with an accessible explanation. CLAUDE.md says "one em dash for every missing value" (C4). | Medium |
| G16 | **My seat is missing the brief's fields.** It has no max payout, no expiry payout at today's price, no fees on close, and no execution status. "Sell back" opens the full manual leg ticket. There is no "Close trade" summary with expected proceeds, fees and P/L before confirming. Export and Import sit as primary controls, and the empty state is one line. | `MyQuestions.jsx`, `closeTicket` in `lib/questions.js` | Positions is one of the brief's three top-level destinations. | **High** |
| G17 | **Stage 2 ticket (in progress) states stop at a dry run.** There are no submitting, filled, partially filled or failed-fill views. They are expected after P6, but the UI contract for them is not designed yet. The ticket also lacks expiry, profit and the outcome preview. It shows four lines, compared with the stage 1 panel's five. | `components/trade/TradeTicket.jsx` | It needs one shared outcome preview, so the stage 1 and stage 2 numbers cannot drift apart. | Medium (flagged) |

### Navigation, Research and accessibility

| # | Gap | Where | Why it matters for a first-time user | Sev |
|---|---|---|---|---|
| G18 | **Navigation is not Trade / Positions / Research.** The header is Saloon, then a divider, then five research links in a row. "My seat" is a small link in the Saloon page head. At 390 px the header shows six items at 13 to 15 px. | `Shell.jsx`, `styles.css` l.113-124 | Positions cannot be found from anywhere else, and the research list competes with trading on phones. | Medium |
| G19 | **The Saloon page has no descriptive subtitle.** The H1 is just "Saloon". The coin-page card says "Yes or no on BTC's price, priced from Derive options". The landing hero describes only research; nothing on the landing says what the Saloon is. | `Questions.jsx` header, `Landing.jsx` | A first-time user does not know what the Saloon is for. | Medium |
| G20 | **Research pages (apart from Markets) do not lead with a plain takeaway and its main uncertainty.** Radar, Options, Traders, Flow and Coin open on charts or tables, with the explanation in (i). | `Radar.jsx`, `Options.jsx`, `Traders.jsx`, `Flow.jsx`, `Coin.jsx` | The brief asks for a takeaway, the main uncertainty, then progressive evidence. | Medium |
| G21 | **Unfamiliar terms are not all tappable.** Examples: "1D stretch 1.32σ", "Delta balance", "Gross delta", "Long delta / Short delta" on the Radar map, "z-score", "Heat", "Ribbon". Some carry (i), others are bare labels. | `Radar.jsx`, `RegimePanel.jsx` | — | Low |
| G22 | **Small type and touch targets.** Many 11 px labels in the Saloon: `q-zone small` "$1 from", the `q-now` price label, `pz-t` axis text. `styles.css` has 9 to 10 px text in several rules (l.172, 224, 237, 244, 268, 271-275). The amount quick picks ($25 / $100 / $500) and the (i) buttons are text-sized targets, well under 44 px. Date tabs at 390 px clip "Fri 16 Oct" with no scroll cue. Contrast is fine: `--text-3` #b5ac9f on #0e0d0b is about 9:1. | `questions.css`, `styles.css` | — | Medium |

---

## 3. Build plan, highest impact first

Every pass keeps the existing rules:
- the wordcheck (`BANNED`) covers all new copy, including (i), the slider readout and aria-labels;
- no "%" in Saloon copy outside the zone (i), so P/L is in dollars only;
- no pills; mono for numbers;
- `questions-flag-off.test.jsx` stays green.

Stage 2 code stays behind `TRADE_ON`. To avoid collisions with the agent building stage 2, passes P0.1 to P0.3 touch only stage 1 files plus one new shared component, which `TradeTicket` can adopt later.

### P0.1 Outcome preview: cost, payout, profit, breakeven, slider (G1, G2, G6)

**Scope.** One `OutcomePreview` replaces the `q-figs` block. It shows:
- You pay: the premium, Derive fees (estimate), and the total, equal to the most you can lose.
- Most it pays (total payout) and Most you can make (payout minus total).
- Breakeven at expiry: the settlement price.
- Expiry: date, 08:00 UTC, and the countdown.
- Three dollar examples: below the zone, inside it (at K, or the slider point), and above it. Each shows *Payout* and *Profit / loss*.
- An expiry-price slider over the ramp, from lo - 0.6w to hi + 0.6w and starting at today's index. Dragging it updates "If {UND} settles at $X: you get $Y · profit/loss $Z". It is keyboard accessible, and its value is announced through `aria-valuetext`.
- One line with (i): "Selling back before expiry gets Derive's sell-back price, not this ramp."

**Files.**
- New `components/OutcomePreview.jsx`, which wraps or extends `PayZone.jsx` with a slider mode.
- `lib/questions.js`: new `outcome(t, level, side, S)` and `breakeven(t, level, side)`.
- `Questions.jsx` amount panel.
- `questions.css`.

**Stage 2.** Nothing behind the flag. `TradeTicket` can import `OutcomePreview` with the firm quote's total (a note for the stage 2 builder).

**Tests** (`questions.test.jsx`, `questions.test.js`):
- Fixture: $100 of Yes on BTC 80/86 gives $101.75 total, $122.94 payout, +$21.19 maximum and a breakeven of $84,966.
- Fixture: the 2.2 example ($100 typed) gives payout $264.42 and total $103.00.
- The slider at lo, K and hi gives the same values as `payAt`.
- A No mirror test.
- The wordcheck on rendered text and `aria-valuetext`.
- "Most you can lose" still renders before any action button.

**Done when:**
- a first-time user can read pay, maximum payout, maximum profit, breakeven and expiry without opening any (i);
- at 390 px, "You pay" and the action are reachable in one scroll;
- the slider works by touch and keyboard.

### P0.2 Plain outcome labels and honest wording (G3, G4, G5, G7). Needs owner decision D2

**Scope.**
- Fix "by" to "on {date}, 08:00 UTC" in `questionText`.
- Rename answers per D2. Recommended: **Higher / Lower** with the zone on the button ("Higher · full $1 from $86,000"). The question becomes "{UND} on Mon 5 Oct, 08:00 UTC vs $83,000". The headline row shows the level's relation to today's price ("$146 above today").
- Show the price as "82c per $1 of payout" in the preview, and keep the compact "82c" on buttons with the column head "Cost per $1".
- Display debit forms only in stage 1 tickets (D5), or, if the owner keeps credit twins, word them as "You pay $X in total (Derive holds it until settlement)".

**Files.** `lib/questions.js` (`answerNames`, `questionText`), `QuestionLadder.jsx`, `Questions.jsx`, `QuestionTicket.jsx`, `PayZone.jsx` captions, `positions.js` (keeps the stored `answer` string; old entries are fine).

**Tests.**
- The question text never contains "by".
- Every answer button's accessible name carries its full-pay level.
- A credit-form fixture renders no "You receive now".
- The wordcheck.
- `questionText` snapshots.

**Done when** no Saloon screen shows a bare Yes/No/Up/Down without the zone next to it.

### P0.3 Progressive disclosure, honest "placed", missing values (G9, G10, G13, G15)

**Scope.**
- At ≥1280 px the third column becomes a **summary**: question, side, You pay, Most it pays, expiry, and one primary action ("Place on Derive"). It appears only after the user picks an answer, or with the default question marked selected.
- Legs, contracts, limits, "net per contract", the line-order rule and Copy move into an expandable **Order details**.
- "I placed it" becomes a secondary step after "Open Derive". It asks "Did both orders fill?" with three choices: Both filled / Only the first / Not yet. The position stores `exec: "hand_both" | "hand_partial"` and the amount the user enters (default: the estimate).
- My seat labels these entries "Placed by hand · Cowboy cannot see your fills". A partial entry shows "Only the first option filled: this is not the full answer" and no ramp P/L.
- Selection: pass the default question's id and side to the ladder.
- Missing values in the Saloon become "No price now" with (i). The reason comes from `level.state` / `side.state` (`screen_wide`, gates, paused).

**Files.** `Questions.jsx`, `QuestionTicket.jsx` (stage 1 body only; coordinate with the uncommitted `WithTrade` wrapper there), `QuestionLadder.jsx`, `lib/positions.js` (an optional `exec` field, so `valid()` still accepts old entries), `MyQuestions.jsx`, `questions.css`.

**Stage 2.** When `TRADE_ON` and the seat is ready, the summary's primary action is "Get price" (`TradeTicket`). The hand path stays under "Place by hand".

**Tests.**
- With no answer picked, the legs are not visible (the `details` element is closed).
- A partial entry never shows "Result" as a ramp value.
- Old entries load.
- The default question is marked in the ladder.
- "No price now" has an accessible name with its reason.

**Done when:**
- no instrument name is visible without opening Order details;
- every position shows how it was placed;
- no Saloon value is a bare dash.

### P1.1 Guided trade flow and mobile action bar (G8, G11, G12, G19)

**Scope.** A stepped view on `/saloon/:und`:
1. **Outlook**: Higher or Lower, chosen by the user and never pre-picked from the three layers.
2. **Date**: tabs, defaulting to the nearest live date.
3. **Level**: defaults to the headline level. "Other levels" opens the full ladder (today's ladder, kept as the expert view).
4. **Amount.**
5. **Preview**: `OutcomePreview`.
6. **Action.**

Other parts of the pass:
- One primary button per step.
- A sticky bottom bar on phones: "You pay $101.75 · Place on Derive".
- The history chart collapses into "Price history".
- A page subtitle (D1).

**Files.** `Questions.jsx` (split into `SaloonFlow.jsx` and the existing ladder), `questions.css`.

**Tests.**
- Each step has one primary button.
- Deep links `/q/:id?side=` still land on the preview.
- The direction has no default.
- 375x667: the outlook, date and amount fit above the fold.
- The wordcheck.

**Done when** a new user reaches the preview in at most four taps from `/saloon`.

### P1.2 Positions (G16, G17 for display)

**Scope.**
- `/saloon/mine` becomes **Positions** (D4).
- Each card shows: the answer with its zone, You paid, Value now (sell-back), P/L now, Most it pays, Expiry with countdown, Status. Status is one of: Placed by hand / Only part filled / Settling / Settled — got $X.
- **Close trade** opens a summary first: expected proceeds at the sell-back price, Derive fees, P/L if closed now, compared with "if held to expiry at today's price". The manual legs sit in Order details. Stage 2 uses `TradeTicket` with `direction="sell"`.
- Export and Import move into a "Saved in this browser" (i) area.

**Files.** `MyQuestions.jsx`, `lib/questions.js` `closeTicket` (adds `proceeds`, `pl`), `lib/positions.js`.

**Tests.**
- The closing P/L equals proceeds minus fees minus paid.
- The settled maths.
- A partial position shows no close-at-ramp value.
- The empty state links to the Saloon.

**Done when** each card answers what I paid, what it is worth, what I would get, when it ends and whether it filled.

### P1.3 Navigation: Trade, Positions, Research (G18). Needs D3

**Scope.**
- The header shows Saloon (hat, with the subtitle beside it on desktop, as the Trade destination), then Positions, then Research.
- Research opens a disclosure menu: Markets, Radar, Options, Traders, Flow. On desktop the five can stay inline after the divider, smaller.
- On phones: three items, with Research as a menu sheet.
- Active states stay underlined.
- With the flag off, today's research nav is unchanged.

**Files.** `Shell.jsx`, `styles.css`.

**Tests.**
- `questions-flag-off.test.jsx` stays unchanged.
- Nav keyboard and escape behaviour.
- Research's active state covers its five routes.

**Done when** Positions is one tap from every page, and the phone header has at most three items plus the theme toggle.

### P2.1 Stage 2 execution states (behind `TRADE_ON`; coordinate with the stage 2 builder)

**Scope.** One state line and one primary button per state:
- **Quote loading:** "Asking Derive…".
- **Quote ready:** the price, "firm for N s", and the change vs the board.
- **Submitting:** "Sending to Derive…". The button is disabled, and nothing is re-sent.
- **Filled:** "Done · in Positions", only when `rfq_filled_pct === 1` and the positions confirm it.
- **Partially filled:** "Filled $X of $Y; the rest was cancelled". It is never styled as filled.
- **Failed:** a plain reason, plus Try again and Place by hand.

Other parts of the pass:
- A "Checking your fill…" state after a timeout.
- `OutcomePreview` driven by the firm quote.
- Stage 2 replaces "Open Derive / I placed it" only when the seat is ready.
- A visible network tag: "Testnet · dry run" now, nothing on mainnet.
- Production builds keep stage 1 (C3).

**Files.** `components/trade/TradeTicket.jsx`, `lib/trade/rfq.js` (the execute path at P6, owner approval), `MyQuestions.jsx` (reads Derive positions).

**Tests.**
- A state-machine table test for each state.
- Partial is never labelled filled.
- No resend after a timeout.
- The price change requires a fresh tap.
- `sell_only` and `off` kill-switch states.
- The bundle check: a flag-off build carries no trade code.

**Done when** the stage 2 design's P5 and P6 done-whens are met, and every state is in the screenshots.

### P2.2 Research leads and plain status (G14, G20, G21)

**Scope.**
- Every research page opens with one sentence: the plain takeaway, built from data with no forecast words. Each also carries one line of main uncertainty, for example "Wallet readings are context: the study has not reported" or "6 of 12 coins have no wallet reading yet".
- The evidence follows in order.
- `STATUS_NAMES` user-facing values collapse to "Not available yet" / "Updating", with the technical reason in (i).
- Add (i) to stretch, delta balance, gross delta, z-score, heat and ribbon labels where missing.

**Files.** New `lib/takeaway.js`, plus `Radar.jsx`, `Options.jsx`, `Traders.jsx`, `Flow.jsx`, `Coin.jsx`, `Markets.jsx`, `lib/presentation.js` and `lib/explain.js`.

**Tests.**
- A takeaway per page from fixtures.
- The regime and landing wordchecks extended to these strings.
- No raw `missing_quotes` / `stale` label is rendered.

**Done when** each research page can be understood from its first two lines.

### P3 Accessibility and touch pass (G22)

**Scope.**
- Minimum 12 px for text, and 11 px only for chart axis ticks.
- 44 px hit areas for the quick amounts, (i) (padding), Order details, Close trade and the date tabs.
- A scroll cue (fade) on overflowing tab rows.
- A contrast check of orange text on surfaces in light mode.
- `prefers-reduced-motion` stays respected.

**Files.** `styles.css`, `questions.css`, `ui.jsx` (`Info`).

**Tests.**
- An axe or jsdom check on the Saloon routes.
- A computed-size check in the shots script.

**Done when** the 375 / 390 / 1440 screenshots in dark and light pass a manual check.

---

## 4. Conflicts with owner rules or prior decisions

| # | Conflict | Resolution proposed |
|---|---|---|
| C1 | **"Price predictions" as the subtitle.** "predict*" is in `BANNED` and in the owner's no-forecast list, so the wordcheck would fail. | Use a compliant subtitle: **"Price outcomes"** (recommended); "Trade where {coin} settles"; "Pick a price, know your cost"; "Defined-risk price trades". Flag this to the owner; do not loosen `BANNED`. |
| C2 | **Yes/No and Up/Down.** The owner said on 4 October that each item "still reads as a question", and questions-design F2 specifies Yes/No buttons. The brief asks never to imply binary when the payout ramps. | **Option A** (recommended): Higher / Lower with the zone, and the question as "BTC on Mon 5 Oct, 08:00 UTC vs $83,000". **Option B**: keep Yes/No, but every button and the preview carry "full $1 from $X, part from $Y", and the slider is mandatory. Either way, drop "by". The owner decides (D2). |
| C3 | **One-tap vs copy-to-Derive.** Stage 2 targets V3; V3 mainnet has no date, and mainnet needs the owner's approval. The `TRADE_ON` flag allows only the testnet dry run (`flags.js`). | Production keeps stage 1, made honest (P0.3: "Placed by hand", fill confirmation). Integrated execution replaces "Open Derive / I placed it" only in `TRADE_ON` builds with a ready seat, always labelled "Testnet · dry run" until mainnet. Do not build a V2 path (stage 2 design §5). |
| C4 | **Em dashes.** CLAUDE.md says "One em dash for every missing value"; the brief says "Unavailable" with an explanation. | Saloon and Positions (decision surfaces): "No price now" / "Not available yet" with (i) giving the reason. Dense research tables keep the faint dash, with an `aria-label` and a table-level (i) explaining the dashes. Record the rule change in CLAUDE.md. |
| C5 | **Navigation.** The 4 October decision is a header led by Saloon with the hat, and research after a divider. "My seat" is the owner's name for positions. | Keep Saloon as the branded Trade entry; add Positions; group Research. Rename My seat to **Positions** (or "My seat" as the page title with "Positions" in the nav). The owner decides (D3, D4). |
| C6 | **Minimal visible text vs explicit costs and outcomes.** | The numbers are visible and the explanations stay behind (i). The preview adds about 4 lines of figures, not sentences. |
| C7 | **"Cents per $1" reads as a percentage chance.** This follows CLAUDE.md's "never % chance" rule in spirit. | Keep cents, but in the preview say "per $1 of payout" and show dollars. Never show a percentage. |
| C8 | **"Sensible defaults" vs "never advice".** | Default the date, level and amount; never default the direction, and never derive it from the three layers ("Context, not advice" stays beside, unlinked). |
| C9 | **Credit twins in stage 1** (questions-design decision 7: use the cheaper construction) **vs debit-only in stage 2.** | Recommend debit-only display for retail in both stages, accepting a cent or so of worse No price on some levels. The alternative is to keep credit but reword it (P0.2). The owner decides (D5). |
| C10 | **Landing page "no live readings" vs explaining the Saloon.** | A static Saloon section with an illustrative ramp stamped "Illustration" and no live prices. |

---

## 5. Decisions for the owner

1. **The Saloon subtitle.** Options: "Price outcomes" (recommended), "Trade where BTC settles", or "Defined-risk price trades". "Price predictions" fails the no-forecast rule.
2. **Answer labels.** Higher / Lower with the zone (recommended), or Yes / No kept with the zone and slider made mandatory. Also confirm dropping "Up or down from $K by …" in favour of "on …, 08:00 UTC".
3. **Navigation.** Saloon (Trade) · Positions · Research (menu), replacing the 4 October header. On desktop, should Research stay inline after the divider or become a menu?
4. **Positions naming.** "Positions" everywhere, or "My seat" kept as the page title.
5. **Credit twins.** Debit-only for retail tickets in stage 1 too (simpler wording, slightly higher No price), or keep the cheaper credit form with reworded copy.
6. **Stage 1 fill confirmation.** Should "I placed it" ask "Both filled / Only the first / Not yet" and let the user enter what they actually paid (recommended)? Or remove "I placed it" and keep positions only for stage 2?
7. **The em-dash rule.** Accept "No price now" / "Not available yet" with (i) on Saloon and Positions surfaces, keeping dashes in dense research tables, and update CLAUDE.md.
8. **The guided flow.** Make the stepped flow the default, with the ladder as "Other levels" (recommended), or keep the ladder first.
9. **Research takeaways.** Approve one data-built takeaway sentence plus one uncertainty line per research page, and their wording rules (wordcheck, no claims that wallets or alignment lead price before the study).
10. **Stage 2 visibility in production.** Should production show any hint of one-tap (for example "Coming with Derive V3")? Recommended: no, until mainnet approval.

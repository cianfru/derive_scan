# Production experience audit — 6 October 2026

Reviewed the visitor journey at `272495df1fd2c2476800983ab23ff52ab83ea0f5`: landing, Markets, BTC research, Saloon board and guided flow, outcome links, payout preview, trade review and the original three X-card models. The review used published data snapshots and local Chromium at 320, 390, 800, 1024 and 1440 pixels, plus component and model regressions. The corrections are integrated with the newer card catalogue merged in `c91d194`. This is a review of the visitor journey and its data contracts, not certification of live execution or a complete backend audit.

The strongest next step is to prove that a new visitor understands the outcome before trading. Cowboy already has useful research and a distinctive visual identity. Clear payout explanations, trustworthy availability and consistent behaviour matter more at this stage than another dashboard or a broad visual redesign.

## Corrections in this PR

| Priority | Finding | Correction |
| --- | --- | --- |
| P1 | Typing `25.50` could become `2550` because each keystroke converted the amount to a number. | Preserve the input draft; validate it before pricing or review. Carry the amount when opening another level. |
| P1 | An outcome URL could display a different headline outcome; a guided selection could change when the default date or headline changed. | Preserve the exact chosen identity, load removed links historically, and require an explicit new choice when a guided outcome disappears. |
| P2 | An idle Saloon page could retain availability beyond the existing price-age or settlement thresholds. | Update time-dependent states while the page is open and immediately on return from the background. Thresholds stay unchanged. |
| P2 | The mobile review left the background clickable and scrollable; desktop review focused a hidden button and claimed to be modal. | Isolate the mobile sheet, restore focus on close, and give the desktop column visible focus and appropriate semantics. |
| P2 | Higher/Lower controls advertised radio behaviour without supporting arrow keys. | Support keyboard selection and a single tab stop. |
| P2 | Feed failures could look like no matching outcomes or no available prices; cached refresh failures were silent. | Distinguish failed and partial reads from an empty market, and identify last-available data after failed refreshes. |
| P2 | Opening an `(i)` inside a journal form could submit it. | Make information buttons explicit non-submit controls. |
| P2 | Public copy promised execution or manual orders unavailable to that visitor. | Match copy to public exploration, dry run, testnet or eligible one-tap mode; explain test USDC and when nothing fills. |
| P2 | The firm quote’s cost could differ from the preview without an updated profit or breakeven figure. | Show both from the firm total and maximum approved fee, using the existing payout helpers. |
| P2 | The original Friday range, herd and ladder card models could describe stale research as agreement, show unavailable ladders, or round buy prices down. | Reuse the app’s freshness and availability rules, keep missing values missing, and round buy cents consistently with the Saloon. |

No document overflow or uncaught browser errors were found in the initial 25 page/viewport checks. The horizontal coin/date controls are intentional scroll rails. The shared research panel and roomier guided layout match the latest design direction. A new layout system is unnecessary for this release.

## Product and marketing direction

Keep the brand headline. Introduce the public product in plain language: **“Understand Derive markets. Explore higher-or-lower payouts before trading.”** Lead with what the current visitor can use. Execution claims belong to a mode that offers execution.

Use one demonstration throughout the journey: a coin, a settlement date, a level and a $100 amount. Show zero, partial and full settlement payouts, followed by profit or loss after cost. Explain early exit separately. Keep regime, wallets and options as independent context; do not present agreement as a validated trading signal.

The audited Friday range, herd and ladder cards are suitable material for testing that message once their data is current. A card should give one understandable observation, its time and source, and the product’s limits. Measure whether it helps people understand the product before increasing posting volume. This PR does not publish posts.

## Small pilot before wider promotion

Recruit 10–15 existing Derive users, including at least five who rarely use options. Observe these tasks without teaching the interface first:

1. Explain what Cowboy does and whether this browser can place a trade.
2. Open BTC from Markets; distinguish coin research from the row’s expandable readings and identify each reading’s time.
3. Choose a Saloon date, level, side and $100 amount; explain what the selected outcome pays below, within and above its partial-payout zone.
4. Distinguish total payout from profit or loss, and settlement from selling early.
5. Follow an outcome, return through My space and explain what changed.
6. In an approved testnet session, review the firm quote, fees and resulting execution status. Public-preview participants only review the figures.

Record unaided completion, hesitation, payout mistakes, confusion about execution mode, and which research layer participants found useful. Ask for voluntary feedback after seven days. Existing page views can describe traffic; use direct pilot follow-ups for repeat use rather than adding tracking.

A practical pilot decision rule is at least 8 of 10 participants correctly explaining partial payout and payout versus profit, with no participant mistaking a preview or dry run for a live fill. These are proposed product criteria, not statistical evidence of trading value. Correct the observed problems before widening the audience.

## Remaining work

- Run the comprehension pilot and an owner-approved execution rehearsal before expanding access. Passing interface tests does not establish live fill or settlement behaviour.
- An already-open `/control` card remains a snapshot. Reload before drafting or downloading; a future refresh action should preserve edited post text while revalidating the underlying data.
- Review the additional card models introduced by PR #97 before using them in promotion. They do not inherit the original three models’ new guards. For example, `longshotModel` accepts a buy price without checking the board’s pause, expiry and availability states. Live-market cards need those checks; historical settlement cards need different rules. This PR preserves the new catalogue rather than claiming it is fully audited.
- Confirm the previously requested Derive data-use approval with the owner’s existing contacts. The repository still records this follow-up; this audit did not verify its current status.
- Keep monitoring published feed freshness and recovery. The new notices make failures visible; they do not repair the upstream feed.

## Verification

Final local validation: **668 tests passed across 64 files** with two workers; both the default production build and `VITE_QUESTIONS=1` build passed; **70 Chromium checks passed** in both themes (60 page/viewport checks and 10 interaction checks), with no document overflow or uncaught browser errors. The earlier four-worker run had one five-second timeout in a testnet board test; that file passed independently, then the complete two-worker run passed.

Regressions exercise amount entry, outcome identity, time boundaries, review interaction, keyboard access, form submission, public execution claims and card freshness. Both builds matter because the default app excludes Saloon routes. CI validation is recorded in the PR.

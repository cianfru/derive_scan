# Rysk: receive premium beside Higher / Lower

Discussion brief for the owner's Rysk call, 7 October 2026. The accompanying mock uses made-up figures, places no orders and reads no Rysk prices. The product constraints below come from [CLAUDE.md](../CLAUDE.md); confirm them with the team before designing a live integration.

## Questions for the call

1. **Integration:** Is there a third-party taker API or partner SDK for quotes, approvals and order placement? Is a supported embedded flow available instead?
2. **Economics:** Are referral or integrator fees supported? Who pays each fee, and can Cowboy display the complete cost before confirmation?
3. **Markets:** Which coins and collateral assets, settlement dates, sizes and minimum deposits are available? What quote validity and capacity rules apply?
4. **Commitment:** Are both covered calls and cash-secured puts held to expiry with no early close? What happens at the exact strike, and when can collateral be withdrawn?
5. **Records:** How are fills, collateral locks, premium receipts and physical settlement reported? Which record is authoritative, including delayed or failed settlement?
6. **Display rights:** Can Cowboy cache and publish prices and market listings? What attribution, update frequency, timestamp and redistribution terms apply?

Current working constraints: HyperEVM; retail sells covered calls or cash-secured puts; physical settlement; no early exit; no public taker API or integrator fee confirmed. The last two are integration questions, not assumed capabilities. No live-price work starts before the owner's conversation.

## A different obligation in the same hub

Keep the Saloon chart and list as the discovery surface. A separate underlined **Receive premium** tab sits beside **Buy outcome** in the trade panel. Changing tabs changes the product, not the price source for the same trade. The preview flag is `VITE_RYSK_MOCK=1`; it is off by default, lazy-loaded and excluded from ordinary builds. With the flag off, the existing panel is preserved.

| | Buy outcome · Derive | Receive premium · Rysk |
| --- | --- | --- |
| Starting action | Pay for a two-option debit package | Sell an option against fully locked collateral |
| Money first shown | Total cost including fees | Locked coin or cash and its obligation |
| Settlement | Cash payout; partial payout is possible | Coin retained or sold; cash retained or exchanged for coin |
| Risk | Package loss bounded by its paid cost once complete | Coin value can fall; a covered call also gives up gains above its sale level |
| Leaving early | Sell back at available prices | No early exit under the current working constraints |
| Execution | Existing Derive flow | Not connected; partner/API support needs confirmation |

Do not reuse Higher/Lower bubbles as Rysk quotes, rank the two products as interchangeable, or turn the research readings into a recommendation to sell options. The selected ticker in the mock is illustrative, not evidence that Rysk lists it; dates, strike rules and quantities are not copied from a Derive contract.

## Obligation-first preview

1. Choose **Sell at a level** (covered call) or **Buy at a level** (cash-secured put).
2. Read **You lock until settlement**, the exact collateral quantity, the possible sale/purchase amount, **Physical settlement** and **No early exit**. The mock explicitly uses a **fabricated seven-day term from locking the collateral**; actual Rysk settlement dates need confirmation. The premium can be smaller than the collateral loss.
3. Read the premium in dollars. Distinguish gross premium, actual fees and net received once the API supplies them. The mock says **Example premium** and **Fees not modelled**.
4. Read three dollar settlement examples: retained collateral, a small premium that does not cover a price loss, and conversion at the agreed level. Separate what returns, what those holdings are worth and their change in value. Then, in a future live flow, review the complete order and explicitly approve it.

Definitions and settlement mechanics live behind (i). Collateral and the purchase/sale obligation stay visible, including on phones. There is no live review, wallet approval, funding or trade button in this mock.

## Dollar examples used in the mock

These are illustrations, not quotes. All use a made-up term of **seven days from locking the collateral**, not an available Rysk date. Premium is shown before unmodelled fees. Settlement examples avoid the exact strike because Rysk's boundary rule needs confirmation.

**Covered call:** lock 0.01 BTC, worth $850 at an illustrative starting price of $85,000; receive $24 premium; possible sale at $90,000 ($900 for the coin).

| BTC at settlement | Collateral returned / exchanged | Holdings + premium | Change versus $850 starting collateral |
| --- | --- | --- | --- |
| $68,000 | Retain 0.01 BTC, worth $680 | $680 + $24 | −$146 |
| $85,000 | Retain 0.01 BTC, worth $850 | $850 + $24 | +$24 |
| $108,000 | Sell 0.01 BTC for $900 | $900 + $24 | +$74 |

The last row gives up the coin's gains above $90,000. The comparison uses its illustrated value at lock time, not the user's purchase cost or a realized-profit claim. A coin falling to zero loses the starting collateral value less the premium, before fees.

**Cash-secured put:** lock $800; receive $22 premium; possible purchase of 0.01 BTC at $80,000.

| BTC at settlement | Collateral returned / exchanged | Holdings + premium | Change versus $800 locked cash |
| --- | --- | --- | --- |
| $48,000 | Buy 0.01 BTC, worth $480 | $480 + $22 | −$298 |
| $76,000 | Buy 0.01 BTC, worth $760 | $760 + $22 | −$18 |
| $102,000 | Retain $800 cash | $800 + $22 | +$22 |

The coin can keep falling after purchase. A $22 receipt does not make the second row profitable. Neither mode has the bought outcome's cash payoff ramp.

## Funding fits the hub; balances keep their meaning

Use one funding entry point with venue adapters. A future HyperEVM adapter can accept supported source chains and assets, quote conversion/bridge costs, reserve the required native gas, and track destination arrival and collateral readiness. Supported routes, actual time and cost need provider confirmation; the mock promises neither instant nor cheap execution.

Derive's available trading cash, Rysk's locked collateral, pending transfers and returned assets stay distinct. Locked collateral is not available to fund a Derive order. Moving funds between venues needs an explicit withdraw/transfer/deposit path, with its own confirmation and recovery state. An arrival on HyperEVM is not proof of a Rysk deposit or an executed option sale. Premium remains distinct from withdrawable collateral until its timing is confirmed.

## Decisions still open

- API access and permissions, quote acceptance and expiry, transaction sequence, partial fills, gas and full fee disclosure.
- Supported assets and wrappers, contract size/rounding, collateral accounting, exact-strike conversion and settlement timing.
- No-early-exit exceptions, delayed settlement, failed transfers and recovery without resending an order.
- Fill/settlement history and reconciliation, premium receipt timing and the authoritative balance source.
- Referral/integrator economics and permission to display, cache and redistribute prices.

The next milestone is a confirmed partner contract and a separately approved live design. This PR delivers a discussion mock and funding foundations, not Rysk trading.

# Competition around Derive (7 October 2026)

The owner asked: many projects on X build on top of Derive; what's the competition? This note is a desk review of public sources. Nothing was tested hands-on.

## Main finding

No public third-party retail front end, Telegram bot, mobile app, wallet tracker, trader leaderboard or simple up/down product built on Derive was found.

- **What Derive says.** Its V3 launch says "more than 20 teams" build on it and names "mobile-first options trading" and "prediction markets and binaries" as products that fit. It names none of the teams.
- **What is named.** Every named integration is institutional, a yield vault, or pro tooling.
- **Why this is unverified.** Builder Codes let an integrator keep Derive out of sight, so a white-label app could be live without saying where it trades.

## On Derive

| Who | What | Overlap with Cowboy |
|---|---|---|
| Derive's own app and vaults (covered-call c-tokens, basis b-tokens) | Yield strategies; Derive V2 TVL about $117M | Low |
| Derive V3 permissionless vaults | Anyone can curate a vault and charge fees. No curators found yet | Future competitor for "get paid to wait", or a partner to list instead of Rysk |
| Ethena, Flare (FXRP), HYPE bridge vault | Collateral and distribution | Low; Flare is a channel to XRP holders |
| Gold-i MatrixNET | Routes Derive to brokers via MT4/MT5 | B2B, institutional |
| Strands, BitGo, Haruko, FalconX | Custody, risk tools, market making | None (FalconX supplies the RFQ liquidity Cowboy uses) |
| Amberdata tab in Derive's app | Volatility curves, open interest, term structure | Part of the Options layer; no wallet data |
| Delphi Digital cross-venue options dashboard (free, July 2026) | Volatility, skew, gamma walls and strategy presets across Deribit, OKX, Bybit, Binance and Derive | Overlaps the Options layer; no Derive wallets, no regime engine, no trading |
| Laevitas, Block Scholes, Greeks.live | Pro derivatives research | Pro audience |
| Hummingbot, NautilusTrader, CCXT | Bot and market-making connectors | None |
| "Derive Pro" with Messari | An agent turns a view into one-click trades, aimed at pros | Similar idea; status unverified |
| Builder Codes and the API Broker programme | `extra_fee` per trade, open to anyone | A channel Cowboy can use |
| Builder grants | 500k OP, rolling | Possible funding for Cowboy |
| Derive's own leaderboard | Points for fees and referrals | Ranks fees, not skill as Cowboy's does |

## Outside Derive: simple price bets for retail

- **Polymarket.** About 20% of its volume is crypto, with 5-, 15- and 60-minute and daily up/down markets. It is cheaper than Derive's order book on the same daily question (`docs/polymarket-comparison.md`).
- **Hyperliquid HIP-4.** Launched May 2026 and permissionless since late August: binaries and "scaled options" inside the perp account, about $150M of volume by late September. It is the largest structural threat, because it has users from day one.
- **Others.** Limitless (Base), Predict.fun, DeepBook Predict on Sui (whitelist only) and Kalshi (regulated, US).
- **Rysk (HyperEVM).** About $50M TVL. Covered calls and cash-secured puts.

## What it means

- **Retail on Derive looks open.** Analysts and Derive itself say Derive is built for pros and institutions.
- **Wallet intel and the trader leaderboard look unique.** No one else ranks Derive's options wallets by P&L or tracks smart-wallet positioning. This holds only while V3 keeps wallets in public trades.
- **The options-structure layer is the most crowded.** Delphi and Amberdata already show it. Cowboy's edge there is making it plain for retail.
- **The Saloon's real competitors are Polymarket and HIP-4.** Derive invites binary-market builders, and a funded team could ship one fast. Cowboy's case rests on longer dates, any level, part-payout zones, selling back before expiry, and the research beside each trade.
- **Funding is available.** Builder Codes and the grants programme are open; Cowboy could be an early named case study.

## Not verified

- Derive Pro's status.
- The names behind the "20+ teams".
- Whether any V3 vault curators are live.
- Laevitas's coverage of Derive.
- The date of the Amberdata partnership.
- Derive's posts on X could not be read from here.

Sources: insights.derive.xyz (builder codes, b-tokens, c-tokens, Gold-i, HYPE, BitGo, grants), docs.derive.xyz (vaults, builder fee, incentives), forums.derive.xyz (V3 proposal), bankless.com (Derive V3), research.castlelabs.io (on-chain options map), insights4.vc, cryptobriefing.com (Delphi dashboard), blog.amberdata.io, haruko.io, hummingbot.org, nautilustrader.io, blockscholes.com, blog.sui.io, businesswire.com (HIP-4), thedefiant.io, decrypt.co.

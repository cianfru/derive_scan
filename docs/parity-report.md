# Data parity: Reflex's signals on Derive's candles vs Reflex's own candles

Generated 2026-10-01 21:03 UTC by `backend/research/parity_report.py` (Reflex code at commit e45ed97, copied in `backend/reflex`).

Same code on both sides; context held identical and neutral (consensus MIXED, no positioning, no market-wide inputs), so differences come from the candles alone: Derive's index price and perp volume vs Hyperliquid's perp candles (Reflex's primary source). Every closed bar of the last 365 days, replayed in order with the agent filters' state carried bar to bar, as live.

This checks the port. It is not a performance claim.

## 4H (2190 bars per coin)

| | BTC | ETH |
|---|---|---|
| Bars compared | 2190 | 2190 |
| Close price, mean abs difference | 0.050% | 0.050% |
| Regime agrees | 99.3% | 99.1% |
| Raw RCCE signal agrees | 99.4% | 99.3% |
| Final signal agrees | 98.3% | 98.8% |
| Final side agrees (entry / wait / exit) | 98.3% | 98.8% |
| Entry bars, Derive vs Hyperliquid | 150 vs 135 | 126 vs 125 |
| Z-score correlation | 1.000 | 1.000 |
| Z-score mean abs difference | 0.010 | 0.007 |
| Heat phase agrees | 97.4% | 97.9% |
| Exhaustion state agrees | 92.8% | 96.9% |
| Ribbon state agrees | 99.5% | 99.7% |

## 1D (365 bars per coin)

| | BTC | ETH |
|---|---|---|
| Bars compared | 365 | 365 |
| Close price, mean abs difference | 0.050% | 0.051% |
| Regime agrees | 98.6% | 99.7% |
| Raw RCCE signal agrees | 98.4% | 99.5% |
| Final signal agrees | 97.0% | 100.0% |
| Final side agrees (entry / wait / exit) | 97.0% | 100.0% |
| Entry bars, Derive vs Hyperliquid | 64 vs 59 | 53 vs 53 |
| Z-score correlation | 1.000 | 1.000 |
| Z-score mean abs difference | 0.005 | 0.002 |
| Heat phase agrees | 97.3% | 97.5% |
| Exhaustion state agrees | 89.9% | 99.2% |
| Ribbon state agrees | 100.0% | 100.0% |

## Reading it

- Price: Derive's index is a spot index; Hyperliquid's candles are perp trades. Small gaps in closes, highs and lows move z-scores, heat and exhaustion slightly, and a regime near a boundary can flip.
- Volume: Derive's perp volume is a fraction of Hyperliquid's; only relative volume enters the exhaustion engine, but a thinner market has noisier relative volume.
- Live signals on Derive also differ from Reflex's through consensus (Derive's ~15 perps vs Reflex's 200+), positioning (Derive's funding and open interest) and inputs Reflex has and Derive Scan does not (CoinGlass, HyperLens). Those are held equal here on purpose.

Run time 221 s.

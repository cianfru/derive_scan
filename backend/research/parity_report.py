"""Data parity: Reflex's signals on Derive's candles vs on the candles Reflex itself uses.

One-off, offline research read (not a feed in the product). For BTC and ETH, every closed 4H
and daily bar of the last 365 days is replayed through the same code (the copied Reflex
engines, synthesizer, decision pipeline and agent filters) twice: once on Derive's candles
(index price, perp volume) and once on Hyperliquid perp candles (Reflex's primary source).
Context is held identical on both sides (consensus MIXED, no positioning, no market-wide
inputs), so every difference comes from the candles alone.

    python research/parity_report.py OUT.md
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path

import httpx
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from derive import signals as sig  # noqa: E402
from derive.candles import TF_SEC, fetch_bars, last_closed_open  # noqa: E402
from derive.client import DeriveClient  # noqa: E402
from derive.config import SOURCES  # noqa: E402

UNDS = ("BTC", "ETH")
DAYS = 365
WARMUP = {"4h": 620, "1d": 620, "1w": 220}
FIELDS = ("timestamp", "open", "high", "low", "close", "volume")
ENTRY = {"STRONG_LONG", "LIGHT_LONG", "ACCUMULATE", "REVIVAL_SEED", "REVIVAL_SEED_CONFIRMED"}
EXIT = {"TRIM", "TRIM_HARD", "RISK_OFF", "NO_LONG", "LIGHT_SHORT"}


def side(signal: str) -> str:
    return "entry" if signal in ENTRY else "exit" if signal in EXIT else "wait"


def to_arrays(rows: list[list]) -> dict:
    arr = np.array(rows, dtype=np.float64)
    return {f: arr[:, i] for i, f in enumerate(FIELDS)}


async def derive_candles(now: float) -> dict:
    client = DeriveClient(SOURCES["v2_mainnet"]["base"])
    out = {}
    try:
        for und in UNDS:
            for tf in ("4h", "1d", "1w"):
                end = last_closed_open(tf, now)
                bars = DAYS * 86_400 // TF_SEC[tf] + WARMUP[tf] if tf != "1w" else WARMUP[tf]
                out[(und, tf)] = to_arrays(await fetch_bars(client, und, tf, end - (bars - 1) * TF_SEC[tf], end))
    finally:
        await client.close()
    return out


def hyperliquid_candles(now: float) -> dict:
    out = {}
    with httpx.Client(timeout=30) as http:
        for und in UNDS:
            for tf in ("4h", "1d", "1w"):
                end = last_closed_open(tf, now)
                bars = DAYS * 86_400 // TF_SEC[tf] + WARMUP[tf] if tf != "1w" else WARMUP[tf]
                start = end - (bars - 1) * TF_SEC[tf]
                r = http.post("https://api.hyperliquid.xyz/info", json={"type": "candleSnapshot", "req": {
                    "coin": und, "interval": tf, "startTime": start * 1000, "endTime": (end + TF_SEC[tf]) * 1000 - 1}})
                r.raise_for_status()
                rows = [[c["t"], c["o"], c["h"], c["l"], c["c"], c["v"]] for c in r.json()
                        if start * 1000 <= c["t"] <= end * 1000]
                out[(und, tf)] = to_arrays(rows)
    return out


def replay(candles: dict, tf: str, closes: list[int]) -> dict:
    state = sig.fresh_state()
    consensus = {"consensus": "MIXED", "strength": 0.0, "counts": {}}
    out = {u: [] for u in UNDS}
    for close in closes:
        as_of = close + 60.0
        for und in UNDS:
            r = sig.process_symbol(und, tf, candles[(und, tf)], candles[(und, "1w")],
                                   candles[("BTC", tf)], candles[("ETH", tf)], as_of * 1000)
            context = dict(consensus=consensus, global_metrics=None, positioning=None, sentiment=None, stablecoin=None,
                           cvd_trend="UNAVAILABLE", cvd_divergence=False, spot_dominance="UNAVAILABLE",
                           long_short_ratio=1.0, liquidation_24h_usd=0.0, etf_flow_usd=0.0, cb_premium=0.0,
                           has_coinglass=False, hl_consensus_trend="NEUTRAL", hl_consensus_confidence=0.0,
                           hl_consensus_net_ratio=0.0, has_hyperlens=False)
            sig.evaluate_decision(r, context, state, as_of=as_of, metadata={}, synthesizer=sig.synthesize_signal)
            out[und].append({k: r.get(k) for k in ("signal_bar_close_time", "decision_price", "regime", "raw_signal",
                                                   "signal", "zscore", "heat", "heat_phase", "exhaustion_state",
                                                   "volume_status")} | {"ribbon": (r.get("ribbon") or {}).get("state")})
    return out


def pct(a: int, b: int) -> str:
    return f"{100.0 * a / b:.1f}%" if b else "n/a"


def main() -> None:
    out_md = Path(sys.argv[1])
    now = time.time()
    t0 = time.time()
    dv = asyncio.run(derive_candles(now))
    hl = hyperliquid_candles(now)
    lines = ["# Data parity: Reflex's signals on Derive's candles vs Reflex's own candles", "",
             f"Generated {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(now))} by `backend/research/parity_report.py` "
             f"(Reflex code at commit e45ed97, copied in `backend/reflex`).", "",
             "Same code on both sides; context held identical and neutral (consensus MIXED, no positioning, no market-wide "
             "inputs), so differences come from the candles alone: Derive's index price and perp volume vs Hyperliquid's "
             "perp candles (Reflex's primary source). Every closed bar of the last 365 days, replayed in order with the "
             "agent filters' state carried bar to bar, as live.", "",
             "This checks the port. It is not a performance claim.", ""]
    raw = {}
    for tf in ("4h", "1d"):
        step = TF_SEC[tf]
        last = last_closed_open(tf, now)
        closes = [o + step for o in range(last - (DAYS * 86_400 // step - 1) * step, last + 1, step)]
        d, h = replay(dv, tf, closes), replay(hl, tf, closes)
        raw[tf] = {"derive": d, "hyperliquid": h}
        lines += [f"## {tf.upper()} ({len(closes)} bars per coin)", "",
                  "| | BTC | ETH |", "|---|---|---|"]
        rows = {}
        for und in UNDS:
            a = {x["signal_bar_close_time"]: x for x in d[und]}
            b = {x["signal_bar_close_time"]: x for x in h[und]}
            common = sorted(set(a) & set(b))
            n = len(common)
            same = lambda k: sum(a[t][k] == b[t][k] for t in common)  # noqa: E731
            za = np.array([a[t]["zscore"] for t in common], float)
            zb = np.array([b[t]["zscore"] for t in common], float)
            pa = np.array([a[t]["decision_price"] for t in common], float)
            pb = np.array([b[t]["decision_price"] for t in common], float)
            sides = Counter((side(a[t]["signal"]), side(b[t]["signal"])) for t in common)
            entries_d = sum(side(a[t]["signal"]) == "entry" for t in common)
            entries_h = sum(side(b[t]["signal"]) == "entry" for t in common)
            rows[und] = {
                "Bars compared": str(n),
                "Close price, mean abs difference": f"{np.mean(np.abs(pa / pb - 1)) * 100:.3f}%",
                "Regime agrees": pct(same("regime"), n),
                "Raw RCCE signal agrees": pct(same("raw_signal"), n),
                "Final signal agrees": pct(same("signal"), n),
                "Final side agrees (entry / wait / exit)": pct(sum(v for (x, y), v in sides.items() if x == y), n),
                "Entry bars, Derive vs Hyperliquid": f"{entries_d} vs {entries_h}",
                "Z-score correlation": f"{np.corrcoef(za, zb)[0, 1]:.3f}" if n > 2 else "n/a",
                "Z-score mean abs difference": f"{np.mean(np.abs(za - zb)):.3f}",
                "Heat phase agrees": pct(same("heat_phase"), n),
                "Exhaustion state agrees": pct(same("exhaustion_state"), n),
                "Ribbon state agrees": pct(same("ribbon"), n),
            }
        for k in rows["BTC"]:
            lines.append(f"| {k} | {rows['BTC'][k]} | {rows['ETH'][k]} |")
        lines.append("")
    lines += ["## Reading it", "",
              "- Price: Derive's index is a spot index; Hyperliquid's candles are perp trades. Small gaps in closes, highs "
              "and lows move z-scores, heat and exhaustion slightly, and a regime near a boundary can flip.",
              "- Volume: Derive's perp volume is a fraction of Hyperliquid's; only relative volume enters the exhaustion "
              "engine, but a thinner market has noisier relative volume.",
              "- Live signals on Derive also differ from Reflex's through consensus (Derive's ~15 perps vs Reflex's 200+), "
              "positioning (Derive's funding and open interest) and inputs Reflex has and Derive Scan does not (CoinGlass, "
              "HyperLens). Those are held equal here on purpose.",
              "", f"Run time {time.time() - t0:.0f} s."]
    out_md.write_text("\n".join(lines) + "\n")
    (out_md.with_suffix(".json")).write_text(json.dumps(raw, default=float))
    print("\n".join(lines))


if __name__ == "__main__":
    main()

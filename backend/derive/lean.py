"""Options lean: how options positioning on a coin reads right now, as context beside the signal.

Four readings, each scaled to -1 (defensive) .. +1 (leaning up), averaged:

skew     the 30-day 25-delta risk reversal against its own range over the recorded history
         (bottom of the range: protection is unusually expensive)
flow     taker option premium over 7 days, market makers left out: calls bought and puts sold
         lean up, puts bought and calls sold lean down
put_call change in the put/call open-interest ratio over about 7 days (puts added: defensive)
term     7-day ATM volatility above 30-day (short-dated stress); only ever defensive

A state needs at least two readings. It describes current positioning; it is not part of the
signal and makes no claim about returns (docs/options-traders-study.md is the study that would
be needed for that).
"""
from __future__ import annotations

import math

DEFENSIVE, UP = -0.25, 0.25
MIN_HISTORY = 96  # 15-minute points (one day) before the skew reading is used
FLOW_MIN_USD = 5_000
MIN_READINGS = 2


def _clip(x: float) -> float:
    return max(-1.0, min(1.0, x))


def skew_reading(history: list[float], now: float | None) -> float | None:
    vals = [v for v in history if v is not None]
    if now is None or len(vals) < MIN_HISTORY:
        return None
    below = sum(1 for v in vals if v < now) + 0.5 * sum(1 for v in vals if v == now)
    return _clip((below / len(vals) - 0.5) * 2)


def flow_reading(flow: dict | None) -> float | None:
    if not flow:
        return None
    c, p = flow.get("call") or {}, flow.get("put") or {}
    up = c.get("buy_premium_usd", 0) + p.get("sell_premium_usd", 0)
    down = p.get("buy_premium_usd", 0) + c.get("sell_premium_usd", 0)
    total = up + down
    return None if total < FLOW_MIN_USD else _clip((up - down) / total)


def put_call_reading(then: float | None, now: float | None) -> float | None:
    if not then or not now or then <= 0 or now <= 0:
        return None
    return _clip(-math.log(now / then) / 0.2)


def term_reading(iv7: float | None, iv30: float | None) -> float | None:
    if not iv7 or not iv30:
        return None
    return -_clip(max(0.0, iv7 - iv30) / 0.05)


def options_lean(features: dict, iv_history: list[list], flow_7d: dict | None) -> dict:
    """iv_history rows: [ts, atm_iv_7d, atm_iv_30d, atm_iv_90d, rr25_30d, bf25_30d, pc_oi_ratio]."""
    ts_now = iv_history[-1][0] if iv_history else None
    week_ago = [h for h in iv_history if ts_now and h[0] <= ts_now - 7 * 86400 + 900 and h[6]]
    parts = {
        "skew": skew_reading([h[4] for h in iv_history], features.get("rr25_30d")),
        "flow": flow_reading(flow_7d),
        "put_call": put_call_reading(week_ago[-1][6] if week_ago else None, features.get("pc_oi_ratio")),
        "term": term_reading(features.get("atm_iv_7d"), features.get("atm_iv_30d")),
    }
    parts = {k: None if v is None else round(v, 3) + 0.0 for k, v in parts.items()}
    vals = [v for v in parts.values() if v is not None]
    if len(vals) < MIN_READINGS:
        return {"state": None, "score": None, "parts": parts}
    score = sum(vals) / len(vals)
    state = "defensive" if score <= DEFENSIVE else "up" if score >= UP else "neutral"
    return {"state": state, "score": round(score, 3), "parts": parts}

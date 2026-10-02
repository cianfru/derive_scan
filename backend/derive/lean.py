"""Options lean: how options positioning on a coin reads right now, as context beside the signal.

Four readings, each scaled to -1 (defensive) .. +1 (leaning up), averaged:

skew     the 30-day 25-delta risk reversal against its own range over the recorded history
         (bottom of the range: protection is unusually expensive); its raw level until a day
         is recorded
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
RAW_SKEW_SCALE = 0.04


def _clip(x: float) -> float:
    return max(-1.0, min(1.0, x))


def skew_reading(history: list[float], now: float | None) -> float | None:
    """Against its own recorded range; until a day is recorded, the raw value (4 vol points = full scale)."""
    vals = [v for v in history if v is not None]
    if now is None:
        return None
    if len(vals) < MIN_HISTORY:
        return _clip(now / RAW_SKEW_SCALE)
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


# Alignment by horizon: the engine, option prices and smart wallets, each read as up, neutral or
# defensive for the next 7 and the next 30 days. Context beside the signal, not a combined signal.

UP_SIGNALS = {"STRONG_LONG", "LIGHT_LONG", "ACCUMULATE", "REVIVAL_SEED", "REVIVAL_SEED_CONFIRMED"}
DEFENSIVE_SIGNALS = {"TRIM", "TRIM_HARD", "RISK_OFF", "NO_LONG", "LIGHT_SHORT"}
WALLET_TIER = "smart"
WALLET_MIN_USD = 10_000
WALLET_MIN_POSITIONS = 3
HORIZONS = {"7d": 7, "30d": 30}


def state_of(v: float | None) -> str | None:
    return None if v is None else "defensive" if v <= DEFENSIVE else "up" if v >= UP else "neutral"


def engine_reading(signal: str | None) -> float | None:
    if not signal:
        return None
    return 1.0 if signal in UP_SIGNALS else -1.0 if signal in DEFENSIVE_SIGNALS else 0.0


def options_reading(horizon: str, features: dict, iv_history: list[list], flows: dict | None) -> dict:
    flows = flows or {}
    if horizon == "7d":
        hist = [h[7] if len(h) > 7 else None for h in iv_history]
        parts = {"skew": skew_reading(hist, features.get("rr25_7d")), "flow": flow_reading(flows.get("24h")),
                 "term": term_reading(features.get("atm_iv_7d"), features.get("atm_iv_30d"))}
    else:
        lean = options_lean(features, iv_history, flows.get("7d"))
        parts = {k: lean["parts"][k] for k in ("skew", "flow", "put_call")}
    parts = {k: None if v is None else round(v, 3) + 0.0 for k, v in parts.items()}
    vals = [v for v in parts.values() if v is not None]
    score = round(sum(vals) / len(vals), 3) if len(vals) >= MIN_READINGS else None
    return {"state": state_of(score), "score": score, "parts": parts}


def _delta(strikes: dict | None, expiry: int, strike: float, cp: str, index: float, now: float) -> float:
    from .history import option_delta
    for r in ((strikes or {}).get("expiries") or {}).get(str(expiry), []):
        if abs(float(r[0]) - strike) < 1e-9 and len(r) > 5 and r[5] is not None:
            return float(r[5]) if cp == "C" else float(r[5]) - 1
    return option_delta(index, strike, max(expiry - now, 0) / (365 * 86400), 0.5, cp)


def wallets_reading(positions: dict | None, strikes: dict | None, index: float | None, now: float, days: float,
                    tier: str = WALLET_TIER) -> dict:
    """Net delta of the tier's open option positions on expiries within `days`, as a share of gross."""
    from .history import parse_option
    net = gross = 0.0
    held = 0
    complete = True
    for name, cells in (positions or {}).items():
        o = parse_option(name)
        cell = (cells or {}).get(tier)
        if not o or not cell or not index or not now < o[1] <= now + days * 86400:
            continue
        unit_delta = _delta(strikes, o[1], o[2], o[3], index, now) * index
        net += cell[0] * unit_delta
        held += cell[1]
        if len(cell) < 3:
            complete = False  # Legacy snapshots do not retain gross exposure.
        else:
            gross += cell[2] * abs(unit_delta)
    score = round(net / gross, 3) if complete and gross >= WALLET_MIN_USD and held >= WALLET_MIN_POSITIONS else None
    return {"state": state_of(score), "score": score, "net_delta_usd": round(net, 2), "gross_delta_usd": round(gross, 2) if complete else None,
            "positions": held, "gross_complete": complete}


def alignment(signal_4h: str | None, signal_1d: str | None, features: dict, iv_history: list[list], flows: dict | None,
              positions: dict | None, strikes: dict | None, index: float | None, now: float) -> dict:
    out, score = {}, 0
    for h, days in HORIZONS.items():
        sig = signal_4h if h == "7d" else signal_1d
        e = engine_reading(sig)
        row = {"engine": {"signal": sig, "state": state_of(e)}, "options": options_reading(h, features, iv_history, flows),
               "wallets": wallets_reading(positions, strikes, index, now, days)}
        dirs = [{"up": 1, "defensive": -1}.get(row[k]["state"], 0) for k in ("engine", "options", "wallets")]
        if dirs[0]:
            score += sum(1 if d == dirs[0] else -1 if d == -dirs[0] else 0 for d in dirs[1:])
        row["aligned"] = row["engine"]["state"] if dirs[0] and all(d == dirs[0] for d in dirs) else None
        out[h] = row
    return {"horizons": out, "score": score}

"""Separate current options tone, surface context and held-wallet exposure.

Version 2 tone averages two fixed components: absolute skew and covered taker premium.
Term structure and put/call OI are descriptive context, never directional votes. This is
not an input to the signal engine or the declared wallet study.
"""
from __future__ import annotations

from .quality import ANALYTICS_VERSION, engine_status, number, snapshot_status
from .valuation import delta_at

DEFENSIVE, UP = -0.25, 0.25
MIN_HISTORY = 96
FLOW_MIN_USD = 5_000
RAW_SKEW_SCALE = 0.04
UP_SIGNALS = {"STRONG_LONG", "LIGHT_LONG", "ACCUMULATE", "REVIVAL_SEED", "REVIVAL_SEED_CONFIRMED"}
DEFENSIVE_SIGNALS = {"TRIM", "TRIM_HARD", "RISK_OFF", "NO_LONG", "LIGHT_SHORT"}
WALLET_TIER = "smart"
WALLET_MIN_USD = 10_000
WALLET_MIN_POSITIONS = 3
HORIZONS = {"7d": 7, "30d": 30}


def _clip(x):
    return max(-1.0, min(1.0, x))


def state_of(v):
    return None if v is None else "defensive" if v <= DEFENSIVE else "up" if v >= UP else "neutral"


def skew_reading(history: list[float], now: float | None) -> float | None:
    """Absolute RR25, always on the same scale. History never changes its meaning."""
    value = number(now)
    return None if value is None else _clip(value / RAW_SKEW_SCALE)


def relative_skew(history, column, value):
    value = number(value)
    samples = sorted({r[0]: number(r[column]) for r in history if len(r) > column
                      and number(r[column]) is not None}.items())
    first, last = (samples[0][0], samples[-1][0]) if samples else (None, None)
    span = last - first if samples else 0
    expected = span / 900 + 1
    coverage = min(1.0, len(samples) / expected)
    ready = len(samples) >= MIN_HISTORY and span >= 86400 - 900 and coverage >= .9 and number(value) is not None
    values = [v for _, v in samples]
    percentile = 100 * (sum(v < value for v in values) + .5 * sum(v == value for v in values)) / len(values) if ready else None
    return {"percentile": round(percentile, 1) if percentile is not None else None,
            "samples": len(samples), "first": first, "last": last, "coverage": round(coverage, 3),
            "status": "ready" if ready else "building"}


def flow_reading(flow):
    if not flow or not (flow.get("coverage") or {}).get("ready"):
        return None
    c, p = flow.get("call") or {}, flow.get("put") or {}
    up = c.get("buy_premium_usd", 0) + p.get("sell_premium_usd", 0)
    down = p.get("buy_premium_usd", 0) + c.get("sell_premium_usd", 0)
    total = up + down
    return None if total < FLOW_MIN_USD else _clip((up - down) / total)


def options_reading(horizon, features, iv_history, flows, *, observed_at=None, now=None):
    window = "24h" if horizon == "7d" else "7d"
    rr = features.get("rr25_7d" if horizon == "7d" else "rr25_30d")
    fresh = snapshot_status(observed_at, now) if now is not None else "unknown"
    flow = (flows or {}).get(window) or {}
    parts = {"skew": skew_reading([], rr) if fresh == "ready" else None, "flow": flow_reading(flow)}
    parts = {k: round(v, 3) if v is not None else None for k, v in parts.items()}
    score = round((parts["skew"] + parts["flow"]) / 2, 3) if all(v is not None for v in parts.values()) else None
    status = "ready" if score is not None else fresh if fresh != "ready" else "partial_flow" if not (flow.get("coverage") or {}).get("ready") else "insufficient_data"
    iv7, iv30 = number(features.get("atm_iv_7d")), number(features.get("atm_iv_30d"))
    return {"version": ANALYTICS_VERSION, "state": state_of(score), "score": score, "parts": parts,
            "status": status, "observed_at": observed_at, "tenor_days": HORIZONS[horizon], "flow_window": window,
            "flow_coverage": flow.get("coverage"),
            "relative_skew": relative_skew(iv_history, 7 if horizon == "7d" else 4, rr),
            "context": {"term_iv_spread": iv7 - iv30 if iv7 is not None and iv30 is not None else None,
                        "pc_oi_ratio": features.get("pc_oi_ratio")}}


def options_lean(features, iv_history, flow_7d, *, observed_at=None, now=None):
    return options_reading("30d", features, iv_history, {"7d": flow_7d}, observed_at=observed_at, now=now)


def wallets_reading(positions, strikes, index, now, days, tier=WALLET_TIER):
    """Held-book exposure. A position count is not a distinct-wallet count."""
    from .history import parse_option
    net = gross = estimated_gross = 0.0
    held = missing = estimated = 0
    complete = True
    for name, cells in (positions or {}).items():
        option = parse_option(name)
        cell = (cells or {}).get(tier)
        if not option or not cell or not now < option[1] <= now + days * 86400:
            continue
        held += cell[1]
        delta, source = delta_at(strikes, option[1], option[2], option[3], index, now)
        if delta is None or not index or len(cell) < 3:
            missing += cell[1]
            complete = False
            continue
        unit = delta * index
        net += cell[0] * unit
        gross += cell[2] * abs(unit)
        if source != "quoted":
            estimated += cell[1]
            estimated_gross += cell[2] * abs(unit)
    score = round(net / gross, 3) if complete and not estimated and gross >= WALLET_MIN_USD and held >= WALLET_MIN_POSITIONS else None
    status = "missing_quotes" if not complete else "modelled_delta" if estimated else "ready" if score is not None else "insufficient_exposure"
    return {"state": state_of(score), "score": score, "net_delta_usd": round(net, 2) if complete else None,
            "gross_delta_usd": round(gross, 2) if complete else None, "positions": held,
            "gross_complete": complete, "status": status, "estimated_positions": estimated,
            "missing_positions": missing, "estimated_gross_share": round(estimated_gross / gross, 3) if gross else None,
            "valuation_at": (strikes or {}).get("ts"), "expiry_days": days}


def alignment(row_4h, row_1d, features, iv_history, flows, positions, strikes, index, now, *, options_at=None):
    out, score = {}, 0
    for h, days in HORIZONS.items():
        engine = row_1d  # One daily price engine, separate option/expiry horizons.
        status = engine_status(engine, now)
        if status == "ready" and engine.get("volume_status") != "ok":
            status = "thin_volume"
        sig = (engine or {}).get("signal")
        e = (1.0 if sig in UP_SIGNALS else -1.0 if sig in DEFENSIVE_SIGNALS else 0.0) if status == "ready" else None
        row = {"engine": {"signal": sig, "state": state_of(e), "status": status,
                          "timeframe": "1d", "regime": (engine or {}).get("regime"),
                          "data_status": (engine or {}).get("data_status"), "history_bars": (engine or {}).get("history_bars"),
                          "volume_status": (engine or {}).get("volume_status"), "engine_errors": (engine or {}).get("engine_errors"), "observed_at": (engine or {}).get("signal_bar_close_time")},
               "options": options_reading(h, features, iv_history, flows, observed_at=options_at, now=now),
               "wallets": wallets_reading(positions, strikes, index, now, days)}
        dirs = [{"up": 1, "defensive": -1}.get(row[k]["state"], 0) for k in ("engine", "options", "wallets")]
        if dirs[0]:
            score += sum(1 if d == dirs[0] else -1 if d == -dirs[0] else 0 for d in dirs[1:])
        row["aligned"] = row["engine"]["state"] if dirs[0] and all(d == dirs[0] for d in dirs) else None
        out[h] = row
    return {"version": ANALYTICS_VERSION, "horizons": out, "score": score}

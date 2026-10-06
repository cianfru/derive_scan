"""When the daily close last crossed the weekly band, as the engine reads the band.

The engine's up-setups need the daily close above the weekly band (the average of the
21-week EMA and 20-week SMA of weekly closes, from weeks closed by that daily close, after
dropping weekly bars the daily candles contradict). Its regime is read from the z-score
instead, so a regime can run long before price crossed the band. The coin page shows both.
"""
from __future__ import annotations

import numpy as np

import reflex  # noqa: F401  (puts the copied Reflex code on the path)
from candle_snapshot import TF_MS, closed_candles, consistent_weekly  # noqa: E402
from engines.heatmap_engine import EMA_LEN, SMA_LEN, _ema, _sma  # noqa: E402

DAY_MS = TF_MS["1d"]


def band_mid(daily: dict, weekly: dict, close_ms: float) -> float | None:
    """The band the engine uses at the daily close ending at close_ms."""
    w = closed_candles(weekly, "1w", close_ms)
    w = consistent_weekly(w, closed_candles(daily, "1d", close_ms), "1d")
    if w is None:
        return None
    closes = np.asarray(w["close"], dtype=np.float64)[-199:]
    if len(closes) < max(EMA_LEN, SMA_LEN):
        return None
    mid = (_ema(closes, EMA_LEN) + _sma(closes, SMA_LEN)) / 2.0
    v = float(mid[-1])
    return v if np.isfinite(v) and v > 0 else None


def band_since(daily: dict | None, weekly: dict | None, as_of_ms: float | None = None,
               days: int = 400) -> dict | None:
    """Over the daily bars closed by as_of_ms: {side: "above" | "below", since: open of the first daily bar on that side (s),
    days, open: True when the run reaches the start of the bars read}. None without a band."""
    if as_of_ms is not None:
        daily = closed_candles(daily, "1d", as_of_ms)
    if daily is None or weekly is None or not len(daily["close"]):
        return None
    ts = np.asarray(daily["timestamp"], dtype=np.float64)
    close = np.asarray(daily["close"], dtype=np.float64)
    side, start, edge = None, None, False
    first = max(0, len(ts) - days)
    for i in range(len(ts) - 1, first - 1, -1):
        mid = band_mid(daily, weekly, ts[i] + DAY_MS)
        if mid is None:
            edge = True
            break
        s = "above" if close[i] >= mid else "below"
        if side is None:
            side = s
        elif s != side:
            break
        start = i
    if side is None:
        return None
    return {"side": side, "since": int(ts[start] // 1000), "days": len(ts) - start,
            "open": edge or start == first}

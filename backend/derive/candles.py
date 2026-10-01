"""Closed OHLCV candles per perp, from Derive, cached as append-only CSV on the `data` branch.

Price: the spot index Derive marks and settles against (`public/get_index_chart_data`).
Volume: the perp's traded volume in contracts (`public/get_tradingview_chart_data`); 0 for a
bar with no trades. Timestamps are bar opens in milliseconds, as Reflex's engines expect.

candles/{UND}/{4h|1d|1w}.csv   timestamp,open,high,low,close,volume
"""
from __future__ import annotations

import csv
import io
import logging
from pathlib import Path

import numpy as np

from .client import DeriveClient

log = logging.getLogger(__name__)

TF_SEC = {"4h": 14_400, "1d": 86_400, "1w": 604_800}
# Bars fetched on the first run: Reflex keeps 599 bars per timeframe (199 weekly) and
# needs ~600 for its full warm-up, so a little more is kept.
HISTORY_BARS = {"4h": 700, "1d": 700, "1w": 220}
# Weekly bars open on Monday 00:00 UTC; the unix epoch began on a Thursday.
WEEK_OFFSET_SEC = 4 * 86_400
FIELDS = ("timestamp", "open", "high", "low", "close", "volume")


def last_closed_open(tf: str, now: float) -> int:
    """Open time (seconds) of the newest bar that has fully closed at `now`."""
    step = TF_SEC[tf]
    offset = WEEK_OFFSET_SEC if tf == "1w" else 0
    current_open = (int(now) - offset) // step * step + offset
    return current_open - step


class CandleCache:
    def __init__(self, root: Path | str):
        self.root = Path(root) / "candles"

    def path(self, und: str, tf: str) -> Path:
        return self.root / und / f"{tf}.csv"

    def load(self, und: str, tf: str) -> dict | None:
        p = self.path(und, tf)
        if not p.exists():
            return None
        rows = list(csv.reader(p.open()))[1:]
        if not rows:
            return None
        arr = np.array(rows, dtype=np.float64)
        return {f: arr[:, i] for i, f in enumerate(FIELDS)}

    def last_ts_sec(self, und: str, tf: str) -> int | None:
        p = self.path(und, tf)
        if not p.exists():
            return None
        last = None
        with p.open() as f:
            for last in f:
                pass
        if last is None or last.startswith("timestamp"):
            return None
        return int(float(last.split(",")[0])) // 1000

    def append(self, und: str, tf: str, bars: list[list]) -> None:
        if not bars:
            return
        p = self.path(und, tf)
        p.parent.mkdir(parents=True, exist_ok=True)
        new = not p.exists()
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        if new:
            w.writerow(FIELDS)
        w.writerows(bars)
        with p.open("a") as f:
            f.write(buf.getvalue())


async def fetch_bars(client: DeriveClient, und: str, tf: str, start: int, end: int) -> list[list]:
    """Closed bars with open time in [start, end] (seconds), as CSV rows with ms timestamps."""
    if end < start:
        return []
    step = TF_SEC[tf]
    params = {"period": step, "start_timestamp": start, "end_timestamp": end + step - 1}
    index = await client.public("get_index_chart_data", {"currency": und, **params}) or []
    try:
        traded = await client.public("get_tradingview_chart_data", {"instrument_name": f"{und}-PERP", **params}) or []
    except Exception:  # a perp without trade history still gets price bars
        log.warning("no traded candles for %s %s", und, tf)
        traded = []
    volume = {int(c["timestamp"]): float(c.get("volume_contracts") or 0) for c in traded}
    rows = []
    for c in index:
        ts = int(c["timestamp"])
        if not start <= ts <= end:
            continue
        rows.append([ts * 1000, c["open_price"], c["high_price"], c["low_price"], c["close_price"],
                     repr(volume.get(ts, 0.0))])
    rows.sort(key=lambda r: r[0])
    return rows


async def update(client: DeriveClient, cache: CandleCache, und: str, tf: str, now: float) -> int:
    """Append the closed bars missing from the cache. Returns the number added."""
    end = last_closed_open(tf, now)
    last = cache.last_ts_sec(und, tf)
    if last is not None and last >= end:
        return 0
    start = last + TF_SEC[tf] if last is not None else end - (HISTORY_BARS[tf] - 1) * TF_SEC[tf]
    rows = await fetch_bars(client, und, tf, start, end)
    cache.append(und, tf, rows)
    return len(rows)

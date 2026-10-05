"""Closed OHLCV candles per perp, from Derive, cached as CSV on the `data` branch.

Price: the spot index Derive marks and settles against (`public/get_index_chart_data`).
Volume: the perp's traded volume in contracts (`public/get_tradingview_chart_data`); 0 for a
bar with no trades. Timestamps are bar opens in milliseconds, as Reflex's engines expect.

candles/{UND}/{4h|1d|1w}.csv   timestamp,open,high,low,close,volume
candles/{UND}/{tf}.backfill.csv earlier bars from another market (derive/backfill.py), joined in front
"""
from __future__ import annotations

import csv
import io
import logging
from pathlib import Path

import numpy as np

from .client import DeriveClient, DeriveRPCError

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

    def backfill_path(self, und: str, tf: str) -> Path:
        return self.root / und / f"{tf}.backfill.csv"

    @staticmethod
    def _rows(p: Path) -> list[list[str]]:
        return list(csv.reader(p.open()))[1:] if p.exists() else []

    def volume_path(self, und: str, tf: str) -> Path:
        return self.root / und / f"{tf}.spot_volume.csv"

    def spot_volume(self, und: str, tf: str) -> tuple[dict[int, float], str | None]:
        """Spot volume kept for a thin perp, by bar open, and its source (one source per series)."""
        rows = self._rows(self.volume_path(und, tf))
        return {int(float(r[0])): float(r[1]) for r in rows}, (rows[0][2] if rows and len(rows[0]) > 2 else None)

    def write_spot_volume(self, und: str, tf: str, vols: dict[int, float], source: str) -> None:
        p = self.volume_path(und, tf)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("timestamp,volume,source\n" + "".join(f"{ts},{v},{source}\n" for ts, v in sorted(vols.items())))

    def load(self, und: str, tf: str) -> dict | None:
        """Derive's bars, preceded by any backfilled bars older than Derive's first. Where Derive's
        perp volume is thin, the whole volume series comes from one spot market instead (see signal_once)."""
        rows = self._rows(self.path(und, tf))
        if not rows:
            return None
        first = float(rows[0][0])
        early = [r for r in self._rows(self.backfill_path(und, tf)) if float(r[0]) < first]
        arr = np.array(early + rows, dtype=np.float64)
        out = {f: arr[:, i] for i, f in enumerate(FIELDS)}
        spot, _ = self.spot_volume(und, tf)
        if spot:
            out["volume"] = np.array([spot.get(int(t), 0.0) for t in out["timestamp"]], dtype=np.float64)
        return out

    def counts(self, und: str, tf: str) -> tuple[int, int]:
        """(Derive bars, backfilled bars in use)."""
        rows = self._rows(self.path(und, tf))
        if not rows:
            return 0, 0
        first = float(rows[0][0])
        return len(rows), sum(1 for r in self._rows(self.backfill_path(und, tf)) if float(r[0]) < first)

    def first_ts_ms(self, und: str, tf: str) -> int | None:
        p = self.path(und, tf)
        if not p.exists():
            return None
        with p.open() as f:
            next(f, None)
            line = next(f, None)
        return int(float(line.split(",")[0])) if line else None

    def write_backfill(self, und: str, tf: str, bars: list[list]) -> None:
        p = self.backfill_path(und, tf)
        p.parent.mkdir(parents=True, exist_ok=True)
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(FIELDS)
        w.writerows(bars)
        p.write_text(buf.getvalue())

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

    def upsert(self, und: str, tf: str, bars: list[list]) -> int:
        p = self.path(und, tf)
        rows = {int(float(r[0])): r for r in self._rows(p)}
        previous = set(rows)
        rows.update({int(r[0]): r for r in bars})
        if not bars:
            return 0
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".csv.tmp")
        with tmp.open("w", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(FIELDS)
            w.writerows(rows[t] for t in sorted(rows))
        tmp.replace(p)
        return len(set(rows) - previous)


async def fetch_bars(client: DeriveClient, und: str, tf: str, start: int, end: int) -> list[list]:
    """Closed bars with open time in [start, end] (seconds), as CSV rows with ms timestamps."""
    if end < start:
        return []
    step = TF_SEC[tf]
    params = {"period": step, "start_timestamp": start, "end_timestamp": end + step - 1}
    index = await client.public("get_index_chart_data", {"currency": und, **params})
    if not isinstance(index, list):
        raise ValueError(f"invalid index history for {und}")
    try:
        traded = await client.public("get_tradingview_chart_data", {"instrument_name": f"{und}-PERP", **params})
    except DeriveRPCError as exc:
        if exc.code != 12001:
            raise
        traded = []
    if not isinstance(traded, list):
        raise ValueError(f"invalid volume history for {und}")
    volume = {int(c["timestamp"]): float(c["volume_contracts"]) for c in traded}
    rows = []
    for c in index:
        ts = int(c["timestamp"])
        if not start <= ts <= end:
            continue
        rows.append([ts * 1000, c["open_price"], c["high_price"], c["low_price"], c["close_price"],
                     repr(volume.get(ts, 0.0))])
    rows.sort(key=lambda r: r[0])
    if len({r[0] for r in rows}) != len(rows):
        raise ValueError(f"duplicate candles for {und} {tf}")
    for r in rows:
        values = np.asarray(r[1:], dtype=float)
        if not np.isfinite(values).all() or min(values[:4]) <= 0 or values[4] < 0:
            raise ValueError(f"invalid candle for {und} {tf}")
        if values[1] < max(values[0], values[3]) or values[2] > min(values[0], values[3]):
            raise ValueError(f"invalid OHLC for {und} {tf}")
    return rows


async def update(client: DeriveClient, cache: CandleCache, und: str, tf: str, now: float) -> int:
    """Merge closed bars and repair gaps in the engine window. Returns the number added."""
    end = last_closed_open(tf, now)
    last = cache.last_ts_sec(und, tf)
    step = TF_SEC[tf]
    times = sorted(int(float(r[0])) // 1000 for r in cache._rows(cache.path(und, tf)))
    cutoff = end - (HISTORY_BARS[tf] - 1) * step
    gaps = [a + step for a, b in zip(times, times[1:]) if b - a > step and b >= cutoff]
    if last is not None and last >= end and not gaps:
        return 0
    start = max(cutoff, min(gaps)) if gaps else last - step if last is not None else cutoff
    rows = await fetch_bars(client, und, tf, start, end)
    return cache.upsert(und, tf, rows)

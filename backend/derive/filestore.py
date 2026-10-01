"""Plain-file storage for the scheduled recorder (GitHub Actions commits these to the `data` branch).

Layout under the root, per source and underlying, one file per UTC day so each commit stays small:

{source}/{UND}/features/YYYY-MM-DD.csv    ts,feature,value                 every snapshot
{source}/{UND}/expiries/YYYY-MM-DD.csv    ts + store.SLICE_COLS            every snapshot
{source}/{UND}/chains/YYYY-MM-DD/HH.json.gz  raw option chain and perp ticker, hourly
{source}/{UND}/latest.json                newest features and term structure (same shape as /api/surface)
runs/YYYY-MM-DD.csv                       slot,fetched_at,key,ok,secs,error  one row per attempt
status.json                               last result per source:underlying

Snapshots are labelled with their 15-minute slot; `runs` keeps the real fetch time.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .features import ExpirySlice
from .store import SLICE_COLS


def _day(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def _hour(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%H")


def _append_csv(path: Path, header: list[str], rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if new:
        w.writerow(header)
    w.writerows(rows)
    with open(path, "a", encoding="utf-8") as f:
        f.write(buf.getvalue())


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=True))
    tmp.replace(path)


class FileStore:
    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _dir(self, source: str, underlying: str) -> Path:
        return self.root / source / underlying

    def write_snapshot(self, ts: int, source: str, underlying: str, features: dict[str, float],
                       slices: list[ExpirySlice], chain: dict | None = None) -> None:
        d, day = self._dir(source, underlying), _day(ts)
        _append_csv(d / "features" / f"{day}.csv", ["ts", "feature", "value"],
                    [[ts, k, repr(float(v))] for k, v in sorted(features.items())])
        rows = [asdict(s) for s in slices]
        _append_csv(d / "expiries" / f"{day}.csv", ["ts", *SLICE_COLS],
                    [[ts, *[r[k] for k in SLICE_COLS]] for r in rows])
        if chain is not None:
            p = d / "chains" / day / f"{_hour(ts)}.json.gz"
            p.parent.mkdir(parents=True, exist_ok=True)
            # mtime=0 keeps the bytes reproducible.
            p.write_bytes(gzip.compress(json.dumps(chain, separators=(",", ":")).encode(), mtime=0))
        _write_json(d / "latest.json", {"ts": ts, "source": source, "underlying": underlying,
                                        "features": features,
                                        "expiries": sorted(({k: r[k] for k in SLICE_COLS} for r in rows),
                                                           key=lambda r: r["expiry"])})

    def prune_chains(self, before_ts: int) -> int:
        """Old chains stay in git history anyway; retention is not applied to files."""
        return 0

    # -- run bookkeeping ----------------------------------------------------
    def load_status(self) -> dict:
        p = self.root / "status.json"
        return json.loads(p.read_text()) if p.exists() else {}

    def record_runs(self, slot: int, status: dict[str, dict]) -> None:
        now = int(time.time())
        _append_csv(self.root / "runs" / f"{_day(slot)}.csv", ["slot", "fetched_at", "key", "ok", "secs", "error"],
                    [[slot, now, k, int(v.get("ok", False)), v.get("secs", ""), v.get("error", "")]
                     for k, v in sorted(status.items())])
        merged = self.load_status()
        merged.update({k: {**v, "fetched_at": now} for k, v in status.items()})
        _write_json(self.root / "status.json", merged)

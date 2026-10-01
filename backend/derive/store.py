"""SQLite storage. Three tables:

features      narrow (ts, source, underlying, feature, value): every snapshot
expiry_slices one row per live expiry per snapshot: the term structure and skew
chains        gzip JSON of the raw option chain, hourly, so features can be recomputed
"""
from __future__ import annotations

import gzip
import json
import sqlite3
import threading
from dataclasses import asdict
from pathlib import Path

from .features import ExpirySlice

SCHEMA = """
CREATE TABLE IF NOT EXISTS features (
    ts INTEGER NOT NULL, source TEXT NOT NULL, underlying TEXT NOT NULL,
    feature TEXT NOT NULL, value REAL NOT NULL,
    PRIMARY KEY (source, underlying, feature, ts)
);
CREATE TABLE IF NOT EXISTS expiry_slices (
    ts INTEGER NOT NULL, source TEXT NOT NULL, underlying TEXT NOT NULL, expiry INTEGER NOT NULL,
    tenor_days REAL, forward REAL, atm_iv REAL, iv_c25 REAL, iv_p25 REAL, rr25 REAL, bf25 REAL,
    call_oi REAL, put_oi REAL, n_options INTEGER,
    PRIMARY KEY (source, underlying, ts, expiry)
);
CREATE TABLE IF NOT EXISTS chains (
    ts INTEGER NOT NULL, source TEXT NOT NULL, underlying TEXT NOT NULL, gz BLOB NOT NULL,
    PRIMARY KEY (source, underlying, ts)
);
"""

SLICE_COLS = ["expiry", "tenor_days", "forward", "atm_iv", "iv_c25", "iv_p25", "rr25", "bf25",
              "call_oi", "put_oi", "n_options"]


class Store:
    def __init__(self, path: Path | str):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        self._db.close()

    def write_snapshot(self, ts: int, source: str, underlying: str, features: dict[str, float],
                       slices: list[ExpirySlice], chain: dict | None = None) -> None:
        with self._lock:
            c = self._db
            c.execute("BEGIN")
            try:
                c.executemany("INSERT OR REPLACE INTO features VALUES (?,?,?,?,?)",
                              [(ts, source, underlying, k, float(v)) for k, v in features.items()])
                c.executemany(
                    f"INSERT OR REPLACE INTO expiry_slices VALUES (?,?,?,{','.join('?' * len(SLICE_COLS))})",
                    [(ts, source, underlying, *[asdict(s)[k] for k in SLICE_COLS]) for s in slices])
                if chain is not None:
                    gz = gzip.compress(json.dumps(chain, separators=(",", ":")).encode())
                    c.execute("INSERT OR REPLACE INTO chains VALUES (?,?,?,?)", (ts, source, underlying, gz))
                c.execute("COMMIT")
            except Exception:
                c.execute("ROLLBACK")
                raise

    def prune_chains(self, before_ts: int) -> int:
        with self._lock:
            return self._db.execute("DELETE FROM chains WHERE ts < ?", (before_ts,)).rowcount

    def latest_ts(self, source: str, underlying: str) -> int | None:
        with self._lock:
            row = self._db.execute("SELECT MAX(ts) FROM features WHERE source=? AND underlying=?",
                                   (source, underlying)).fetchone()
        return row[0] if row else None

    def features_at(self, ts: int, source: str, underlying: str) -> dict[str, float]:
        with self._lock:
            rows = self._db.execute("SELECT feature, value FROM features WHERE ts=? AND source=? AND underlying=?",
                                    (ts, source, underlying)).fetchall()
        return dict(rows)

    def slices_at(self, ts: int, source: str, underlying: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                f"SELECT {','.join(SLICE_COLS)} FROM expiry_slices WHERE ts=? AND source=? AND underlying=? ORDER BY expiry",
                (ts, source, underlying)).fetchall()
        return [dict(zip(SLICE_COLS, r)) for r in rows]

    def feature_series(self, source: str, underlying: str, feature: str, start: int, end: int) -> list[tuple[int, float]]:
        with self._lock:
            return self._db.execute(
                "SELECT ts, value FROM features WHERE source=? AND underlying=? AND feature=? AND ts BETWEEN ? AND ? ORDER BY ts",
                (source, underlying, feature, start, end)).fetchall()

    def counts(self) -> dict[str, int]:
        with self._lock:
            return {t: self._db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                    for t in ("features", "expiry_slices", "chains")}

    def chain_bytes(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COALESCE(SUM(LENGTH(gz)),0) FROM chains").fetchone()[0]

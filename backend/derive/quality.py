"""Shared publication gates. Unknown data never stands in for a neutral reading."""
from __future__ import annotations

import math

ANALYTICS_VERSION = 2
OPTION_MAX_AGE = 1800  # feature/chain snapshots are published every 15 minutes
TF_SECONDS = {"4h": 14400, "1d": 86400}


def number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def snapshot_status(observed, now, max_age=OPTION_MAX_AGE):
    observed = number(observed)
    if observed is None:
        return "missing"
    age = now - observed
    return "future" if age < 0 else "stale" if age > max_age else "ready"


def engine_status(row, now=None):
    if not row:
        return "missing"
    if row.get("signal_status") != "ready" or row.get("engine_errors"):
        return "unavailable"
    if row.get("data_status") != "ready":
        return row.get("data_status") or "unknown"
    if now is not None:
        status = snapshot_status(row.get("signal_bar_close_time"), now,
                                 TF_SECONDS.get(row.get("timeframe"), 14400) + 1200)
        if status != "ready":
            return status
    return "ready"

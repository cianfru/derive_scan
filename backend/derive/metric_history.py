"""Causal price-engine history, independent of recorded trading decisions.

Replay the same pure per-symbol engines used by the recorder on cached candles
as they stood at each completed bar. This cannot recover a final signal: funding,
OI, market context and decision state were not recorded before recording began.
Only the replay cache is written; candles and live decision state are untouched.
"""
from __future__ import annotations

from collections import Counter
from functools import lru_cache
import hashlib
import json
import logging
from pathlib import Path
import time

import numpy as np

from .candles import CandleCache, TF_SEC
from .quality import ANALYTICS_VERSION, number
from .signals import process_symbol

# Imported after signals has put the pinned engines on the path.
from candle_snapshot import closed_candles, snapshot_key  # noqa: E402
from engines.larsson_engine import READY_BARS  # noqa: E402
from engines.rcce_engine import LEN_LONG, LEN_REGRESSION  # noqa: E402

log = logging.getLogger(__name__)
CACHE_VERSION = 1
HISTORY_DAYS = {"1d": 120, "4h": 30}
MAX_SAMPLES = {"1d": 120, "4h": 180}


@lru_cache(maxsize=1)
def _version() -> str:
    """Code changes invalidate the replay without touching live state."""
    root = Path(__file__).resolve().parent.parent
    paths = [Path(__file__), root / "derive/signals.py", root / "reflex/candle_snapshot.py",
             *sorted((root / "reflex/engines").glob("*.py"))]
    digest = hashlib.blake2b(digest_size=16)
    digest.update(f"{CACHE_VERSION}:{ANALYTICS_VERSION}".encode())
    for path in paths:
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def _source_metadata(cache: CandleCache) -> dict:
    return _read_json(cache.root.parent / "signals/status.json").get("backfill") or {}


def _provenance(cache: CandleCache, und: str, tf: str, data: dict | None, metadata: dict) -> dict:
    count = len(data["timestamp"]) if data is not None else 0
    first_native = cache.first_ts_ms(und, tf)
    early = int(np.count_nonzero(data["timestamp"] < first_native)) if count and first_native is not None else 0
    provider = metadata.get(f"{und}:{tf}") or {}
    sources = provider.get("sources") or ([provider["source"]] if provider.get("source") else [])
    return {"underlying": und, "timeframe": tf, "history_bars": count,
            "derive_bars": count - early, "backfilled_bars": early,
            "price_sources": (["derive index"] if count > early else []) +
                             (list(sources) or ["external spot (provider not recorded)"] if early else []),
            "backfill_price_only": bool(early), "volume_source": "derive perp trades" if count > early else None}


def _empty_row(ts: int) -> dict:
    return {"ts": ts, "regime": None, "signal": None, "unified_signal": None,
            "zscore": None, "heat": None, "heat_phase": None, "ribbon": None,
            "funding_ann": None, "oi_usd": None, "source": "reconstructed"}


def _metric_row(result: dict, ts: int) -> dict:
    errors = list(result.get("engine_errors") or [])
    status = result.get("data_status") or "unavailable"
    rcce_status = "unavailable" if "RCCE" in errors else status
    heat_status = "ready" if result.get("bmsb_valid") and "Heatmap" not in errors else "unavailable"
    ribbon = result.get("ribbon") or {}
    ribbon_status = ribbon.get("data_quality") or "unavailable"
    row = _empty_row(ts)
    if rcce_status == "ready":
        row.update(regime=result.get("regime"), zscore=number(result.get("zscore")))
    if heat_status == "ready":
        row.update(heat=number(result.get("heat")), heat_phase=result.get("heat_phase"))
    if ribbon_status == "ready" and ribbon.get("state") in ("gold", "blue", "grey"):
        row["ribbon"] = ribbon.get("state")
    elif ribbon_status == "ready":
        ribbon_status = "unavailable"
    if rcce_status == "ready" and (row["zscore"] is None or row["regime"] is None):
        rcce_status = "unavailable"
        row.update(regime=None, zscore=None)
    if heat_status == "ready" and row["heat"] is None:
        heat_status = "unavailable"
        row["heat_phase"] = None
    row.update(status=status, metric_status={"zscore": rcce_status, "regime": rcce_status,
                                            "heat": heat_status, "ribbon": ribbon_status},
               history_bars=result.get("history_bars"), normalization_ready=result.get("normalization_ready", False),
               errors=errors)
    return row


def _recorded_times(rows) -> set[int]:
    out = set()
    for row in rows:
        raw = row.get("ts", row.get("bar_close")) if isinstance(row, dict) else row[0] if row else None
        value = number(raw)
        if value is not None:
            out.add(int(value))
    return out


def build_engine_history(cache: CandleCache, und: str, tf: str, now: float, *,
                         recorded_rows=(), days: int | None = None,
                         max_samples: int | None = None) -> dict:
    """Return price metrics and coverage; recorded close times are never replayed.

    Defaults to 120 daily bars and 180 four-hour bars (30 days). Each cached row
    has a hash of its causal candle inputs, including reference markets and source
    metadata. Appending future bars reuses history; revising old inputs recomputes
    affected rows. The cache remains bounded to the requested history window.
    """
    if tf not in HISTORY_DAYS:
        raise ValueError("Price metric history supports 1d and 4h")
    days = HISTORY_DAYS[tf] if days is None else max(0, int(days))
    max_samples = MAX_SAMPLES[tf] if max_samples is None else min(MAX_SAMPLES[tf], max(0, int(max_samples)))
    started = time.perf_counter()
    requested_from = int(now - days * 86_400)
    data = cache.load(und, tf)
    coverage = {"requested_from": requested_from, "requested_to": int(now), "from": None, "to": None,
                "samples": 0, "status_counts": {}, "metric_counts": {},
                "requirements": {"regime_zscore_bars": LEN_LONG + LEN_REGRESSION - 1,
                                 "ribbon_bars": READY_BARS, "heat_weekly_bars": 21},
                "notes": ["Price metrics use cached completed candles at each historical bar close.",
                          "Final signals, funding and open interest require recorded observations."]}
    if data is None or not max_samples:
        coverage["reason"] = "No cached candles" if data is None else "History window is empty"
        return {"rows": [], "coverage": coverage, "cache": {"computed": 0, "reused": 0, "seconds": 0}}

    closed = closed_candles(data, tf, now * 1000)
    closes = (np.asarray(closed["timestamp"]) / 1000 + TF_SEC[tf]).astype(np.int64)
    times = [int(ts) for ts in closes if ts >= requested_from][-max_samples:]
    coverage["available_samples"] = len(times)
    if times:
        coverage.update(available_from=times[0], available_to=times[-1])
    recorded = _recorded_times(recorded_rows)
    weekly = cache.load(und, "1w")
    btc = data if und == "BTC" else cache.load("BTC", tf)
    eth = data if und == "ETH" else cache.load("ETH", tf)
    metadata = _source_metadata(cache)
    path = cache.root.parent / "metric_history" / und / f"{tf}.json"
    previous = _read_json(path)
    version = _version()
    cached = {int(r["ts"]): r for r in previous.get("rows", []) if isinstance(r, dict) and number(r.get("ts")) is not None} \
        if previous.get("version") == version else {}
    rows, computed, reused = [], 0, 0
    for ts in times:
        if ts in recorded:
            continue
        cutoff = ts * 1000
        # The full prefix matters for the ribbon's EMAs. process_symbol applies
        # its own 599/199-bar engine windows after this causal truncation.
        o = closed_candles(closed, tf, cutoff)
        w = closed_candles(weekly, "1w", cutoff)
        b = closed_candles(btc, tf, cutoff)
        e = closed_candles(eth, tf, cutoff)
        provenance = {"price": _provenance(cache, und, tf, o, metadata),
                      "weekly": _provenance(cache, und, "1w", w, metadata),
                      "btc": _provenance(cache, "BTC", tf, b, metadata),
                      "eth": _provenance(cache, "ETH", tf, e, metadata),
                      "as_of": ts, "method": "completed-bar price engine replay"}
        digest = hashlib.blake2b(digest_size=16)
        digest.update(snapshot_key(o, tf, w, b, e, as_of_ms=cutoff).encode())
        digest.update(json.dumps(provenance, sort_keys=True, separators=(",", ":")).encode())
        input_id = digest.hexdigest()
        if cached.get(ts, {}).get("input_id") == input_id:
            rows.append(cached[ts])
            reused += 1
            continue
        try:
            row = _metric_row(process_symbol(und, tf, o, w, b, e, cutoff), ts)
        except Exception:
            log.exception("Price history unavailable for %s %s at %s", und, tf, ts)
            row = dict(_empty_row(ts), status="unavailable", errors=["Price engine replay failed"],
                       metric_status={key: "unavailable" for key in ("regime", "zscore", "heat", "ribbon")})
        row.update(input_id=input_id, provenance=provenance)
        rows.append(row)
        computed += 1

    doc = {"version": version, "rows": rows}
    if doc != previous:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False))
        temporary.replace(path)
    coverage.update(samples=len(rows), status_counts=dict(Counter(r["status"] for r in rows)),
                    metric_counts={key: sum(r.get(key) is not None for r in rows) for key in ("regime", "zscore", "heat", "ribbon")})
    if rows:
        coverage.update({"from": rows[0]["ts"], "to": rows[-1]["ts"]})
    return {"rows": rows, "coverage": coverage,
            "cache": {"computed": computed, "reused": reused, "seconds": round(time.perf_counter() - started, 3)}}

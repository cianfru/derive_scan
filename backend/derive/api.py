"""Read-only HTTP API over the recorded data."""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, Request

from . import egress

router = APIRouter(prefix="/api")

MAX_RANGE_SEC = 400 * 86400


def _ctx(request: Request):
    return request.app.state.settings, request.app.state.store


def _source(settings, source: str | None) -> str:
    src = source or settings.sources[0]
    if src not in settings.sources:
        raise HTTPException(404, f"source not recorded: {src}")
    return src


@router.get("/status")
def status(request: Request):
    settings, store = _ctx(request)
    rec = getattr(request.app.state, "recorder", None)
    return {
        "sources": settings.sources, "underlyings": settings.underlyings,
        "interval_sec": settings.interval_sec, "rows": store.counts(), "chain_bytes": store.chain_bytes(),
        "db_bytes": store.file_bytes(), "egress": egress.snapshot(),
        "last": rec.status if rec else {},
        "api_calls": {s: {"calls": c.calls, "errors": c.errors} for s, c in rec.clients.items()} if rec else {},
    }


@router.get("/surface/{underlying}")
def surface(request: Request, underlying: str, source: str | None = None):
    settings, store = _ctx(request)
    src, und = _source(settings, source), underlying.upper()
    ts = store.latest_ts(src, und)
    if ts is None:
        raise HTTPException(404, "no data yet")
    # The recorder keeps the last good snapshot; stale says the newest one is overdue.
    stale = time.time() - ts > 3 * settings.interval_sec
    return {"ts": ts, "as_of": ts, "stale": stale, "source": src, "underlying": und,
            "features": store.features_at(ts, src, und), "expiries": store.slices_at(ts, src, und)}


@router.get("/features/{underlying}")
def features(request: Request, underlying: str, feature: str = "atm_iv_30d", source: str | None = None,
             start: int | None = Query(None, alias="from"), end: int | None = Query(None, alias="to")):
    settings, store = _ctx(request)
    src, und = _source(settings, source), underlying.upper()
    end = int(time.time()) if end is None else end
    start = end - 30 * 86400 if start is None else start
    if end - start > MAX_RANGE_SEC:
        raise HTTPException(400, "range longer than 400 days")
    return {"source": src, "underlying": und, "feature": feature,
            "points": store.feature_series(src, und, feature, start, end)}

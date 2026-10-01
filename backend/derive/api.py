"""Read-only HTTP API over the recorded data."""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/api")


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
    return {"ts": ts, "source": src, "underlying": und,
            "features": store.features_at(ts, src, und), "expiries": store.slices_at(ts, src, und)}


@router.get("/features/{underlying}")
def features(request: Request, underlying: str, feature: str = "atm_iv_30d", source: str | None = None,
             start: int | None = Query(None, alias="from"), end: int | None = Query(None, alias="to")):
    settings, store = _ctx(request)
    src, und = _source(settings, source), underlying.upper()
    end = end or int(time.time())
    start = start or end - 30 * 86400
    return {"source": src, "underlying": und, "feature": feature,
            "points": store.feature_series(src, und, feature, start, end)}

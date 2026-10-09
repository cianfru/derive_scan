"""Cowboy's live service (Railway): Saloon prices from Derive's WebSocket, served to every visitor.

One connection to Derive reads the live tickers of every instrument the published boards use; the
boards are re-priced every few seconds and served at the same paths the app reads
(questions/index.json, questions/{UND}.json), behind short cache headers, so visitors never read
Derive themselves. The published files (the 15-minute feed) stay the source of what exists, and of
the trading switches and their lease; while the connection is down or its prices are old, the
published files are served unchanged.

Run: python -m live.server   (PORT, DERIVE_WS_URL, SITE_DATA_URL from the environment)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time

import httpx
import uvicorn
import websockets
from fastapi import FastAPI, Request, Response
from fastapi.middleware.gzip import GZipMiddleware

from live.reprice import board_names, index_doc, index_of, reprice

log = logging.getLogger("live")

WS_URL = os.environ.get("DERIVE_WS_URL", "wss://api.derive.xyz/v3/ws")
SITE_URL = os.environ.get("SITE_DATA_URL", "https://raw.githubusercontent.com/cianfru/cowboy-feed/site-data/").rstrip("/") + "/"
POLL_SEC = 60          # published boards re-read (with ETag)
REPRICE_SEC = 2        # live boards rebuilt
STALE_SEC = 60         # no ticker newer than this: serve the published file
INTERVAL_MS = 1000     # Derive's ticker_slim cadence
BATCH = 100            # channels per subscribe request
CACHE = "public, max-age=2, s-maxage=2, stale-while-revalidate=30"
BOARD_PATH = re.compile(r"^questions/([A-Z0-9]+)\.json$")


class State:
    def __init__(self) -> None:
        self.published: dict[str, dict] = {}   # path -> published doc
        self.etags: dict[str, str] = {}        # path -> upstream ETag
        self.tickers: dict[str, dict] = {}     # instrument -> latest ticker (with "t")
        self.wanted: set[str] = set()
        self.subscribed: set[str] = set()
        self.served: dict[str, tuple[bytes, str]] = {}  # path -> (body, etag)
        self.last_msg = 0.0
        self.connected = False
        self.ws = None


S = State()


def _body(doc: dict) -> tuple[bytes, str]:
    body = json.dumps(doc, separators=(",", ":")).encode()
    return body, '"' + hashlib.sha1(body).hexdigest()[:20] + '"'


async def poll_published(client: httpx.AsyncClient) -> None:
    """Re-read questions/index.json and each listed coin's board, only when they changed."""
    async def get(path: str) -> dict | None:
        headers = {"If-None-Match": S.etags[path]} if path in S.etags else {}
        r = await client.get(SITE_URL + path, headers=headers)
        if r.status_code == 304:
            return S.published.get(path)
        r.raise_for_status()
        if r.headers.get("etag"):
            S.etags[path] = r.headers["etag"]
        doc = r.json()
        S.published[path] = doc
        return doc

    index = await get("questions/index.json")
    paths = {"questions/index.json"}
    for c in (index or {}).get("coins") or []:
        path = f"questions/{c['und']}.json"
        paths.add(path)
        await get(path)
    for gone in set(S.published) - paths:
        S.published.pop(gone, None)
        S.served.pop(gone, None)
    S.wanted = set().union(*(board_names(d) for p, d in S.published.items() if BOARD_PATH.match(p)))


async def poller() -> None:
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "cowboy-live/1"}) as client:
        while True:
            try:
                await poll_published(client)
            except Exception as e:  # keep the last good copy
                log.warning("published read failed: %s", e)
            await asyncio.sleep(POLL_SEC)


async def _subscribe(ws, method: str, names: list[str]) -> None:
    for i in range(0, len(names), BATCH):
        chans = [f"ticker_slim.{n}.{INTERVAL_MS}" for n in names[i:i + BATCH]]
        await ws.send(json.dumps({"id": int(time.time() * 1000) + i, "method": method, "params": {"channels": chans}}))


async def sync_subscriptions() -> None:
    ws = S.ws
    if ws is None:
        return
    add, drop = sorted(S.wanted - S.subscribed), sorted(S.subscribed - S.wanted)
    if add:
        await _subscribe(ws, "subscribe", add)
    if drop:
        await _subscribe(ws, "unsubscribe", drop)
        for n in drop:
            S.tickers.pop(n, None)
    S.subscribed = set(S.wanted)


async def derive_feed() -> None:
    """One connection to Derive; reconnects with backoff, resubscribes everything."""
    backoff = 1
    while True:
        try:
            async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=20, max_size=2**23) as ws:
                S.ws, S.connected, S.subscribed, backoff = ws, True, set(), 1
                log.info("connected to %s", WS_URL)
                await sync_subscriptions()
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("method") != "subscription":
                        continue
                    p = msg.get("params") or {}
                    chan = str(p.get("channel", ""))
                    if not chan.startswith("ticker_slim."):
                        continue
                    name = chan[len("ticker_slim."):].rsplit(".", 1)[0]
                    t = (p.get("data") or {}).get("instrument_ticker")
                    if t:
                        S.tickers[name] = t
                        S.last_msg = time.time()
        except Exception as e:
            log.warning("derive connection ended: %s", e)
        S.ws, S.connected = None, False
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 30)


def live_ok(now: float) -> bool:
    return S.connected and now - S.last_msg < STALE_SEC


def rebuild(now: float) -> None:
    fresh = {n: t for n, t in S.tickers.items() if now * 1000 - (t.get("t") or 0) < STALE_SEC * 1000}
    boards: dict[str, dict] = {}
    for path, doc in S.published.items():
        m = BOARD_PATH.match(path)
        if not m:
            continue
        und = m.group(1)
        board = reprice(doc, fresh, index_of(und, fresh), int(now)) if live_ok(now) else doc
        boards[und] = board
        S.served[path] = _body(board)
    idx = S.published.get("questions/index.json")
    if idx is not None:
        S.served["questions/index.json"] = _body(index_doc(idx, boards, int(now)) if live_ok(now) else idx)


async def repricer() -> None:
    while True:
        try:
            await sync_subscriptions()
            rebuild(time.time())
        except Exception as e:
            log.exception("reprice failed: %s", e)
        await asyncio.sleep(REPRICE_SEC)


app = FastAPI(title="Cowboy live")
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.on_event("startup")
async def _start() -> None:
    for job in (poller, derive_feed, repricer):
        asyncio.create_task(job())


@app.get("/health")
def health() -> dict:
    now = time.time()
    return {"connected": S.connected, "live": live_ok(now), "last_tick_age_s": round(now - S.last_msg, 1) if S.last_msg else None,
            "instruments": len(S.subscribed), "files": sorted(S.served)}


@app.get("/questions/{name}")
def questions(name: str, request: Request) -> Response:
    hit = S.served.get(f"questions/{name}")
    headers = {"Access-Control-Allow-Origin": "*", "Cache-Control": CACHE}
    if hit is None:
        return Response(status_code=404, headers=headers)
    body, etag = hit
    headers["ETag"] = etag
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_level="info")

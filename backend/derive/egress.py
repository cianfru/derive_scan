"""Network egress: conditional GETs (ETag / 304) and a per-route byte counter.

Railway bills data sent from the server (pattern taken from Reflex's backend/egress.py):

* ``ConditionalGetMiddleware`` gives JSON GET responses under /api/ a strong ETag and
  answers If-None-Match with an empty 304 when the body has not changed. Responses carry
  ``Cache-Control: no-cache``, so browsers keep the body and revalidate on every fetch.
  Add it before GZipMiddleware so it sees the plain body.
* ``EgressCounterMiddleware`` counts bytes sent per route (headers and body after gzip).
  Add it last, so it is the outermost middleware.

``snapshot()`` feeds /api/status.
"""
from __future__ import annotations

import hashlib
import threading
import time
from typing import Optional


def etag_for(body: bytes) -> str:
    return '"' + hashlib.blake2b(body, digest_size=12).hexdigest() + '"'


def etag_matches(if_none_match: Optional[str], etag: str) -> bool:
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    bare = etag.removeprefix("W/")
    return any(t.strip().removeprefix("W/") == bare for t in if_none_match.split(","))


def _header(headers, name: bytes) -> Optional[str]:
    for k, v in headers:
        if k.lower() == name:
            return v.decode("latin-1")
    return None


class ConditionalGetMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http" or scope.get("method") != "GET" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return
        if_none_match = _header(scope.get("headers") or [], b"if-none-match")
        start: Optional[dict] = None
        chunks: list = []
        passthrough = False

        async def send_wrapper(message) -> None:
            nonlocal start, passthrough
            if passthrough:
                await send(message)
                return
            if message["type"] == "http.response.start":
                ctype = (_header(message.get("headers") or [], b"content-type") or "").lower()
                if message.get("status") != 200 or not ctype.startswith("application/json"):
                    passthrough = True
                    await send(message)
                    return
                start = message
                return
            if message["type"] != "http.response.body" or start is None:
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body", False):
                return
            body = b"".join(chunks)
            headers = list(start.get("headers") or [])
            etag = _header(headers, b"etag") or etag_for(body)
            if _header(headers, b"etag") is None:
                headers.append((b"etag", etag.encode("latin-1")))
            if _header(headers, b"cache-control") is None:
                headers.append((b"cache-control", b"no-cache"))
            if etag_matches(if_none_match, etag):
                keep = {b"etag", b"cache-control", b"vary"}
                await send({"type": "http.response.start", "status": 304,
                            "headers": [(k, v) for k, v in headers if k.lower() in keep]})
                await send({"type": "http.response.body", "body": b""})
                return
            headers = [(k, v) for k, v in headers if k.lower() != b"content-length"]
            headers.append((b"content-length", str(len(body)).encode()))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, send_wrapper)


_lock = threading.Lock()
_routes: dict[str, dict[str, int]] = {}
_since = time.time()


def _route_key(path: str) -> str:
    """Group per-coin paths: /api/surface/eth -> /api/surface/{underlying}."""
    parts = path.rstrip("/").split("/")
    if len(parts) == 4 and parts[1] == "api" and parts[2] in ("surface", "features"):
        return f"/api/{parts[2]}/{{underlying}}"
    return path if path.startswith("/api/") or path == "/health" else "other"


def record(key: str, sent: int, not_modified: bool) -> None:
    with _lock:
        r = _routes.setdefault(key, {"requests": 0, "bytes": 0, "not_modified": 0})
        r["requests"] += 1
        r["bytes"] += sent
        r["not_modified"] += int(not_modified)


def snapshot() -> dict:
    with _lock:
        routes = {k: dict(v) for k, v in _routes.items()}
    return {"since": int(_since), "total_bytes": sum(r["bytes"] for r in routes.values()), "routes": routes}


class EgressCounterMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        sent = 0
        status = 0

        async def counting_send(message) -> None:
            nonlocal sent, status
            if message["type"] == "http.response.start":
                status = message.get("status", 0)
                sent += sum(len(k) + len(v) + 4 for k, v in message.get("headers") or [])
            elif message["type"] == "http.response.body":
                sent += len(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive, counting_send)
        finally:
            record(_route_key(scope.get("path", "")), sent, status == 304)

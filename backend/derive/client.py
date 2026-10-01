"""Minimal async JSON-RPC client for Derive's public HTTP API.

derive-py covers signing and trading; the recorder only needs public reads, so a
thin httpx client keeps the dependency list short. Trading (Phase 2) should
re-evaluate derive-py for EIP-712 signing.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

# JSON-RPC codes that mean "nothing happened, try again shortly" (docs: /error-codes.md).
RETRYABLE_RPC_CODES = {-32000, 9002}
RETRYABLE_HTTP = {429, 500, 502, 503, 504}


class DeriveRPCError(Exception):
    def __init__(self, method: str, code: int | None, message: str, data: Any = None):
        super().__init__(f"{method}: {code} {message} {data or ''}".strip())
        self.method, self.code, self.message, self.data = method, code, message, data


class DeriveClient:
    def __init__(self, base: str, *, timeout: float = 20.0, retries: int = 4,
                 backoff: float = 1.0, transport: httpx.AsyncBaseTransport | None = None):
        self.base = base if base.endswith("/") else base + "/"
        self.retries = retries
        self.backoff = backoff
        self.calls = 0
        self.errors = 0
        # The V2 API refuses some default library user agents.
        self._http = httpx.AsyncClient(
            timeout=timeout, transport=transport,
            headers={"content-type": "application/json", "user-agent": "derive-scan/0.1"},
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def public(self, method: str, params: dict | None = None) -> Any:
        return await self._call(f"public/{method}", params or {})

    async def _call(self, method: str, params: dict) -> Any:
        attempt = 0
        while True:
            attempt += 1
            self.calls += 1
            retry_reason = None
            try:
                r = await self._http.post(self.base + method, json=params)
                if r.status_code in RETRYABLE_HTTP:
                    retry_reason = f"http {r.status_code}"
                else:
                    body = r.json()
                    err = body.get("error")
                    if err is None:
                        return body["result"]
                    code = err.get("code")
                    if code not in RETRYABLE_RPC_CODES:
                        self.errors += 1
                        raise DeriveRPCError(method, code, err.get("message", ""), err.get("data"))
                    retry_reason = f"rpc {code}"
            except (httpx.TransportError, ValueError) as e:
                retry_reason = type(e).__name__
            self.errors += 1
            if attempt > self.retries:
                raise DeriveRPCError(method, None, f"gave up after {attempt} attempts ({retry_reason})")
            delay = self.backoff * 2 ** (attempt - 1)
            log.warning("derive %s retry %d in %.1fs (%s)", method, attempt, delay, retry_reason)
            await asyncio.sleep(delay)

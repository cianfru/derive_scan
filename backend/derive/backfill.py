"""Earlier price history for perps whose Derive index starts recently.

Derive's index begins when Derive lists a coin; most coins traded elsewhere long before.
For the period before the first Derive bar, closed bars come from OKX's public spot candles
(the coin against USDT; bars aligned to UTC, as Derive's). Price only: volume is set to 0 so
the volume-based checks read only Derive's own trades. Stored separately and joined in front
of Derive's bars by CandleCache.load:

candles/{UND}/{tf}.backfill.csv   timestamp,open,high,low,close,volume
"""
from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)

OKX_URL = "https://www.okx.com/api/v5/market/history-candles"
OKX_BAR = {"4h": "4H", "1d": "1Dutc", "1w": "1Wutc"}
PAGE = 100
# Enough for Reflex's full warm-up (about 600 bars; 200 weekly).
TARGET_BARS = {"4h": 700, "1d": 700, "1w": 220}


async def okx_before(und: str, tf: str, before_ms: int, bars: int,
                     transport: httpx.AsyncBaseTransport | None = None) -> list[list]:
    """Up to `bars` confirmed bars opening before `before_ms`, oldest first."""
    rows: list[list] = []
    after = before_ms
    async with httpx.AsyncClient(timeout=20, transport=transport, headers={"user-agent": "derive-scan/0.1"}) as http:
        while len(rows) < bars:
            r = await http.get(OKX_URL, params={"instId": f"{und}-USDT", "bar": OKX_BAR[tf], "limit": PAGE, "after": after})
            r.raise_for_status()
            body = r.json()
            if body.get("code") != "0":
                raise RuntimeError(f"okx {und} {tf}: {body.get('msg')}")
            data = body.get("data") or []
            if not data:
                break
            for c in data:  # newest first
                if c[8] == "1":
                    rows.append([int(c[0]), c[1], c[2], c[3], c[4], "0.0"])
            after = int(data[-1][0])
            if len(data) < PAGE:
                break
    rows = sorted({r[0]: r for r in rows if r[0] < before_ms}.values(), key=lambda r: r[0])
    return rows[-bars:]

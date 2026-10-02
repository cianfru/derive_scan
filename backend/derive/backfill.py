"""Earlier price history for perps whose Derive index starts recently.

Derive's index begins when Derive lists a coin; most coins traded elsewhere long before.
For the period before the first Derive bar, closed bars come from OKX's public spot candles
(against USDT, UTC aligned), with explicitly mapped Coinbase and Hyperliquid spot products
for daily/weekly gaps. Price only: volume is set to 0 so
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


# Explicit products avoid silently merging unrelated tokens that share a ticker.
COINBASE_PRODUCTS = {"ADA": "ADA-USD", "ZEC": "ZEC-USD", "VVV": "VVV-USD"}
BACKFILL_VERSION = 2


async def supplemental_before(und, tf, before_ms, bars, transport=None):
    """Verified spot products for daily/weekly history absent from OKX.

    Never infer a product from an arbitrary ticker. Keep Derive volume separate.
    Weekly Coinbase candles require all seven UTC daily closes; gaps stay gaps.
    """
    if tf not in ("1d", "1w") or (und not in COINBASE_PRODUCTS and und != "HYPE"):
        return [], None
    day = 86_400_000
    step = day if tf == "1d" else 7 * day
    async with httpx.AsyncClient(timeout=20, transport=transport) as http:
        if und == "HYPE":
            # Official Hyperliquid spot metadata identifies HYPE/USDC as @107.
            r = await http.post("https://api.hyperliquid.xyz/info", json={"type": "candleSnapshot", "req": {
                "coin": "@107", "interval": tf, "startTime": before_ms - bars * step, "endTime": before_ms - 1}})
            r.raise_for_status()
            rows = [[int(c["t"]), c["o"], c["h"], c["l"], c["c"], "0.0"] for c in r.json()
                    if int(c["T"]) < before_ms and int(c["t"]) + step <= before_ms]
            return sorted({r[0]: r for r in rows}.values())[-bars:], "hyperliquid HYPE/USDC spot"
        end = before_ms // 1000
        start = end - bars * step // 1000
        daily = {}
        while end > start:
            begin = max(start, end - 299 * 86400)
            r = await http.get(f"https://api.exchange.coinbase.com/products/{COINBASE_PRODUCTS[und]}/candles",
                               params={"granularity": 86400, "start": begin, "end": end})
            r.raise_for_status()
            for c in r.json():
                ts = int(c[0]) * 1000
                if start * 1000 <= ts and ts + day <= before_ms:
                    daily[ts] = [ts, c[3], c[2], c[1], c[4], "0.0"]
            end = begin
        rows = sorted(daily.values())
        if tf == "1w":
            weeks = {}
            for row in rows:
                monday = (row[0] - 4 * day) // (7 * day) * (7 * day) + 4 * day
                weeks.setdefault(monday, []).append(row)
            rows = [[t, w[0][1], max(float(c[2]) for c in w), min(float(c[3]) for c in w), w[-1][4], "0.0"]
                    for t, w in sorted(weeks.items()) if len(w) == 7 and [c[0] for c in w] == [t + i * day for i in range(7)]]
        return rows[-bars:], f"coinbase {COINBASE_PRODUCTS[und]} spot"

"""Market-wide inputs for Reflex's signal synthesizer, from the same free sources Reflex uses.

Each fetch returns (value, observed_at) or (None, None) on failure; a missing input reaches
the synthesizer as missing, exactly as in Reflex. Parsing follows Reflex's market_data.py
(commit in reflex/SOURCE.md).
"""
from __future__ import annotations

import logging
import time

import httpx

log = logging.getLogger(__name__)

COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global"
FEAR_GREED_URL = "https://api.alternative.me/fng/?limit=1&format=json"
STABLECOINS_URL = "https://stablecoins.llama.fi/stablecoins?includePrices=false"
TIMEOUT = 15


def fng_label(value: int) -> str:
    if value <= 20:
        return "Extreme Fear"
    if value <= 40:
        return "Fear"
    if value <= 60:
        return "Neutral"
    if value <= 80:
        return "Greed"
    return "Extreme Greed"


def parse_global(payload: dict) -> dict | None:
    data = (payload or {}).get("data") or {}
    pct = data.get("market_cap_percentage") or {}
    total = (data.get("total_market_cap") or {}).get("usd", 0.0)
    if not total:
        return None
    btc_dom, eth_dom = pct.get("btc", 0.0), pct.get("eth", 0.0)
    btc_mcap = total * btc_dom / 100.0
    return {"btc_dominance": round(btc_dom, 2), "eth_dominance": round(eth_dom, 2),
            "total_market_cap": total, "alt_market_cap": total - btc_mcap}


def parse_fear_greed(payload: dict) -> dict | None:
    entry = ((payload or {}).get("data") or [None])[0]
    if not entry:
        return None
    value = int(entry["value"])
    return {"fear_greed_value": value, "fear_greed_label": fng_label(value)}


def trend_label(change_pct: float) -> str:
    if change_pct > 1.0:
        return "EXPANDING"
    if change_pct < -1.0:
        return "CONTRACTING"
    return "STABLE"


def parse_stablecoins(payload: dict) -> dict | None:
    """USDT + USDC supply and its 7-day change (the first, largest asset of each symbol)."""
    caps = {"USDT": [0.0, 0.0], "USDC": [0.0, 0.0]}
    for asset in (payload or {}).get("peggedAssets", []):
        sym = str(asset.get("symbol", "")).upper()
        if sym not in caps or caps[sym][0]:
            continue
        now = (asset.get("circulating") or {}).get("peggedUSD") or 0
        week = (asset.get("circulatingPrevWeek") or {}).get("peggedUSD") or 0
        caps[sym] = [float(now), float(week)]
    total = caps["USDT"][0] + caps["USDC"][0]
    prev = caps["USDT"][1] + caps["USDC"][1]
    if total <= 0:
        return None
    change_pct = round(((total - prev) / prev) * 100.0, 2) if prev > 0 else 0.0
    return {"trend": trend_label(change_pct), "change_7d_pct": change_pct, "total_cap": total}


async def _get(http: httpx.AsyncClient, url: str, parse, clock) -> tuple[dict | None, float | None]:
    try:
        r = await http.get(url)
        r.raise_for_status()
        value = parse(r.json())
        return (value, clock()) if value is not None else (None, None)
    except Exception as e:  # one missing input must not stop the signals
        log.warning("context fetch failed %s: %s", url.split("?")[0], e)
        return None, None


async def fetch_context(transport: httpx.AsyncBaseTransport | None = None, clock=time.time) -> dict:
    """{"global_metrics"|"sentiment"|"stablecoin": (value, observed_at)}"""
    async with httpx.AsyncClient(timeout=TIMEOUT, transport=transport,
                                 headers={"user-agent": "derive-scan/0.1"}) as http:
        return {"global_metrics": await _get(http, COINGECKO_GLOBAL_URL, parse_global, clock),
                "sentiment": await _get(http, FEAR_GREED_URL, parse_fear_greed, clock),
                "stablecoin": await _get(http, STABLECOINS_URL, parse_stablecoins, clock)}

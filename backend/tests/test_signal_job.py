import asyncio
import csv
import json
import math

import httpx

from derive.candles import CandleCache, last_closed_open, update
from derive.client import DeriveClient
from derive.context import parse_fear_greed, parse_global, parse_stablecoins
import signal_once

NOW = 1_790_000_000 + 4 * 3600 + 600   # 10 minutes after a 4H close
LISTED = {"BTC": NOW - 900 * 86400, "ETH": NOW - 900 * 86400, "NEW": NOW - 20 * 86400}


def _price(und, ts):
    base = {"BTC": 80000.0, "ETH": 2600.0, "NEW": 1.0}[und]
    return base * (1 + 0.2 * math.sin(ts / 3e6) + 0.05 * math.sin(ts / 2e5))


def derive_handler(request):
    method = request.url.path.rsplit("/", 1)[-1]
    p = json.loads(request.content)
    if method == "get_tickers":
        return httpx.Response(200, json={"result": {"tickers": {
            f"{u}-PERP": {"t": NOW * 1000, "M": str(_price(u, NOW)), "I": str(_price(u, NOW)), "f": "0.00001",
                          "stats": {"oi": "100", "v": "1000000"}} for u in LISTED}}})
    und = p.get("currency") or p["instrument_name"].split("-")[0]
    step, start, end = p["period"], p["start_timestamp"], p["end_timestamp"]
    first = max(start, LISTED[und]) // step * step
    if first < start:
        first += step
    bars = []
    for ts in range(first, end + 1, step):
        c = _price(und, ts + step)
        o = _price(und, ts)
        bar = {"timestamp": ts, "open_price": str(o), "high_price": str(max(o, c) * 1.01),
               "low_price": str(min(o, c) * 0.99), "close_price": str(c)}
        if method == "get_tradingview_chart_data":
            vol = 0 if und == "NEW" else 10 + (ts // step) % 7
            bar = {**bar, "volume_contracts": str(vol), "volume_usd": str(vol * c)}
        bars.append(bar)
    return httpx.Response(200, json={"result": bars})


def context_handler(request):
    host = request.url.host
    if "coingecko" in host:
        return httpx.Response(429)
    if "alternative" in host:
        return httpx.Response(200, json={"data": [{"value": "30"}]})
    return httpx.Response(200, json={"peggedAssets": [
        {"symbol": "USDT", "circulating": {"peggedUSD": 1.6e11}, "circulatingPrevWeek": {"peggedUSD": 1.5e11}},
        {"symbol": "USDC", "circulating": {"peggedUSD": 7e10}, "circulatingPrevWeek": {"peggedUSD": 7e10}}]})


def okx_handler(request):
    after = int(request.url.params["after"])
    step = {"4H": 14_400_000, "1Dutc": 86_400_000, "1Wutc": 604_800_000}[request.url.params["bar"]]
    data = [[str(after - i * step), "1", "1.1", "0.9", "1.05", "5", "5", "5", "1"] for i in range(1, 101)]
    return httpx.Response(200, json={"code": "0", "data": data})


def test_last_closed_open():
    assert last_closed_open("4h", 14_400 * 10 + 5) == 14_400 * 9
    assert last_closed_open("1d", 86_400 * 3 + 1) == 86_400 * 2
    monday = 4 * 86_400 + 7 * 86_400 * 100           # epoch + 4 days is a Monday
    assert last_closed_open("1w", monday + 3600) == monday - 7 * 86_400


async def test_candle_cache_appends_only_new_bars(tmp_path):
    client = DeriveClient("https://x/", transport=httpx.MockTransport(derive_handler), retries=0, backoff=0)
    cache = CandleCache(tmp_path)
    assert await update(client, cache, "BTC", "4h", NOW) == 700
    assert await update(client, cache, "BTC", "4h", NOW) == 0
    assert await update(client, cache, "BTC", "4h", NOW + 14_400) == 1
    data = cache.load("BTC", "4h")
    assert len(data["close"]) == 701 and (data["timestamp"][1:] - data["timestamp"][:-1] == 14_400_000).all()
    assert data["volume"].min() >= 10


def test_context_parsers():
    assert parse_fear_greed({"data": [{"value": "74"}]}) == {"fear_greed_value": 74, "fear_greed_label": "Greed"}
    g = parse_global({"data": {"market_cap_percentage": {"btc": 60, "eth": 10}, "total_market_cap": {"usd": 100.0}}})
    assert g["btc_dominance"] == 60 and g["alt_market_cap"] == 40.0
    s = parse_stablecoins({"peggedAssets": [
        {"symbol": "USDT", "circulating": {"peggedUSD": 102}, "circulatingPrevWeek": {"peggedUSD": 100}},
        {"symbol": "USDT", "circulating": {"peggedUSD": 5}}]})
    assert s["trend"] == "EXPANDING" and s["change_7d_pct"] == 2.0
    assert parse_global({}) is None and parse_fear_greed({"data": []}) is None


def test_signal_job_end_to_end(tmp_path):
    client = DeriveClient("https://x/", transport=httpx.MockTransport(derive_handler), retries=0, backoff=0)
    assert signal_once.due_timeframes(tmp_path, NOW) == ["4h", "1d"]
    summary = asyncio.run(signal_once.run(tmp_path, NOW, ["4h", "1d"], client=client,
                                          context_transport=httpx.MockTransport(context_handler), clock=lambda: NOW + 30,
                                          backfill_transport=httpx.MockTransport(okx_handler)))
    assert summary["4h"]["computed"] == 3 and summary["1d"]["computed"] == 3
    assert signal_once.due_timeframes(tmp_path, NOW) == []
    assert signal_once.due_timeframes(tmp_path, NOW + 14_400) == ["4h"]

    latest = json.loads((tmp_path / "signals" / "latest.json").read_text())
    assert latest["universe"] == ["BTC-PERP", "ETH-PERP", "NEW-PERP"]
    rows = {r["symbol"]: r for r in latest["timeframes"]["4h"]["rows"]}
    assert rows["BTC-PERP"]["data_status"] == "ready" and rows["BTC-PERP"]["volume_status"] == "ok"
    # NEW has 20 days on Derive; earlier bars come from the backfill (price only, volume 0).
    assert rows["NEW-PERP"]["backfilled_bars"] > 0 and rows["NEW-PERP"]["data_status"] != "not enough data"
    assert rows["NEW-PERP"]["volume_status"] == "thin" and rows["BTC-PERP"]["backfilled_bars"] == 0
    status = json.loads((tmp_path / "signals" / "status.json").read_text())
    assert status["backfill"]["NEW:4h"]["ok"] and "BTC:4h" not in status["backfill"]
    assert rows["BTC-PERP"]["inputs"]["global_metrics"] == "missing"     # CoinGecko refused
    assert rows["BTC-PERP"]["inputs"]["sentiment"] == "ready"
    assert rows["BTC-PERP"]["unified_signal"] is not None and rows["BTC-PERP"]["ribbon"]["state"] in ("gold", "blue", "grey")
    assert "larsson" not in json.dumps(latest).lower()
    assert latest["context"]["sentiment"]["fear_greed_value"] == 30

    day_rows = list(csv.DictReader(open(next((tmp_path / "signals" / "4h").glob("*.csv")))))
    assert {r["symbol"] for r in day_rows} == set(rows) and all(int(r["bar_close"]) % 14_400 == 0 for r in day_rows)

    # Next 4H bar: only 4h is computed; the daily block keeps its rows.
    client2 = DeriveClient("https://x/", transport=httpx.MockTransport(derive_handler), retries=0, backoff=0)
    s2 = asyncio.run(signal_once.run(tmp_path, NOW + 14_400, ["4h"], client=client2,
                                     context_transport=httpx.MockTransport(context_handler), clock=lambda: NOW + 14_430,
                                     backfill_transport=httpx.MockTransport(okx_handler)))
    assert list(s2) == ["4h"]
    latest2 = json.loads((tmp_path / "signals" / "latest.json").read_text())
    assert latest2["timeframes"]["4h"]["bar_close"] == latest["timeframes"]["4h"]["bar_close"] + 14_400
    assert latest2["timeframes"]["1d"]["rows"] and latest2["timeframes"]["1d"]["bar_close"] == latest["timeframes"]["1d"]["bar_close"]


def test_publish_site_builds_app_files(tmp_path):
    import publish_site

    client = DeriveClient("https://x/", transport=httpx.MockTransport(derive_handler), retries=0, backoff=0)
    asyncio.run(signal_once.run(tmp_path, NOW, ["4h", "1d"], client=client, clock=lambda: NOW + 30,
                                context_transport=httpx.MockTransport(context_handler),
                                backfill_transport=httpx.MockTransport(okx_handler)))
    site = tmp_path / "site"
    assert publish_site.build(tmp_path, site, now=NOW + 60) == {"coins": 3}
    markets = json.loads((site / "markets.json").read_text())
    btc = next(c for c in markets["coins"] if c["und"] == "BTC")
    assert btc["signal_4h"] and len(btc["spark"]) == 42 and btc["has_options"] is False
    btc_detail = json.loads((site / "coins" / "BTC.json").read_text())
    assert btc["spark_times"] == [bar[0] + 14400 for bar in btc_detail["candles"]["4h"][-42:]]
    coin = json.loads((site / "coins" / "NEW.json").read_text())
    assert coin["backfilled"]["4h"] > 0 and len(coin["candles"]["4h"]) == 500 and coin["signals"]["4h"]
    assert json.loads((site / "flow.json").read_text())["large"] == []

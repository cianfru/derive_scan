import json

import httpx

from derive.candles import CandleCache
from derive.signals import usable_history
import signal_once

DAY = 86_400_000


def _derive_bars(cache, und, tf, n, zero_every=2, start=1_700_000_000_000, step=DAY):
    p = cache.path(und, tf)
    p.parent.mkdir(parents=True, exist_ok=True)
    rows = ["timestamp,open,high,low,close,volume"]
    for i in range(n):
        rows.append(f"{start + i * step},1,1,1,1,{0.0 if i % zero_every == 0 else 5.0}")
    p.write_text("\n".join(rows) + "\n")
    return [start + i * step for i in range(n)]


def test_spot_volume_replaces_the_whole_series_and_keeps_prices(tmp_path):
    cache = CandleCache(tmp_path)
    ts = _derive_bars(cache, "PUMP", "1d", 10)
    cache.write_spot_volume("PUMP", "1d", {t: 100.0 + i for i, t in enumerate(ts[:-1])}, "okx PUMP-USDT spot")
    bars = cache.load("PUMP", "1d")
    assert list(bars["volume"][:3]) == [100.0, 101.0, 102.0]
    assert bars["volume"][-1] == 0.0  # a bar the spot market does not have stays empty, never borrowed
    assert list(bars["close"]) == [1.0] * 10
    assert cache.spot_volume("PUMP", "1d")[1] == "okx PUMP-USDT spot"


async def test_thin_perp_volume_switches_to_okx_once_and_keeps_its_source(tmp_path):
    cache = CandleCache(tmp_path)
    ts = _derive_bars(cache, "PUMP", "1d", 20)          # half the bars have no perp volume
    _derive_bars(cache, "BTC", "1d", 20, zero_every=10**9)  # full volume: left alone
    calls = []

    def handler(request):
        calls.append(str(request.url))
        data = [[str(t), "1", "1", "1", "1", "7.5", "0", "0", "1"] for t in sorted(ts, reverse=True)]
        return httpx.Response(200, json={"code": "0", "data": data})

    log = await signal_once.thin_volume_from_spot(cache, ["BTC", "PUMP"], 0, transport=httpx.MockTransport(handler))
    assert "BTC:1d" not in log and log["PUMP:1d"] == {"ok": True, "bars": 20, "source": "okx PUMP-USDT spot"}
    assert set(cache.load("PUMP", "1d")["volume"]) == {7.5}
    assert not cache.spot_volume("BTC", "1d")[0]
    assert all("okx.com" in c for c in calls)


def test_young_history_publishes_but_too_few_bars_does_not():
    assert usable_history({"data_status": "ready"})
    assert usable_history({"data_status": "warming up"})
    assert not usable_history({"data_status": "not enough data"})

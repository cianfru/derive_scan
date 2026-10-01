import json

import httpx

from derive.client import DeriveClient
from derive.config import Settings
from derive.recorder import Recorder
from derive.store import Store

EXP = 1_000_000 + 30 * 86400


def _ticker(iv, delta):
    return {"I": "100", "stats": {"oi": "2"}, "option_pricing": {"i": str(iv), "d": str(delta), "f": "100"}}


def handler(request):
    method = request.url.path.rsplit("/", 1)[-1]
    p = json.loads(request.content)
    if method == "get_instruments":
        return httpx.Response(200, json={"result": [
            {"instrument_name": "ETH-19700131-100-C", "is_active": True, "option_details": {"expiry": EXP}}]})
    if method == "get_tickers" and p["instrument_type"] == "option":
        return httpx.Response(200, json={"result": {"tickers": {
            "ETH-19700131-90-P": _ticker(0.6, -0.2), "ETH-19700131-100-P": _ticker(0.5, -0.5),
            "ETH-19700131-100-C": _ticker(0.5, 0.5), "ETH-19700131-110-C": _ticker(0.45, 0.2)}}})
    if method == "get_tickers":
        return httpx.Response(200, json={"result": {"tickers": {"ETH-PERP": {"f": "0.00001", "M": "100.5", "I": "100"}}}})
    return httpx.Response(200, json={"error": {"code": -32601, "message": "no"}})


async def test_run_once_records_features_and_chain(tmp_path):
    s = Settings(sources=["v2_mainnet"], underlyings=["ETH", "BTC"], data_dir=tmp_path)
    store = Store(s.db_path)
    client = DeriveClient("https://x/", transport=httpx.MockTransport(handler), backoff=0, retries=0)
    rec = Recorder(s, store, clients={"v2_mainnet": client})
    await rec.run_once(ts=1_000_000 // 3600 * 3600)
    ts = store.latest_ts("v2_mainnet", "ETH")
    f = store.features_at(ts, "v2_mainnet", "ETH")
    assert f["index_price"] == 100 and f["perp_basis"] == 0.005
    assert store.slices_at(ts, "v2_mainnet", "ETH")[0]["atm_iv"] == 0.5
    assert store.counts()["chains"] == 2
    assert rec.status["v2_mainnet:ETH"]["ok"]
    # BTC returned the same fake chain, but name parsing still works per currency.
    assert rec.status["v2_mainnet:BTC"]["ok"]


async def test_failed_source_is_reported_not_raised(tmp_path):
    s = Settings(sources=["v2_mainnet"], underlyings=["ETH"], data_dir=tmp_path)
    store = Store(s.db_path)
    client = DeriveClient("https://x/", transport=httpx.MockTransport(lambda r: httpx.Response(502)), backoff=0, retries=0)
    rec = Recorder(s, store, clients={"v2_mainnet": client})
    await rec.run_once(ts=1_000_000)
    assert rec.status["v2_mainnet:ETH"]["ok"] is False
    assert store.counts()["features"] == 0


def test_lock_is_exclusive(tmp_path):
    s = Settings(sources=["v2_mainnet"], data_dir=tmp_path)
    a = Recorder(s, Store(":memory:"), clients={})
    b = Recorder(s, Store(":memory:"), clients={})
    assert a.acquire_lock() and not b.acquire_lock()

import csv
import gzip
import json

import httpx

from derive.client import DeriveClient
from derive.config import Settings
from derive.filestore import FileStore
from derive.recorder import Recorder
from record_once import due_keys
from tests.test_recorder import handler

SLOT = 1_000_000 // 3600 * 3600  # on the hour, so the chain is kept


def _rec(s, store, transport):
    return Recorder(s, store, clients={"v2_mainnet": DeriveClient("https://x/", transport=transport, backoff=0, retries=0)})


async def test_snapshot_files(tmp_path):
    s = Settings(sources=["v2_mainnet"], underlyings=["ETH"], data_dir=tmp_path)
    store = FileStore(tmp_path)
    rec = _rec(s, store, httpx.MockTransport(handler))
    await rec.run_once(SLOT)
    store.record_runs(SLOT, rec.status)
    d = tmp_path / "v2_mainnet" / "ETH"
    feats = {r["feature"]: float(r["value"]) for r in csv.DictReader(open(d / "features" / "1970-01-12.csv"))}
    assert feats["index_price"] == 100 and feats["perp_basis"] == 0.005
    exp = list(csv.DictReader(open(d / "expiries" / "1970-01-12.csv")))
    assert float(exp[0]["atm_iv"]) == 0.5 and int(exp[0]["ts"]) == SLOT
    chain = json.loads(gzip.decompress((d / "chains" / "1970-01-12" / "13.json.gz").read_bytes()))
    assert "ETH-PERP" not in chain["options"] and chain["perp"]["I"] == "100"
    latest = json.loads((d / "latest.json").read_text())
    assert latest["ts"] == SLOT and latest["expiries"][0]["atm_iv"] == 0.5
    assert store.load_status()["v2_mainnet:ETH"]["ok"]
    assert len((tmp_path / "runs" / "1970-01-12.csv").read_text().splitlines()) == 2


async def test_due_only_until_recorded(tmp_path):
    s = Settings(sources=["v2_mainnet"], underlyings=["ETH", "BTC"], data_dir=tmp_path)
    store = FileStore(tmp_path)
    assert due_keys(s, store, SLOT) == {"v2_mainnet:ETH", "v2_mainnet:BTC"}

    # BTC fails, ETH succeeds: only BTC stays due for this slot.
    def flaky(request):
        if b'"BTC"' in request.content:
            return httpx.Response(502)
        return handler(request)
    rec = _rec(s, store, httpx.MockTransport(flaky))
    await rec.run_once(SLOT)
    store.record_runs(SLOT, rec.status)
    assert due_keys(s, store, SLOT) == {"v2_mainnet:BTC"}

    # The retry records BTC alone; ETH is not written twice.
    rec = _rec(s, store, httpx.MockTransport(handler))
    await rec.run_once(SLOT, only=due_keys(s, store, SLOT))
    store.record_runs(SLOT, rec.status)
    assert due_keys(s, store, SLOT) == set()
    eth = (tmp_path / "v2_mainnet" / "ETH" / "features" / "1970-01-12.csv").read_text().splitlines()
    assert len(eth) == 1 + len({line.split(",")[1] for line in eth[1:]})
    assert due_keys(s, store, SLOT + s.interval_sec) == {"v2_mainnet:ETH", "v2_mainnet:BTC"}

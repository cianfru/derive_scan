import asyncio
import csv
import json

import httpx

from derive import flow
from derive.client import DeriveClient


def _t(tid, ts, name, direction, amount, price, wallet, role="taker", index="2700"):
    return {"trade_id": tid, "timestamp": ts, "instrument_name": name, "direction": direction,
            "trade_amount": str(amount), "trade_price": str(price), "index_price": index, "wallet": wallet,
            "subaccount_id": 1, "liquidity_role": role, "rfq_id": None, "realized_pnl": "10", "trade_fee": "1"}


TRADES = [
    _t("a", 1_000, "ETH-PERP", "buy", 20, 2700, "0xA"),                     # 54k perp: large
    _t("a", 1_000, "ETH-PERP", "sell", 20, 2700, "0xB", role="maker"),      # maker leg: not in the large list
    _t("b", 2_000, "ETH-20261009-2900-C", "buy", 100, 18, "0xA"),           # 270k notional option: large
    _t("c", 3_000, "BTC-PERP", "sell", 0.1, 85000, "0xC"),                  # 8.5k: small
]


def test_summarise_large_and_wallets():
    large, wallets = flow.summarise(TRADES, run_ts=5)
    assert [r[1] for r in large] == ["ETH-PERP", "ETH-20261009-2900-C"]
    by = {r[1]: r for r in wallets}
    assert by["0xA"][2] == 2 and by["0xA"][3] == 54000.0 and by["0xA"][5] == 1800.0
    assert by["0xB"][3] == 54000.0 and by["0xC"][3] == 8500.0


def test_update_reads_only_new_trades(tmp_path):
    feed = list(TRADES)

    def handler(request):
        p = json.loads(request.content)
        ts = [t for t in feed if p["from_timestamp"] <= t["timestamp"] <= p["to_timestamp"]]
        return httpx.Response(200, json={"result": {"trades": ts, "pagination": {"num_pages": 1, "count": len(ts)}}})

    client = DeriveClient("https://x/", transport=httpx.MockTransport(handler), retries=0, backoff=0)
    assert asyncio.run(flow.update(client, tmp_path, 10_000))["legs"] == 4
    assert asyncio.run(flow.update(client, tmp_path, 11_000))["legs"] == 0     # same trades, not counted twice
    feed.append(_t("d", 10_500, "ETH-PERP", "buy", 1, 2700, "0xD"))
    assert asyncio.run(flow.update(client, tmp_path, 12_000))["legs"] == 1
    rows = list(csv.DictReader(open(next((tmp_path / "flow" / "wallets").glob("*.csv")))))
    assert len(rows) == 3 + 1   # three wallets in the first run, one in the third

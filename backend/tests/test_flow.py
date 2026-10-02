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
    rows = list(csv.DictReader(open(next((tmp_path / "flow" / "wallets_v2").glob("*.csv")))))
    assert len(rows) == 3 + 1   # three wallets in the first run, one in the third


def test_market_makers_left_out_of_taker_sides(tmp_path):
    (tmp_path / "history").mkdir()
    (tmp_path / "history" / "wallets.json").write_text(json.dumps({"wallets": {"0xA": {"class": "market_maker"}}}))
    mms = flow.market_makers(tmp_path)
    assert mms == {"0xA"}
    kinds = {r[2] for r in flow.sides(TRADES, 5, mms)}
    assert kinds == {"perp"} and all(r[1] == "BTC" for r in flow.sides(TRADES, 5, mms))


def test_reverted_trades_do_not_enter_any_flow_totals():
    reverted = [{**t, "tx_status": "reverted"} for t in TRADES]
    assert flow.sides(reverted, 5) == []
    assert flow.summarise(reverted, 5) == ([], [])


def test_late_trade_at_same_watermark_is_counted_once(tmp_path):
    a = TRADES[0]
    b = {**a, "trade_id": "late"}
    feed = [a, a]

    def handler(request):
        return httpx.Response(200, json={"result": {"trades": feed, "pagination": {"num_pages": 1}}})

    async def go():
        client = DeriveClient("https://x/", transport=httpx.MockTransport(handler))
        try:
            assert (await flow.update(client, tmp_path, 2000))["legs"] == 1
            feed.append(b)
            assert (await flow.update(client, tmp_path, 3000))["legs"] == 1
            assert (await flow.update(client, tmp_path, 4000))["legs"] == 0
        finally:
            await client.close()
    asyncio.run(go())
    rows = list(csv.DictReader(next((tmp_path / "flow" / "wallets_v2").glob("*.csv")).open()))
    assert sum(int(r["legs"]) for r in rows) == 2

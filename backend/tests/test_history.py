import asyncio
import gzip
import json
from datetime import date, datetime, timezone

import httpx

import history_once
from derive import history
from derive.client import DeriveClient

DAY = date(2024, 6, 3)
T0 = int(datetime(2024, 6, 3, 12, tzinfo=timezone.utc).timestamp() * 1000)


def _t(name, direction, amount, price, wallet, role="taker", index="3800", ts=T0):
    return {"trade_id": f"{name}{wallet}{direction}", "timestamp": ts, "instrument_name": name, "direction": direction,
            "trade_amount": str(amount), "trade_price": str(price), "index_price": index, "mark_price": str(price),
            "wallet": wallet, "subaccount_id": 1, "liquidity_role": role, "realized_pnl": "0", "trade_fee": "1",
            "tx_status": "settled"}


def test_implied_vol_round_trip_and_delta():
    f, k, t = 3800.0, 4000.0, 30 / 365
    for cp in ("C", "P"):
        p = history.option_price(f, k, t, 0.6, cp)
        assert abs(history.implied_vol(p, f, k, t, cp) - 0.6) < 1e-6
    assert 0 < history.option_delta(f, k, t, 0.6, "C") < 0.5
    assert -1 < history.option_delta(f, k, t, 0.6, "P") < -0.5
    assert history.implied_vol(1.0, f, 3000, t, "C") is None  # below intrinsic


def test_day_rows_sums_per_wallet_and_instrument():
    p = round(history.option_price(3800, 4000, (history.parse_option("ETH-20240628-4000-C")[1] - T0 / 1000) / history.YEAR, 0.6, "C"), 4)
    rows = history.day_rows([
        _t("ETH-20240628-4000-C", "buy", 10, p, "0xA"),
        _t("ETH-20240628-4000-C", "sell", 10, p, "0xM", role="maker"),
        _t("ETH-PERP", "sell", 2, 3800, "0xA"),
        _t("ETH-PERP", "buy", 1, 3800, "0xX") | {"tx_status": "reverted"},
    ])
    by = {(r[0], r[1]): dict(zip(history.FIELDS, r)) for r in rows}
    a = by[("0xA", "ETH-20240628-4000-C")]
    assert a["buy_contracts"] == 10 and a["taker_legs"] == 1 and abs(a["iv"] - 0.6) < 0.01 and a["delta_usd"] > 0
    m = by[("0xM", "ETH-20240628-4000-C")]
    assert m["maker_legs"] == 1 and m["otm_sell_usd"] == m["sell_value_usd"] > 0 and m["delta_usd"] < 0
    assert by[("0xA", "ETH-PERP")]["delta_usd"] == -7600 and ("0xX", "ETH-PERP") not in by


def _write(root, day, rows):
    history.write_day(root, day, [[r.get(k, 0) for k in history.FIELDS] for r in rows])


def test_classify(tmp_path):
    opt = "ETH-20240628-4000-C"
    for i in range(100):  # 0xD: directional, 25 taker buys over 100 days, profitable at expiry
        d = date.fromordinal(date(2024, 3, 1).toordinal() + i)
        rows = [{"wallet": "0xM", "instrument": opt, "buy_contracts": 1, "sell_contracts": 1, "maker_legs": 2}]
        if i % 4 == 0:
            rows.append({"wallet": "0xD", "instrument": opt, "buy_contracts": 1, "buy_value_usd": 50, "taker_legs": 1,
                         "delta_usd": 1000})
            rows.append({"wallet": "0xS", "instrument": opt, "sell_contracts": 1, "sell_value_usd": 50, "taker_legs": 1,
                         "otm_sell_usd": 50, "delta_usd": -1000})
            rows.append({"wallet": "0xH", "instrument": opt, "buy_contracts": 1, "buy_value_usd": 50, "taker_legs": 1,
                         "delta_usd": 1000})
            rows.append({"wallet": "0xH", "instrument": "ETH-PERP", "sell_contracts": 0.3, "delta_usd": -900})
        _write(tmp_path, d, rows)
    cls = history.classify(tmp_path, {"ETH": {"20240628": 4300.0}}, as_of=2e9)
    assert cls["0xM"]["class"] == "market_maker"
    assert cls["0xS"]["class"] == "income"
    assert cls["0xH"]["class"] == "hedger"
    assert cls["0xD"]["class"] == "skilled" and cls["0xD"]["option_pnl"] == 25 * 300 - 25 * 50


def test_history_once_reads_days_and_checks_counts(tmp_path):
    trades = [_t("ETH-PERP", "buy", 1, 3800, "0xA"), _t("ETH-PERP", "sell", 1, 3800, "0xB", role="maker")]

    def handler(request):
        p = json.loads(request.content)
        if request.url.path.endswith("get_option_settlement_prices"):
            return httpx.Response(200, json={"result": {"expiries": []}})
        legs = [t for t in trades if p["from_timestamp"] <= t["timestamp"] <= p["to_timestamp"]
                and p["instrument_type"] == "perp"]
        return httpx.Response(200, json={"result": {"trades": legs, "pagination": {"num_pages": 1, "count": len(legs)}}})

    async def go():
        client = DeriveClient("https://x", transport=httpx.MockTransport(handler))
        history.save_state(tmp_path, {"done_through": "2024-06-01"})
        now = datetime(2024, 6, 4, 2, tzinfo=timezone.utc).timestamp()
        out = await history_once.run(tmp_path, budget=60, now=now, client=client)
        await client.close()
        return out

    assert asyncio.run(go()) == {"added": 2, "through": "2024-06-03"}
    with gzip.open(tmp_path / "history" / "days" / "2024-06-03.csv.gz", "rt") as fh:
        assert len(fh.read().strip().splitlines()) == 3
    doc = json.loads((tmp_path / "history" / "wallets.json").read_text())
    assert doc["through"] == "2024-06-03" and doc["wallets"] == {}  # perp-only wallets are not classed

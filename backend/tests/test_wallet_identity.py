"""Traders are named by the owner's own wallet (EOA, V3's name) once it is known, by the Derive
Wallet (SCW, V2's name) until then (owner's decision, 5 October 2026; derive/wallet_alias.py)."""
import asyncio
import json
from datetime import date, datetime, timedelta, timezone

import httpx

import publish_site
import wallet_alias_once
from derive import balance_history as B
from derive import flow, history, traders
from derive.client import DeriveClient
from derive.wallet_alias import WalletAlias, alias_path, attach, canonical, detach, load, scw_to_eoa

OPT, LIVE = "ETH-20240628-4000-C", "ETH-20991231-5000-C"
SETTLE = {"ETH": {"20240628": 4300.0}}
SCW1, SCW2, SCW3, EOA1, EOA3 = "0xScw1", "0xScw2", "0xScw3", "0xEoa1", "0xEoa3"


def _aliases(root, subaccounts, owners, version=2):
    p = alias_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    doc = {"version": version, "subaccounts": subaccounts}
    if version >= 2:
        doc["owners"] = owners
    p.write_text(json.dumps(doc))


def _write(root, day, rows):
    history.write_day(root, day, [[r.get(k, 0) for k in history.FIELDS] for r in rows])


# -- the alias file ---------------------------------------------------------------------------

def test_version_1_is_read_and_version_2_written(tmp_path):
    _aliases(tmp_path, {"1": SCW1, "2": None}, {}, version=1)
    doc = load(tmp_path)
    assert doc["subaccounts"] == {"1": SCW1, "2": None} and doc["owners"] == {} and doc["version"] == 2
    assert not canonical(tmp_path)  # no owners yet: every name stays
    alias = WalletAlias(tmp_path, mode="v3", client=object())
    asyncio.run(alias.apply([{"subaccount_id": 1, "wallet": EOA1}]))
    saved = json.loads(alias_path(tmp_path).read_text())
    assert saved["version"] == 2 and saved["owners"] == {"1": EOA1} and saved["subaccounts"] == {"1": SCW1, "2": None}
    assert canonical(tmp_path)(SCW1) == EOA1 and canonical(tmp_path)(SCW1.upper()) == EOA1


def test_an_unchanged_file_is_not_rewritten(tmp_path):
    _aliases(tmp_path, {"1": SCW1}, {"1": EOA1})
    before = alias_path(tmp_path).read_text()
    alias = WalletAlias(tmp_path, mode="v2")
    asyncio.run(alias.apply([{"subaccount_id": 1, "wallet": SCW1}]))
    assert alias_path(tmp_path).read_text() == before  # nothing learned: the data branch gets no new version


def test_an_scw_owned_by_two_wallets_is_never_translated():
    mapping, conflicts = scw_to_eoa({"1": SCW1, "2": SCW1, "3": SCW2, "4": "0xSame", "5": SCW3},
                                    {"1": EOA1, "2": "0xOther", "3": EOA1, "4": "0xsame"})
    assert mapping == {SCW2.lower(): EOA1}  # SCW1 has two owners; 0xSame is its own owner; SCW3 has none
    assert conflicts == [SCW1.lower()]


def test_v2_legs_are_renamed_to_their_owner_and_keep_the_name_read(tmp_path):
    _aliases(tmp_path, {"1": SCW1}, {"1": EOA1, "9": EOA3})
    alias = WalletAlias(tmp_path, mode="v2")
    legs = [{"trade_id": "a", "direction": "buy", "subaccount_id": 1, "wallet": SCW1},
            {"trade_id": "a", "direction": "sell", "subaccount_id": 7, "wallet": "0xUnknown"},
            {"trade_id": "b", "direction": "buy", "subaccount_id": 9, "wallet": SCW3}]
    keys = [flow.leg_key(t) for t in legs]
    asyncio.run(alias.apply(legs))
    assert [t["wallet"] for t in legs] == [EOA1, "0xUnknown", EOA3]  # subaccount 9's SCW learned from the leg
    assert legs[0]["wallet_raw"] == SCW1 and "wallet_raw" not in legs[1]
    assert [flow.leg_key(t) for t in legs] == keys  # saved flow keys still match
    saved = json.loads(alias_path(tmp_path).read_text())
    assert saved["subaccounts"] == {"1": SCW1, "7": "0xUnknown", "9": SCW3}


def test_attach_by_source(tmp_path):
    class C:
        pass
    assert attach(C(), "v3_testnet", tmp_path) is None
    assert attach(C(), "v2_mainnet", tmp_path).mode == "v2"
    assert attach(C(), "v3_mainnet", tmp_path).mode == "v3"


def test_seed_reads_each_finished_day_once(tmp_path):
    now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc).timestamp()
    reads = []

    def handler(request):
        p = json.loads(request.content)
        day = datetime.fromtimestamp(p["from_timestamp"] / 1000, timezone.utc).date().isoformat()
        reads.append(day)
        legs = [{"trade_id": day, "direction": "buy", "wallet": EOA1, "subaccount_id": 1,
                 "timestamp": p["from_timestamp"], "instrument_name": "ETH-PERP"}] if day == "2026-10-04" else []
        return httpx.Response(200, json={"result": {"trades": legs, "pagination": {"num_pages": 1, "count": len(legs)}}})

    _aliases(tmp_path, {"1": SCW1}, {})

    async def go():
        client = DeriveClient("https://v3/", transport=httpx.MockTransport(handler), retries=0)
        try:
            return await wallet_alias_once.seed(tmp_path, 3, 60, client=client, now=now)
        finally:
            await client.close()

    out = asyncio.run(go())
    assert out["days"] == ["2026-10-04", "2026-10-03", "2026-10-02"] and out["translated_scws"] == 1
    assert canonical(tmp_path)(SCW1) == EOA1
    reads.clear()
    again = asyncio.run(go())
    assert again["days"] == [] and again["skipped_days"] == 3 and reads == []


# -- aggregates -------------------------------------------------------------------------------

def _history(root):
    """SCW1 and SCW2 belong to EOA1 (two Derive Wallets, one owner); SCW3 belongs to EOA3, which also
    traded under its own name after the switch; 0xKeep has no known owner."""
    day = date(2024, 6, 1)
    rows = []
    for _ in range(12):
        rows += [{"wallet": SCW1, "instrument": OPT, "buy_contracts": 1, "buy_value_usd": 50, "taker_legs": 1},
                 {"wallet": "0xKeep", "instrument": OPT, "sell_contracts": 1, "sell_value_usd": 50, "taker_legs": 1}]
    rows += [{"wallet": SCW1, "instrument": LIVE, "buy_contracts": 3, "buy_value_usd": 300, "taker_legs": 1},
             {"wallet": SCW2, "instrument": OPT, "buy_contracts": 2, "buy_value_usd": 100, "taker_legs": 2},
             {"wallet": SCW2, "instrument": LIVE, "sell_contracts": 1, "sell_value_usd": 120, "taker_legs": 1},
             {"wallet": SCW3, "instrument": OPT, "buy_contracts": 1, "sell_contracts": 1, "maker_legs": 2}]
    _write(root, day, rows)
    # EOA3's own legs: directional-looking taker buys; its other part (SCW3) is a market maker
    _write(root, day + timedelta(days=1), [{"wallet": EOA3, "instrument": OPT, "buy_contracts": 1,
                                            "buy_value_usd": 50, "taker_legs": 1} for _ in range(1)]
           + [{"wallet": SCW1, "instrument": LIVE, "buy_contracts": 1, "buy_value_usd": 90, "taker_legs": 1},
              {"wallet": EOA1, "instrument": LIVE, "sell_contracts": 2, "sell_value_usd": 250, "taker_legs": 1}])
    _aliases(root, {"1": SCW1, "2": SCW2, "3": SCW3, "4": "0xKeep"}, {"1": EOA1, "2": EOA1, "3": EOA3})


def test_scan_translates_and_merges_one_owner(tmp_path):
    _history(tmp_path)
    scan = history.scan_days(tmp_path, 1.75e9)
    assert SCW1 not in scan["w"] and SCW2 not in scan["w"] and SCW3 not in scan["w"]
    assert "0xKeep" in scan["w"]  # unknown owner: the Derive Wallet stays
    # EOA1 = SCW1 + SCW2 + its own legs: contracts and cash add up per instrument
    assert scan["inst"][(EOA1, OPT)]["net"] == 14 and scan["inst"][(EOA1, OPT)]["cash"] == -700
    assert scan["inst"][(EOA1, LIVE)]["net"] == 3 - 1 + 1 - 2
    assert scan["w"][EOA1]["legs"] == 12 + 1 + 2 + 1 + 1 + 1
    # rows meeting under one name on one day are one row: two trading days, each with both sides
    assert scan["inst"][(EOA1, LIVE)]["days"] == 2 and scan["inst"][(EOA1, LIVE)]["both"] == 2
    cls = history.classify(tmp_path, SETTLE, 1.75e9, scan=scan)
    assert cls[EOA1]["option_pnl"] == 14 * 300 - 700  # PnL: the sum of its parts
    out = traders.build(scan, cls, 1.75e9)
    addresses = [t["address"] for t in out["traders"]]
    assert EOA1 in addresses and "0xKeep" in addresses and not {SCW1, SCW2, SCW3, EOA3} & set(addresses)
    assert dict((r[0], r[1]) for r in next(t for t in out["traders"] if t["address"] == EOA1)["open"]) == {LIVE: 1.0}


def test_the_market_maker_list_keeps_the_same_entities(tmp_path):
    _history(tmp_path)
    before = history.classify(tmp_path, SETTLE, 1.75e9, scan=history.scan_days(tmp_path, 1.75e9, canon=canonical(tmp_path / "none")))
    assert before[SCW3]["class"] == "market_maker" and before[EOA3]["class"] != "market_maker"
    after = history.classify(tmp_path, SETTLE, 1.75e9)
    # SCW3 alone was a market maker: its owner, merged with its own taker legs, stays one
    assert after[EOA3]["class"] == "market_maker" and SCW3 not in after
    makers_before = {w for w, v in before.items() if v["class"] == "market_maker"}
    canon = canonical(tmp_path)
    assert {canon(w) for w in makers_before} <= {w for w, v in after.items() if v["class"] == "market_maker"}
    # flow leaves both names out, whatever the leg is called and whenever wallets.json was written
    (tmp_path / "history" / "wallets.json").write_text(json.dumps({"wallets": before}))  # written before the owners
    exclude = flow.market_makers(tmp_path)
    leg = {"liquidity_role": "taker", "instrument_name": OPT, "direction": "buy", "trade_amount": "1",
           "trade_price": "10", "index_price": "3000"}
    assert flow.sides([{**leg, "wallet": EOA3, "wallet_raw": SCW3}], 0, exclude) == []
    assert flow.sides([{**leg, "wallet": EOA3}], 0, exclude) == []
    assert flow.sides([{**leg, "wallet": SCW3.upper().replace("0X", "0x")}], 0, exclude) == []
    assert flow.sides([{**leg, "wallet": EOA1}], 0, exclude) != []
    (tmp_path / "history" / "wallets.json").write_text(json.dumps({"wallets": after}))
    assert EOA3 in flow.market_makers(tmp_path) and SCW3.lower() in flow.market_makers(tmp_path)


def test_replay_tiers_follow_the_same_names(tmp_path):
    _history(tmp_path)
    canon = canonical(tmp_path)
    rp = B.Replay(SETTLE)
    for p in sorted((tmp_path / "history" / "days").glob("*.csv.gz")):
        rp.add_day(p.name[:10], history.canonical_rows(history.read_day(p), canon, rp.members), {})
    rp.settle_through(1.75e9)
    rp.tiers()
    classes = history.classify(tmp_path, SETTLE, 1.75e9)
    assert rp.cls[EOA3] == classes[EOA3]["class"] == "market_maker"
    assert {w: c for w, c in rp.cls.items()} == {w: v["class"] for w, v in classes.items()}


def test_publish_translates_flow_and_publishes_old_links(tmp_path):
    data, site = tmp_path / "data", tmp_path / "site"
    now = datetime(2026, 10, 3, 12, tzinfo=timezone.utc).timestamp()
    rows = []
    for _ in range(12):
        rows += [{"wallet": SCW1, "instrument": "ETH-20260925-4000-C", "buy_contracts": 1, "buy_value_usd": 50,
                  "taker_legs": 1},
                 {"wallet": SCW3, "instrument": "ETH-20260925-4000-C", "buy_contracts": 1, "sell_contracts": 1,
                  "maker_legs": 2}]
    _write(data, date(2026, 9, 20), rows)
    _write(data, date(2026, 10, 2), [{"wallet": "0xKeep", "instrument": "ETH-PERP", "buy_contracts": 1}])
    _aliases(data, {"1": SCW1, "3": SCW3}, {"1": EOA1, "3": EOA3})
    as_of = datetime(2026, 10, 3, tzinfo=timezone.utc).timestamp()
    scan = history.scan_days(data, as_of)
    classes = history.classify(data, {"ETH": {"20260925": 4300.0}}, as_of, scan=scan)
    meta = {"as_of": int(as_of), "through": "2026-10-02", "schema_version": 4}
    (data / "history" / "wallets.json").write_text(json.dumps({**meta, "wallets": classes}))
    (data / "history" / "traders.json").write_text(json.dumps({**meta, **traders.build(scan, classes, as_of)}))
    # flow rows written before the owners were known carry the Derive Wallet
    t = int(now) - 3600
    for directory, fields, rs in (
            ("large", flow.LARGE_FIELDS,
             [[t * 1000, "ETH-20261030-3000-C", "option", "ETH", "buy", 1, 1, 1, 400_000, 0, SCW1, 1, 0, 0],
              [t * 1000, "ETH-20261030-3000-C", "option", "ETH", "buy", 1, 1, 1, 900_000, 0, SCW3, 3, 0, 0]]),
            ("wallets_v2", ("bucket_ts", *flow.WALLET_FIELDS[1:]),
             [[t // 900 * 900, SCW1, 2, 0, 400_000, 8_000, 0, 0, 3], [t // 900 * 900, EOA1, 1, 0, 100_000, 2_000, 0, 0, 1],
              [t // 900 * 900, SCW3, 9, 0, 900_000, 1, 1, 1, 1]])):
        p = data / "flow" / directory / "2026-10-03.csv"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(flow._csv_text(fields, rs))
    doc = publish_site.flow_block(data, now, sides={"_coverage": {}})
    text = json.dumps(doc).lower()
    assert SCW3.lower() not in text and EOA3.lower() not in text  # the market maker under either name
    assert [r["wallet"] for r in doc["large"]] == [EOA1]
    assert [(w["wallet"], w["legs"]) for w in doc["wallets"]] == [(EOA1, 3)]  # SCW1 and EOA1 rows summed
    publish_site.traders_block(data, site, {}, doc, now)
    names = sorted(p.name for p in (site / "traders").glob("*.json"))
    assert names == sorted(["aliases.json", f"{EOA1.lower()}.json", "index.json"])
    aliases = json.loads((site / "traders" / "aliases.json").read_text())
    assert aliases == {"version": 1, "aliases": {SCW1.lower(): EOA1.lower()}}  # no market maker, nothing unknown
    trader = json.loads((site / "traders" / f"{EOA1.lower()}.json").read_text())
    assert trader["address"] == EOA1 and [r["wallet"] for r in trader["large_24h"]] == [EOA1]


def test_v2_flow_writes_owner_names_and_keeps_its_keys(tmp_path):
    _aliases(tmp_path, {"1": SCW1}, {"1": EOA1})
    now_ms = int(datetime(2026, 10, 3, 12, tzinfo=timezone.utc).timestamp() * 1000)
    legs = [{"trade_id": "t1", "timestamp": now_ms - 1000, "instrument_name": "ETH-PERP", "direction": d,
             "trade_amount": "100", "trade_price": "3000", "index_price": "3000", "wallet": w, "subaccount_id": s,
             "liquidity_role": role, "realized_pnl": "0", "trade_fee": "1"}
            for d, w, s, role in (("buy", SCW1, 1, "taker"), ("sell", "0xKeep", 4, "maker"))]

    def handler(request):
        return httpx.Response(200, json={"result": {"trades": [dict(t) for t in legs],
                                                    "pagination": {"num_pages": 1, "count": 2}}})

    async def go():
        client = DeriveClient("https://v2/", transport=httpx.MockTransport(handler), retries=0)
        attach(client, "v2_mainnet", tmp_path)
        try:
            await flow.update(client, tmp_path, now_ms)
            return await flow.update(client, tmp_path, now_ms + 1)  # the same legs again: already seen
        finally:
            await detach(client)
            await client.close()

    again = asyncio.run(go())
    assert again == {"legs": 0}
    large = (tmp_path / "flow" / "large" / "2026-10-03.csv").read_text()
    assert EOA1 in large and SCW1 not in large
    state = json.loads((tmp_path / "flow" / "state.json").read_text())
    assert any(SCW1 in k for k in state["keys_at_last"])  # keys by the name read
    wallets = (tmp_path / "flow" / "wallets_v2" / "2026-10-03.csv").read_text()
    assert EOA1 in wallets and "0xKeep" in wallets and SCW1 not in wallets


def test_history_job_rebuilds_when_owner_names_are_learned(tmp_path):
    import history_once

    def handler(request):
        if request.url.path.endswith("get_option_settlement_prices"):
            return httpx.Response(200, json={"result": {"expiries": []}})
        return httpx.Response(200, json={"result": {"trades": [], "pagination": {"num_pages": 1, "count": 0}}})

    rows = [{"wallet": SCW1, "instrument": OPT, "buy_contracts": 1, "buy_value_usd": 50, "taker_legs": 1}] * 1
    _write(tmp_path, date(2024, 6, 3), rows)
    history.save_state(tmp_path, {"done_through": "2024-06-03", "repaired": history_once.REPAIR})
    now = datetime(2024, 6, 4, 2, tzinfo=timezone.utc).timestamp()

    async def go(at):
        client = DeriveClient("https://x", transport=httpx.MockTransport(handler), retries=0)
        try:
            return await history_once.run(tmp_path, budget=0, now=at, client=client)
        finally:
            await client.close()

    def wallets():
        return json.loads((tmp_path / "history" / "wallets.json").read_text())

    asyncio.run(go(now))
    assert SCW1 in wallets()["wallets"] and wallets()["schema_version"] == history_once.SCHEMA_VERSION
    _aliases(tmp_path, {"1": SCW1}, {"1": EOA1})
    asyncio.run(go(now + 600))
    assert SCW1 in wallets()["wallets"]  # names learned: rebuilt at most once an hour
    asyncio.run(go(now + history_once.ALIAS_REBUILD_EVERY + 1))
    doc = wallets()
    assert EOA1 in doc["wallets"] and SCW1 not in doc["wallets"] and doc["aliases"] == canonical(tmp_path).digest

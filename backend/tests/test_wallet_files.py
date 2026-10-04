"""traders/: one file per ranked trader and index.json, nothing else; no market maker anywhere."""
import json
from datetime import date, datetime, timezone

import publish_site
from derive import history, traders

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc).timestamp()
OPT = "ETH-20260925-4000-C"


def _write(root, day, rows):
    history.write_day(root, day, [[r.get(k, 0) for k in history.FIELDS] for r in rows])


def _data(root):
    rows = []
    for _ in range(12):
        rows += [{"wallet": "0xW", "instrument": OPT, "buy_contracts": 1, "buy_value_usd": 50, "taker_legs": 1},
                 {"wallet": "0xL", "instrument": OPT, "sell_contracts": 1, "sell_value_usd": 50, "taker_legs": 1},
                 {"wallet": "0xMaker", "instrument": OPT, "buy_contracts": 1, "sell_contracts": 1, "maker_legs": 2}]
    _write(root, date(2025, 6, 1), [{"wallet": "0xOld", "instrument": OPT, "buy_contracts": 1, "buy_value_usd": 5,
                                     "taker_legs": 1}])
    _write(root, date(2026, 9, 20), rows)
    _write(root, date(2026, 10, 2), [{"wallet": "0xW", "instrument": "ETH-PERP", "buy_contracts": 1}])
    as_of = datetime(2026, 10, 3, tzinfo=timezone.utc).timestamp()
    scan = history.scan_days(root, as_of)
    classes = history.classify(root, {"ETH": {"20260925": 4300.0}}, as_of, scan=scan)
    assert classes["0xMaker"]["class"] == "market_maker"
    meta = {"as_of": int(as_of), "through": "2026-10-02", "schema_version": 3}
    (root / "history" / "wallets.json").write_text(json.dumps({**meta, "wallets": classes}))
    (root / "history" / "traders.json").write_text(json.dumps({**meta, **traders.build(scan, classes, as_of)}))
    return root


def test_publish_leaves_only_ranked_files_and_the_index(tmp_path):
    data, site = _data(tmp_path / "data"), tmp_path / "site"
    (site / "traders").mkdir(parents=True)
    for stale in ("0xmaker", "0xgone"):  # stubs left by earlier publishes
        (site / "traders" / f"{stale}.json").write_text('{"ready":false,"status":"not_ranked"}')
    publish_site.traders_block(data, site, {}, {}, NOW)
    names = sorted(p.name for p in (site / "traders").glob("*.json"))
    assert names == ["0xl.json", "0xw.json", "index.json"]
    first = {p.name: p.read_bytes() for p in (site / "traders").glob("*.json")}
    assert all("generated_at" not in json.loads(b) for n, b in first.items() if n != "index.json")
    for p in site.rglob("*.json"):
        assert "0xmaker" not in p.read_text().lower()
    index = json.loads(first["index.json"])
    assert index["through"] == "2026-10-02"
    assert {r[0]: (r[2], r[3]) for r in index["wallets"]} == {"0xl": (12, 1), "0xw": (12, 1)}  # no MM, no 0xOld
    publish_site.traders_block(data, site, {}, {}, NOW)
    assert {p.name: p.read_bytes() for p in (site / "traders").glob("*.json")} == first


def test_index_excludes_market_makers_and_lists_unranked_wallets(tmp_path):
    (tmp_path / "history").mkdir()
    (tmp_path / "history" / "wallets.json").write_text(json.dumps({"through": "2026-10-02", "wallets": {
        "0xA": {"class": "market_maker", "last": "2026-10-01"},
        "0xB": {"class": "occasional", "last": "2026-01-01"},
        "0xC": {"class": "income", "last": "2025-09-01"}}}))
    index = publish_site.wallet_index(tmp_path, ranked=set())
    assert index["wallets"] == [["0xb", "o", 274, 0]]


def test_no_history_removes_every_wallet_file(tmp_path):
    site = tmp_path / "site"
    (site / "traders").mkdir(parents=True)
    (site / "traders" / "0xa.json").write_text("{}")
    publish_site.traders_block(tmp_path / "data", site, {}, {}, NOW)
    assert list((site / "traders").glob("*.json")) == []

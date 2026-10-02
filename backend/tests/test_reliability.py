import json
import asyncio
from datetime import date, datetime, timezone

import pytest

from derive import history, traders
import history_once
from derive.lean import wallets_reading
from publish_site import cohort_lean, history_coverage, traders_block, _book

NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc).timestamp()
OPTION = "BTC-20261009-100000-C"


def write(root, day, buy=0, sell=0, bv=0, sv=0, wallet="alice", name=OPTION):
    history.write_day(root, date.fromisoformat(day), [[wallet, name, buy, sell, bv, sv, 0, 1, 0, "", 0, 0, 0]])


def test_closed_and_reopened_position_uses_remaining_cost(tmp_path):
    write(tmp_path, "2026-09-01", buy=1, bv=100)
    write(tmp_path, "2026-09-02", sell=1, sv=120)
    write(tmp_path, "2026-09-03", buy=1, bv=300)
    assert traders.open_positions(history.scan_days(tmp_path, NOW), NOW)["alice"] == [[OPTION, 1.0, 300.0]]


@pytest.mark.parametrize("net,entry,buy,sell,bv,sv,expected", [
    (2, 100, 0, 1, 0, 300, 100),  # partial close
    (2, 100, 0, 3, 0, 900, 300),  # long -> short
    (-2, 100, 3, 0, 900, 0, 300), # short -> long
    (-2, 100, 0, 2, 0, 600, 200), # add short
    (2, 100, 2, 1, 600, 200, None), # ambiguous intra-day order
    (2, None, 1, 0, 300, 0, None),  # unknown basis remains unknown
    (2, None, 0, 3, 0, 900, 300),   # reversal establishes known cost
    (2, None, 0, 2, 0, 600, None),  # flat resets basis
])
def test_daily_cost_basis(net, entry, buy, sell, bv, sv, expected):
    assert history.advance_entry(net, entry, buy, sell, bv, sv, single_fill=True) == expected


def test_multiple_fills_crossing_flat_have_unknown_remaining_cost():
    # Cover one short at 100, then buy one at 300: the daily buy average is 200,
    # but remaining cost is 300. Daily totals do not retain that order.
    assert history.advance_entry(-1, 50, 2, 0, 400, 0) is None


def test_unknown_entry_does_not_produce_unrealised_pnl():
    exp = history.parse_option(OPTION)[1]
    chain = {"ts": NOW, "expiries": {str(exp): [[100000, 0, 0, .5, .5, .5]]}}
    marked = traders.mark_position(OPTION, 1, None, chain, 100000, NOW)
    assert marked["mark"] is not None and marked["upnl"] is None


def test_opposing_wallets_preserve_gross_exposure():
    held = {(a, OPTION): n for a, n in [("a", 100), ("b", -99), ("c", 1)]}
    positions = history.tier_positions(held, {a: {"tier": "smart"} for a in ("a", "b", "c")})["BTC"]
    exp = history.parse_option(OPTION)[1]
    chain = {"ts": NOW, "expiries": {str(exp): [[100000, 0, 0, .5, .5, .5]]}}
    reading = wallets_reading(positions, chain, 100000, NOW, 7)
    assert reading["score"] == .01 and reading["state"] == "neutral"
    assert reading["gross_delta_usd"] == 10_000_000
    cohort = cohort_lean({OPTION: [2, 3, 200]}, {"BTC": (chain, 100000, NOW)}, NOW)
    assert cohort["score"] == .01 and cohort["state"] == "neutral"
    assert wallets_reading({OPTION: {"smart": [2, 3]}}, chain, 100000, NOW, 7)["score"] is None


def test_as_of_excludes_future_and_incomplete_days_even_with_unbounded_scan(tmp_path):
    write(tmp_path, "2026-10-01")
    write(tmp_path, "2026-10-02", wallet="intraday")
    write(tmp_path, "2026-10-03", wallet="future")
    assert set(history.classify(tmp_path, {}, NOW, scan=history.scan_days(tmp_path))) == {"alice"}
    scan = history.scan_days(tmp_path, NOW)
    assert history.classify(tmp_path, {}, NOW, scan=scan) == history.classify(tmp_path, {}, NOW, scan=scan)


def test_readiness_requires_coverage_and_new_calculations():
    assert not history_coverage({"through": "2025-06-13", "schema_version": 2}, NOW)["ready"]
    assert history_coverage({"through": "2026-10-01"}, NOW)["status"] == "updating"
    assert history_coverage({"through": "2026-10-01", "schema_version": 2}, NOW)["ready"]
    assert history_coverage({}, NOW)["status"] == "backfilling"


def test_partial_history_hides_rankings_and_existing_direct_links(tmp_path):
    data, site = tmp_path / "data", tmp_path / "site"
    (data / "history").mkdir(parents=True)
    (data / "history" / "traders.json").write_text(json.dumps({"through": "2025-06-13", "schema_version": 2,
                                                              "traders": [{"address": "alice"}]}))
    (site / "traders").mkdir(parents=True)
    (site / "traders" / "old.json").write_text('{"ready":true,"book":[1]}')
    traders_block(data, site, {}, {}, NOW)
    for path in [site / "traders.json", site / "traders" / "old.json", site / "traders" / "alice.json"]:
        doc = json.loads(path.read_text())
        assert doc["ready"] is False and doc["through"] == "2025-06-13"
        assert "book" not in doc and "traders" not in doc


def test_expired_positions_are_not_marked_as_open():
    assert _book([["BTC-20261002-100000-C", 1, 50]], {}, NOW) == []


def test_snapshot_upgrade_preserves_accumulation_and_uses_history_cutoff(tmp_path, monkeypatch):
    option = "BTC-20240628-100000-C"
    write(tmp_path, "2024-06-01", buy=1, bv=100, name=option)
    history.save_state(tmp_path, {"done_through": "2024-06-01"})
    stored = {p: p.read_bytes() for p in (tmp_path / "history").rglob("*") if p.is_file()}

    async def settlements(*args):
        return {"BTC": {"20240628": 110000}}
    monkeypatch.setattr(history, "update_settlements", settlements)
    result = asyncio.run(history_once.run(tmp_path, budget=0, now=NOW, client=object()))
    assert result == {"added": 0, "through": "2024-06-01"}
    assert all(p.read_bytes() == content for p, content in stored.items())
    doc = json.loads((tmp_path / "history" / "wallets.json").read_text())
    assert doc["schema_version"] == 2
    assert doc["as_of"] == datetime(2024, 6, 2, tzinfo=timezone.utc).timestamp()
    assert doc["wallets"]["alice"]["expired"] == 0
    assert doc["wallets"]["alice"]["option_pnl"] == 0

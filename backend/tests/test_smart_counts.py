"""Daily counts of the Smart options wallets for Reflex's drawer (derive/smart_counts.py, history_once.py, publish_site)."""
import json
from datetime import date, datetime, timezone

import history_once
from derive import history
from derive import smart_counts as SC
from derive.balance_history import TradeIVs, day_ts

DAY = "2026-10-26"
PREV = "2026-10-25"
CLOSES = {"BTC": {day_ts(DAY): 100_000.0}, "ETH": {day_ts(DAY): 4_000.0}, "SOL": {day_ts(DAY): 200.0}}


def _ivs():
    ivs = TradeIVs()
    ivs.add(DAY, [("BTC-20261225-50000-C", 1, 0.5), ("BTC-20261225-200000-C", 1, 0.5), ("BTC-20261225-90000-P", 1, 0.5),
                  ("ETH-20261225-2000-C", 1, 0.6), ("ETH-20261225-8000-P", 1, 0.6), ("SOL-20261225-100-C", 1, 0.7)], CLOSES)
    return ivs


def _row(wallet, name, buy=0.0, sell=0.0, bv=0.0):
    return {"wallet": wallet, "instrument": name, "buy_contracts": buy, "sell_contracts": sell, "buy_value_usd": bv,
            "sell_value_usd": 0.0}


CLASSES = {"0xa": {"class": "directional", "tier": "top"}, "0xb": {"class": "directional", "tier": "smart"},
           "0xc": {"class": "directional", "tier": "profitable"}, "0xd": {"class": "directional", "tier": "top"}}


def test_a_close_counts_the_smart_wallets_long_and_short_per_coin_and_overall():
    held = {("0xa", "BTC-20261225-50000-C"): 1.0,        # deep in the money: about +$100K of BTC delta
            ("0xb", "BTC-20261225-50000-C"): 0.5,        # long BTC ...
            ("0xb", "ETH-20261225-8000-P"): 20.0,        # ... and short ETH by more: short overall
            ("0xc", "BTC-20261225-50000-C"): 5.0,        # profitable tier, not Smart: left out
            ("0xd", "BTC-20261225-200000-C"): 0.0001,    # under $1,000 of delta: neither
            ("0xd", "SOL-20261225-100-C"): 30.0}         # SOL counts only in all coins
    row, smart = SC.close_row(DAY, CLASSES, held, {}, [], None, _ivs(), CLOSES)
    assert smart == {"0xa", "0xb", "0xd"}
    got = dict(zip(SC.COLUMNS, row))
    assert (got["btc"], got["eth"]) == (100_000.0, 4_000.0)
    assert (got["BTC.long"], got["BTC.short"]) == (2, 0)
    assert (got["ETH.long"], got["ETH.short"]) == (0, 1)
    assert (got["ALL.long"], got["ALL.short"]) == (2, 1), "0xa long; 0xb short overall; 0xd long from SOL"
    assert got["BTC.puts"] is None and got["ALL.puts"] is None, "the day before is unknown: no cohort for the puts"


def test_new_puts_are_the_previous_closes_smart_wallets_opening_long_puts():
    rows = [_row("0xa", "BTC-20261225-90000-P", buy=2, bv=3_000),        # opens 2 long puts: $3,000
            _row("0xb", "BTC-20261225-90000-P", buy=2, bv=2_000),        # buys back 2 sold puts: not new puts
            _row("0xc", "BTC-20261225-90000-P", buy=1, bv=1_000),        # not Smart the close before
            _row("0xa", "ETH-20261225-8000-P", buy=3, sell=1, bv=900)]   # nets 2 new of 3 bought: 2 x $300
    inst = {("0xa", "BTC-20261225-90000-P"): {"net": 2.0}, ("0xb", "BTC-20261225-90000-P"): {"net": 0.0},
            ("0xc", "BTC-20261225-90000-P"): {"net": 1.0}, ("0xa", "ETH-20261225-8000-P"): {"net": 2.0}}
    row, _ = SC.close_row(DAY, CLASSES, {}, inst, rows, {"0xa", "0xb"}, _ivs(), CLOSES)
    got = dict(zip(SC.COLUMNS, row))
    assert (got["BTC.puts"], got["ETH.puts"], got["ALL.puts"]) == (3_000, 600, 3_600)


def test_append_keeps_one_row_a_close_and_the_cohort_for_the_next_days_puts(tmp_path, monkeypatch):
    monkeypatch.setattr(SC, "_day_rows", lambda root, day: [_row("0xa", "BTC-20261225-90000-P", buy=1, bv=500)])
    scan = {"inst": {("0xa", "BTC-20261225-90000-P"): {"net": 1.0}}}
    assert SC.append(tmp_path, PREV, CLASSES, {}, scan, ivs=_ivs(), closes=CLOSES)
    assert SC.append(tmp_path, DAY, CLASSES, {}, scan, ivs=_ivs(), closes=CLOSES)
    assert not SC.append(tmp_path, DAY, CLASSES, {}, scan, ivs=_ivs(), closes=CLOSES), "a close is added once"
    doc = SC.read(tmp_path)
    assert [r[0] for r in doc["rows"]] == [PREV, DAY] and doc["through"] == DAY
    assert doc["rows"][0][SC.COLUMNS.index("BTC.puts")] is None
    assert doc["rows"][1][SC.COLUMNS.index("BTC.puts")] == 500
    assert doc["smart"] == ["0xa", "0xb", "0xd"]
    # After a missing close the cohort of the day before is unknown again.
    assert SC.append(tmp_path, "2026-10-28", CLASSES, {}, scan, ivs=_ivs(), closes=CLOSES)
    assert SC.read(tmp_path)["rows"][-1][SC.COLUMNS.index("BTC.puts")] is None
    assert SC.missing(tmp_path, "2026-10-30") == ["2026-10-29", "2026-10-30"]
    pub = SC.publish(tmp_path)
    assert set(pub) == {"schema", "columns", "through", "rows"} and len(pub["rows"]) == 3


def test_missing_closes_start_at_the_series_start(tmp_path):
    assert SC.missing(tmp_path, "2026-10-23") == ["2026-10-21", "2026-10-22", "2026-10-23"]
    assert SC.missing(tmp_path, "2026-10-01") == []
    assert SC.publish(tmp_path) is None
    assert history_once.SMART_COUNTS_START == SC.START


def test_the_history_job_is_due_while_closes_are_missing(tmp_path):
    now = datetime(2026, 10, 28, 3, tzinfo=timezone.utc).timestamp()
    history.save_state(tmp_path, {"done_through": "2026-10-27", "repaired": history_once.REPAIR,
                                  "surface": history_once.SURFACE_VERSION, "surface_through": "2026-10-27",
                                  "balance": history_once.BALANCE_VERSION})
    assert not history_once.is_due(tmp_path, now), "nothing classed yet"
    (tmp_path / "history" / "wallets.json").write_text("{}")
    assert history_once.is_due(tmp_path, now)
    (tmp_path / "history" / "smart_counts.json").write_text(json.dumps({"schema": 1, "through": "2026-10-27"}))
    assert not history_once.is_due(tmp_path, now)
    (tmp_path / "history" / "smart_counts.json").write_text(json.dumps({"schema": 1, "through": "2026-10-26"}))
    state = history.load_state(tmp_path)
    history.save_state(tmp_path, {**state, "smart_counts_failed_at": now - 3600})
    assert not history_once.is_due(tmp_path, now), "a failure waits a day"
    assert history_once.is_due(tmp_path, now + history_once.SMART_COUNTS_RETRY)


def test_the_counts_never_fail_the_history_step(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no volatility")
    monkeypatch.setattr(SC, "catch_up", boom)
    (tmp_path / "history").mkdir()
    (tmp_path / "history" / "wallets.json").write_text("{}")
    state = {"done_through": "2026-10-27", "repaired": history_once.REPAIR}
    now = datetime(2026, 10, 28, 3, tzinfo=timezone.utc).timestamp()
    assert history_once.smart_counts_step(tmp_path, state, settlements={}, built=None, now=now, left=100) is None
    assert history.load_state(tmp_path)["smart_counts_failed_at"] == now
    assert date.fromisoformat(state["done_through"]) == date(2026, 10, 27)

"""Exact trade reading (flow.read_exact) in both readers, and the one-time paging repair."""
import asyncio
import gzip
import json
from datetime import date, datetime, timezone

import history_once
from derive import flow, history

DAY = date(2026, 4, 8)
T0 = int(datetime(2026, 4, 8, tzinfo=timezone.utc).timestamp() * 1000)
NOW = datetime(2026, 4, 9, 2, tzinfo=timezone.utc).timestamp()


def legs_for(trades: int, name="HYPE-PERP", start=T0, span=86_400_000 - 1, prefix="t"):
    """Both legs of `trades` trades spread evenly over [start, start + span]."""
    out = []
    for i in range(trades):
        ts = start + span * i // max(1, trades - 1)
        for wallet, direction, role in (("0xA", "buy", "taker"), ("0xB", "sell", "maker")):
            out.append({"trade_id": f"{prefix}{i}", "timestamp": ts, "instrument_name": name, "direction": direction,
                        "trade_amount": "0.5", "trade_price": "40", "index_price": "40", "mark_price": "40",
                        "wallet": wallet if i % 3 else wallet + "x", "subaccount_id": 1, "liquidity_role": role,
                        "realized_pnl": "0", "trade_fee": "0.1", "tx_status": "settled"})
    return out


class Feed:
    """Derive's trade history with offset paging that, across a page boundary, repeats the last
    leg of one page and drops the final leg while the listed count stays right (always=True:
    every reading drops a leg, so nothing ever reconciles)."""

    def __init__(self, legs, always=False):
        self.legs, self.always, self.calls = legs, always, 0

    async def public(self, method, params):
        if method == "get_option_settlement_prices":
            return {"expiries": []}
        self.calls += 1
        sel = [t for t in self.legs if params["from_timestamp"] <= t["timestamp"] <= params["to_timestamp"]
               and ("instrument_name" not in params or t["instrument_name"] == params["instrument_name"])
               and ("instrument_type" not in params
                    or flow.kind_of(t["instrument_name"]) == params["instrument_type"])]
        sel.sort(key=lambda t: (-t["timestamp"], t["trade_id"], t["direction"]))
        size, page = params["page_size"], params["page"]
        pages = max(1, -(-len(sel) // size))
        shift = 1 if pages > 1 and page > 1 else 0
        got = sel[(page - 1) * size - shift: min(page * size - shift, len(sel) - (pages > 1))]
        if self.always and page == pages and got:
            got = got[:-1]
        return {"trades": got, "pagination": {"num_pages": pages, "count": len(sel)}}


def keys(legs):
    return sorted(flow.leg_key(t) for t in legs)


def test_both_readers_recover_a_leg_lost_at_a_page_boundary():
    feed_legs = legs_for(1603)  # 3206 legs on one day, as 2026-04-08 HYPE-PERP
    feed = Feed(feed_legs)
    # The old check (legs read == listed count) passed while one leg was missing.
    plain = asyncio.run(flow._pages(feed, {"instrument_type": "perp"}, T0, T0 + 86_400_000 - 1, None, 100, {}))
    assert len(plain[0]) == plain[1] == 3206 and len({flow.leg_key(t) for t in plain[0]}) == 3205
    anomalies = []
    day = asyncio.run(history.fetch_day(Feed(feed_legs), DAY, anomalies))
    assert keys(day) == keys(feed_legs) and not anomalies
    since = asyncio.run(flow.fetch_since(Feed(feed_legs), T0, T0 + 86_400_000 - 1))
    assert keys(since) == keys(feed_legs)


def test_fetch_since_six_hour_chunk_loses_no_leg():
    chunk = flow.RECOVERY_CHUNK_SECONDS * 1000
    feed_legs = legs_for(1500, start=T0, span=chunk - 1)
    got = asyncio.run(flow.fetch_since(Feed(feed_legs), T0, T0 + chunk - 1))
    assert keys(got) == keys(feed_legs)


def test_a_day_that_never_reconciles_is_written_noted_and_passed(tmp_path):
    feed = Feed(legs_for(1603), always=True)
    history_root = tmp_path
    history.save_state(history_root, {"done_through": "2026-04-07", "repaired": history_once.REPAIR})
    out = asyncio.run(history_once.run(history_root, budget=60, now=NOW, client=feed))
    assert out["through"] == "2026-04-08"
    assert (history_root / "history" / "days" / "2026-04-08.csv.gz").exists()
    noted = json.loads((history_root / "history" / "anomalies.json").read_text())["anomalies"]
    assert {(a["day"], a["query"]) for a in noted} == {("2026-04-08", "perp")}
    assert feed.calls <= flow.SLICE_MAX_CALLS + flow.MAX_PAGES


def _day_file(root, day, legs):
    history.write_day(root, day, history.day_rows(legs))
    return root / "history" / "days" / f"{day.isoformat()}.csv.gz"


def test_imbalanced_pairs_finds_the_unbalanced_instrument(tmp_path):
    good = legs_for(10, name="ETH-PERP", prefix="e")
    bad = legs_for(10, name="HYPE-PERP")[:-1]
    _day_file(tmp_path, DAY, good + bad)
    assert history.imbalanced_pairs(tmp_path) == [("2026-04-08", "HYPE-PERP")]


def test_repair_replaces_one_instruments_rows_and_keeps_the_rest_byte_identical(tmp_path):
    other = legs_for(40, name="ETH-PERP", prefix="e") + legs_for(5, name="ETH-20260424-2000-C", prefix="o")
    full = legs_for(1603)
    p = _day_file(tmp_path, DAY, other + full[:-1])  # one leg lost at a page boundary, as 2026-04-08
    before = [line for line in gzip.open(p, "rt").read().splitlines() if "HYPE-PERP" not in line]
    history.save_state(tmp_path, {"done_through": DAY.isoformat(), "repaired": "fractional_strikes",
                                  "surface": history_once.SURFACE_VERSION, "surface_through": DAY.isoformat(),
                                  "balance": history_once.BALANCE_VERSION})
    assert history.imbalanced_pairs(tmp_path) == [("2026-04-08", "HYPE-PERP")]
    assert history_once.is_due(tmp_path, NOW)
    feed = Feed(other + full)
    asyncio.run(history_once.run(tmp_path, budget=60, now=NOW, client=feed))
    assert history.imbalanced_pairs(tmp_path) == []
    after = gzip.open(p, "rt").read().splitlines()
    assert [line for line in after if "HYPE-PERP" not in line] == before
    net = sum(float(r["buy_contracts"]) - float(r["sell_contracts"])
              for r in history.read_day(p) if r["instrument"] == "HYPE-PERP")
    assert abs(net) < 1e-9
    state = history.load_state(tmp_path)
    assert state["repaired"] == "paging" and "repair_pending" not in state
    # The surface rows and balance closes rebuild from the repaired days.
    assert state.get("balance") != history_once.BALANCE_VERSION
    assert state.get("surface") == history_once.SURFACE_VERSION or "surface_pending" in state


def test_repair_is_resumable_and_keeps_the_job_due(tmp_path):
    for i, d in enumerate((date(2026, 4, 6), date(2026, 4, 7), DAY)):
        _day_file(tmp_path, d, legs_for(4, start=T0 - (2 - i) * 86_400_000, span=1000, prefix=f"d{i}")[:-1])
    history.save_state(tmp_path, {"done_through": DAY.isoformat(), "repaired": "fractional_strikes"})

    class Stop(Exception):
        pass

    class Breaks:  # fails on the second instrument read
        calls = 0

        async def public(self, method, params):
            self.calls += 1
            if self.calls > 1:
                raise Stop()
            return {"trades": [], "pagination": {"num_pages": 1, "count": 0}}

    try:
        asyncio.run(history_once.run(tmp_path, budget=60, now=NOW, client=Breaks()))
    except Stop:
        pass
    state = history.load_state(tmp_path)
    assert state["repairing"] == "paging" and len(state["repair_pending"]) == 2
    assert history_once.is_due(tmp_path, NOW)


def test_repairs_run_in_order():
    assert history_once.next_repair({}) == "fractional_strikes"
    assert history_once.next_repair({"repaired": "fractional_strikes"}) == "paging"
    assert history_once.next_repair({"repaired": "paging"}) is None


# -- an anomalous day is retried, and its gap is published until resolved (review item 4) -------

def test_an_unreconciled_day_is_queued_retried_and_published_as_a_gap(tmp_path):
    import publish_site
    full = legs_for(1603)
    history.save_state(tmp_path, {"done_through": "2026-04-07", "repaired": history_once.REPAIR})
    asyncio.run(history_once.run(tmp_path, budget=60, now=NOW, client=Feed(full, always=True)))
    p = tmp_path / "history" / "days" / "2026-04-08.csv.gz"
    state = history.load_state(tmp_path)
    assert state["done_through"] == "2026-04-08"
    assert [item[:2] for item in state["retry"]] == [["2026-04-08", "perp"]]
    legs_then = sum(int(r["maker_legs"]) + int(r["taker_legs"]) for r in history.read_day(p))
    assert legs_then == 3205  # one leg short
    traders = json.loads((tmp_path / "history" / "traders.json").read_text())
    assert traders["gaps"] == 1 and traders["gap_days"] == ["2026-04-08"]
    cov = publish_site.history_coverage(traders, NOW)
    assert cov["gaps"] == 1 and cov["gap_days"] == ["2026-04-08"]
    # Retried no sooner than its backoff; the job is due for it then.
    assert state["retry"][0][3] == NOW + history_once.RETRY_EVERY
    later = NOW + history_once.RETRY_EVERY + 1
    assert history_once.is_due(tmp_path, later)
    # A later run reads the day again; this time it reconciles, so the day is complete and the gap closes.
    asyncio.run(history_once.run(tmp_path, budget=60, now=later, client=Feed(full)))
    state = history.load_state(tmp_path)
    assert not state.get("retry")
    rows = history.read_day(p)
    assert sum(int(r["maker_legs"]) + int(r["taker_legs"]) for r in rows) == 3206
    traders = json.loads((tmp_path / "history" / "traders.json").read_text())
    assert traders["gaps"] == 0 and publish_site.history_coverage(traders, later)["gaps"] == 0


def test_a_retry_that_still_fails_keeps_the_file_and_the_gap(tmp_path):
    full = legs_for(1603)
    history.save_state(tmp_path, {"done_through": "2026-04-07", "repaired": history_once.REPAIR})
    asyncio.run(history_once.run(tmp_path, budget=60, now=NOW, client=Feed(full, always=True)))
    p = tmp_path / "history" / "days" / "2026-04-08.csv.gz"
    before = p.read_bytes()
    later = NOW + history_once.RETRY_EVERY + 1
    asyncio.run(history_once.run(tmp_path, budget=60, now=later, client=Feed(full, always=True)))
    assert p.read_bytes() == before
    item = history.load_state(tmp_path)["retry"][0]
    assert item[:3] == ["2026-04-08", "perp", 2] and item[3] > later
    assert json.loads((tmp_path / "history" / "traders.json").read_text())["gaps"] == 1

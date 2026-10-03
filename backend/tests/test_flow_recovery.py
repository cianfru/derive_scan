import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest

import flow_once
from derive import flow
from derive.client import DeriveClient


NOW = int(datetime(2026, 10, 3, 12, tzinfo=timezone.utc).timestamp())
START = NOW - 7 * 86400
GAP = NOW - 1800


def trade(tid="a", ts=GAP + 100, wallet="alice", role="taker"):
    return {"trade_id": tid, "timestamp": ts * 1000, "instrument_name": "BTC-20261030-100000-C",
            "direction": "buy", "trade_amount": "1", "trade_price": "3000", "index_price": "100000",
            "wallet": wallet, "subaccount_id": 1, "liquidity_role": role, "trade_fee": "1"}


def coverage(root, intervals):
    path = root / "flow" / "coverage_v2" / "2026-10-03.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    # Existing two-column coverage is upgraded when real recovery provenance is appended.
    path.write_text(flow._csv_text(("from_ms", "through_ms"), intervals))


def one_gap(root):
    coverage(root, [[START * 1000, GAP * 1000], [(GAP + 900) * 1000, NOW * 1000]])


def rows(root, directory):
    return [row for path in sorted((root / "flow" / directory).glob("*.csv"))
            for row in flow._read_rows(path)]


def client_for(feed, calls=None):
    def handler(request):
        params = json.loads(request.content)
        if calls is not None:
            calls.append(params)
        selected = [t for t in feed if params["from_timestamp"] <= t["timestamp"] <= params["to_timestamp"]]
        return httpx.Response(200, json={"result": {"trades": selected,
                              "pagination": {"num_pages": 1, "count": len(selected)}}})
    return DeriveClient("https://test/", transport=httpx.MockTransport(handler), retries=0)


def recover(root, feed, **kwargs):
    async def collect():
        client = client_for(feed)
        try:
            return await flow.recover_recent(client, root, NOW * 1000, **kwargs)
        finally:
            await client.close()
    return asyncio.run(collect())


def test_recovery_replaces_partial_buckets_and_is_idempotent(tmp_path):
    # Migration recorded only part of this bucket. Its earlier trade is absent from v2.
    coverage(tmp_path, [[START * 1000, GAP * 1000], [(GAP + 200) * 1000, NOW * 1000]])
    latest = trade("latest", GAP + 400)
    early = trade("early", GAP + 100)
    path = tmp_path / "flow" / "sides_v2" / "2026-10-03.csv"
    path.parent.mkdir()
    path.write_text(flow._csv_text(("bucket_ts", *flow.SIDE_FIELDS[1:]), flow.sides([latest], GAP)))
    legacy = tmp_path / "flow" / "sides" / "2026-10-02.csv"
    legacy.parent.mkdir()
    legacy.write_text("legacy data")
    state = tmp_path / "flow" / "state.json"
    state.write_text(json.dumps({"last_ms": latest["timestamp"], "keys_at_last": [flow.leg_key(latest)],
                                 "v2_checked_through": NOW * 1000}))

    result = recover(tmp_path, [early, latest, latest])
    assert result["ready"] and result["intervals"] == 1 and result["legs"] == 2
    assert sum(int(r["legs"]) for r in rows(tmp_path, "sides_v2")) == 2
    assert sum(float(r["buy_premium_usd"]) for r in rows(tmp_path, "sides_v2")) == 6000
    assert sum(int(r["legs"]) for r in rows(tmp_path, "wallets_v2")) == 2
    assert len(rows(tmp_path, "large")) == 2
    assert legacy.read_text() == "legacy data"
    markers = rows(tmp_path, "coverage_v2")
    assert markers[-1]["source"] == "public_trade_history_replay"
    assert int(markers[-1]["queried_at_ms"]) > 0
    assert recover(tmp_path, [early, latest])["intervals"] == 0

    # The next live read of the recovery watermark must not add the same trades again.
    async def live():
        client = client_for([early, latest])
        try:
            return await flow.update(client, tmp_path, NOW * 1000 + 1)
        finally:
            await client.close()
    assert asyncio.run(live())["legs"] == 0
    assert sum(int(r["legs"]) for r in rows(tmp_path, "sides_v2")) == 2


def test_recovery_counts_empty_intervals_and_excludes_current_bucket(tmp_path):
    calls = []
    async def collect():
        client = client_for([trade("current", NOW + 1)], calls)
        try:
            return await flow.recover_recent(client, tmp_path, (NOW + 60) * 1000, max_intervals=28)
        finally:
            await client.close()
    result = asyncio.run(collect())
    assert result["ready"] and result["legs"] == 0 and result["intervals"] == 28
    assert flow.window_coverage(tmp_path, NOW + 60, 7 * 86400)["ready"]
    assert all(p["to_timestamp"] < NOW * 1000 for p in calls)
    assert calls[0]["from_timestamp"] == (NOW - 6 * 3600) * 1000
    assert rows(tmp_path, "sides_v2") == []


def test_recovery_respects_market_maker_filter(tmp_path):
    one_gap(tmp_path)
    (tmp_path / "history").mkdir()
    (tmp_path / "history" / "wallets.json").write_text(json.dumps({"wallets": {"mm": {"class": "market_maker"}}}))
    recover(tmp_path, [trade(wallet="alice"), trade("b", wallet="mm")])
    assert sum(int(r["legs"]) for r in rows(tmp_path, "sides_v2")) == 1
    assert sum(int(r["legs"]) for r in rows(tmp_path, "wallets_v2")) == 2


def test_recovery_truncated_pagination_never_advances_coverage(tmp_path):
    one_gap(tmp_path)
    def handler(request):
        return httpx.Response(200, json={"result": {"trades": [trade()], "pagination": {"count": 2, "num_pages": 1}}})
    async def collect():
        client = DeriveClient("https://test/", transport=httpx.MockTransport(handler))
        try:
            return await flow.recover_recent(client, tmp_path, NOW * 1000)
        finally:
            await client.close()
    result = asyncio.run(collect())
    assert result["intervals"] == 0 and result["errors"]
    assert not result["ready"] and not flow.window_coverage(tmp_path, NOW, 86400)["ready"]
    assert rows(tmp_path, "sides_v2") == [] and rows(tmp_path, "wallets_v2") == []


def test_pending_recovery_replays_after_failure_without_double_counting(tmp_path, monkeypatch):
    one_gap(tmp_path)
    atomic = flow._atomic_text
    def interrupt(path, contents):
        if path.parent.name == "coverage_v2":
            raise OSError("interrupted before the coverage marker")
        return atomic(path, contents)
    monkeypatch.setattr(flow, "_atomic_text", interrupt)
    with pytest.raises(OSError):
        recover(tmp_path, [trade()])
    assert (tmp_path / "flow" / ".pending.json").exists()
    assert not flow.window_coverage(tmp_path, NOW, 86400)["ready"]
    monkeypatch.setattr(flow, "_atomic_text", atomic)
    assert flow.replay_pending(tmp_path)
    assert not flow.replay_pending(tmp_path)
    assert flow.window_coverage(tmp_path, NOW, 7 * 86400)["ready"]
    assert sum(int(r["legs"]) for r in rows(tmp_path, "wallets_v2")) == 1
    assert len(rows(tmp_path, "large")) == 1
    assert recover(tmp_path, [trade()])["intervals"] == 0


def test_live_pending_write_replays_before_network_retry(tmp_path, monkeypatch):
    atomic = flow._atomic_text
    def interrupt(path, contents):
        if path.name == "state.json":
            raise OSError("interrupted checkpoint")
        return atomic(path, contents)
    async def live():
        client = client_for([trade()])
        try:
            return await flow.update(client, tmp_path, NOW * 1000)
        finally:
            await client.close()
    monkeypatch.setattr(flow, "_atomic_text", interrupt)
    with pytest.raises(OSError):
        asyncio.run(live())
    monkeypatch.setattr(flow, "_atomic_text", atomic)
    assert asyncio.run(live())["legs"] == 0
    assert sum(int(r["legs"]) for r in rows(tmp_path, "sides_v2")) == 1


def test_query_deadline_does_not_commit_a_partial_interval(tmp_path):
    one_gap(tmp_path)
    class Slow:
        async def public(self, *args):
            await asyncio.sleep(1)
    result = asyncio.run(flow.recover_recent(Slow(), tmp_path, NOW * 1000, budget=.01))
    assert result["intervals"] == 0 and not result["ready"]
    assert rows(tmp_path, "sides_v2") == []


def test_fetch_page_limit_and_counts(tmp_path):
    class Paged:
        async def public(self, method, params):
            return {"trades": [trade(str(params["page"]))], "pagination": {"num_pages": 3, "count": 3}}
    with pytest.raises(RuntimeError, match="page limit"):
        asyncio.run(flow.fetch_since(Paged(), GAP * 1000, NOW * 1000, max_pages=2))
    assert len(asyncio.run(flow.fetch_since(Paged(), GAP * 1000, NOW * 1000, max_pages=3))) == 3


def test_missing_intervals_and_due_retry_without_options_snapshot(tmp_path):
    one_gap(tmp_path)
    state = tmp_path / "flow" / "state.json"
    state.write_text(json.dumps({"v2_checked_through": NOW * 1000, "last_ms": NOW * 1000}))
    assert flow.missing_intervals(tmp_path, NOW) == [(GAP * 1000, (GAP + 900) * 1000)]
    assert flow_once.is_due(tmp_path, NOW)
    recover(tmp_path, [])
    assert not flow_once.is_due(tmp_path, NOW + 1)
    assert flow_once.is_due(tmp_path, NOW + 900)


def test_live_failure_stays_due_while_independent_recovery_succeeds(tmp_path):
    requests = []
    def handler(request):
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(500)
        return httpx.Response(200, json={"result": {"trades": [], "pagination": {"num_pages": 0, "count": 0}}})
    async def collect():
        client = DeriveClient("https://test/", transport=httpx.MockTransport(handler), retries=0)
        try:
            return await flow_once.run(tmp_path, now=NOW, max_intervals=28, client=client)
        finally:
            await client.close()
    result = asyncio.run(collect())
    assert result["live"]["error"]
    assert result["recovery"]["ready"] and result["requests"] == 29
    assert flow_once.is_due(tmp_path, NOW)
    assert json.loads((tmp_path / "flow" / "status.json").read_text())["live"]["error"]


def test_newest_replay_after_live_failure_cannot_certify_an_unqueried_older_gap(tmp_path):
    old = NOW - 86400
    coverage(tmp_path, [[START * 1000, old * 1000]])
    state = tmp_path / "flow" / "state.json"
    state.write_text(json.dumps({"last_ms": old * 1000, "keys_at_last": [], "v2_checked_through": old * 1000}))
    latest = trade("latest", NOW - 100)
    calls = []
    def handler(request):
        params = json.loads(request.content)
        calls.append(params)
        if len(calls) == 1:
            return httpx.Response(500)
        selected = [latest] if params["from_timestamp"] <= latest["timestamp"] <= params["to_timestamp"] else []
        return httpx.Response(200, json={"result": {"trades": selected,
                              "pagination": {"num_pages": 1, "count": len(selected)}}})
    async def collect():
        client = DeriveClient("https://test/", transport=httpx.MockTransport(handler), retries=0)
        try:
            result = await flow_once.run(tmp_path, now=NOW, max_intervals=1, client=client)
            assert result["live"]["error"] and result["recovery"]["intervals"] == 1
            assert (await flow.update(client, tmp_path, NOW * 1000 + 1))["legs"] == 0
        finally:
            await client.close()
    asyncio.run(collect())
    assert calls[-1]["from_timestamp"] == latest["timestamp"]
    assert not flow.window_coverage(tmp_path, NOW, 86400)["ready"]
    assert flow.missing_intervals(tmp_path, NOW)
    assert flow_once.is_due(tmp_path, NOW)
    assert sum(int(r["legs"]) for r in rows(tmp_path, "wallets_v2")) == 1

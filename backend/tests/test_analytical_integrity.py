"""Regression cases from the analytical review, including old-data upgrades."""
import asyncio
import json

import httpx
import pytest

from derive import flow, signals
from derive.client import DeriveClient
from derive.implied import implied_by_expiry, option_levels
from derive.lean import alignment, options_lean, relative_skew, skew_reading, wallets_reading
from derive.history import parse_option
from publish_site import options_block, taker_sides

NOW = 1_791_000_000


def ticker(mark=100, contracts=100, observed=NOW):
    return {"M": mark, "I": mark, "t": observed * 1000, "f": .00001, "stats": {"oi": contracts}}


def engine(signal="LIGHT_LONG", **kwargs):
    return dict(signal=signal, signal_status="ready", data_status="ready", volume_status="ok",
                signal_bar_close_time=NOW, timeframe="4h", **kwargs)


def test_oi_uses_the_same_observations_and_contract_count():
    row = {"timeframe": "4h", "sparkline": [90] * 22 + [110, 100]}
    previous = {"mark": 110, "contracts": 100, "observed_at": NOW - 14400}
    saved = signals.attach_positioning(row, ticker(100, 120), previous)
    assert row["positioning"]["oi_trend"] == "SHORTING"
    assert row["positioning"]["price_change_pct"] == -9.09
    assert row["positioning"]["oi_change_pct"] == 20
    assert saved == {"mark": 100, "contracts": 120, "observed_at": NOW}
    signals.attach_positioning(row, ticker(110, 100), {**previous, "mark": 100})
    assert row["positioning"]["oi_value"] == 11000
    assert row["positioning"]["oi_change_pct"] == 0
    assert row["positioning"]["oi_trend"] == "STABLE"


@pytest.mark.parametrize("previous", [10000, None, {"mark": 100, "contracts": 100, "observed_at": NOW - 3 * 14400}])
def test_legacy_first_and_gapped_oi_are_unknown(previous):
    row = {"timeframe": "4h"}
    signals.attach_positioning(row, ticker(110), previous)
    assert row["positioning"]["oi_trend"] == "UNKNOWN"
    assert row["positioning"]["oi_change_pct"] is None


def test_out_of_order_oi_does_not_rewind_baseline():
    previous = {"mark": 100, "contracts": 100, "observed_at": NOW}
    row = {"timeframe": "4h"}
    assert signals.attach_positioning(row, ticker(observed=NOW - 1), previous) == previous
    assert row["positioning"]["oi_status"] != "ready"


def test_missing_core_evidence_never_confirms_or_admits_entries():
    row = engine(regime="ACCUM", zscore=.5, heat=20, confidence=95, bmsb_valid=True, heat_direction=1,
                 is_climax=False, btc_status="ready")
    context = dict(consensus={"consensus": "ACCUMULATION", "status": "ready"},
                   positioning={"funding_regime": "NEUTRAL"}, sentiment={"fear_greed_value": 30},
                   stablecoin={"trend": "STABLE"})
    full = signals.available_synthesis(row, **context)
    thin = signals.available_synthesis({**row, "volume_status": "thin"}, **context)
    condition = next(c for c in thin.conditions_detail if c["name"] == "no_climax")
    assert condition["status"] == "unknown" and not condition["met"]
    assert thin.conditions_met == full.conditions_met - 1
    assert thin.entry_blocked and thin.signal not in ("STRONG_LONG", "LIGHT_LONG", "ACCUMULATE")
    unknown = signals.available_synthesis({**row, "btc_status": "unavailable"}, **context)
    assert next(c for c in unknown.conditions_detail if c["name"] == "no_bear_div")["status"] == "unknown"


def test_consensus_excludes_unavailable_short_and_stale_histories():
    good = [engine(regime="MARKUP")] * 6
    excluded = [{**engine(regime="FLAT"), **override} for override in
                [{"data_status": "not enough data"}, {"signal_status": "unavailable"}, {"signal_bar_close_time": NOW - 50000}]] * 3
    result = signals.compute_consensus(good + excluded, NOW)
    assert result["consensus"] == "RISK-ON" and result["strength"] == 100
    assert result["counts"]["total"] == 6 and result["counts"]["universe"] == 15
    assert signals.compute_consensus(excluded, NOW)["status"] == "unavailable"


def test_skew_does_not_change_definition_when_history_grows():
    assert skew_reading([-.03] * 94 + [-.02], -.02) == -.5
    assert skew_reading([-.03] * 94 + [-.02, -.02], -.02) == -.5
    history = [[i * 900, None, None, None, -.03] for i in range(96)]
    assert relative_skew(history, 4, -.02)["percentile"] == 100
    assert relative_skew(history[::2], 4, -.02)["percentile"] is None


def test_options_need_both_fresh_skew_and_covered_flow_and_ignore_nondirectional_context():
    flow = {"coverage": {"ready": True}, "call": {"buy_premium_usd": 10000}}
    feature = {"rr25_30d": .02, "atm_iv_7d": .9, "atm_iv_30d": .3, "pc_oi_ratio": 10}
    reading = options_lean(feature, [], flow, observed_at=NOW, now=NOW)
    changed = options_lean({**feature, "atm_iv_7d": .1, "pc_oi_ratio": .1}, [], flow, observed_at=NOW, now=NOW)
    assert reading["score"] == changed["score"] == .75
    assert set(reading["parts"]) == {"skew", "flow"}
    assert options_lean(feature, [], {**flow, "coverage": {"ready": False}}, observed_at=NOW, now=NOW)["state"] is None
    assert options_lean(feature, [], flow, observed_at=NOW - 3600, now=NOW)["state"] is None


def test_unavailable_wait_is_not_neutral_alignment():
    row = {**engine("WAIT"), "signal_status": "unavailable"}
    result = alignment(engine("WAIT"), row, {}, [], {}, None, None, None, NOW, options_at=NOW)
    assert result["horizons"]["7d"]["engine"]["state"] is None
    assert result["horizons"]["30d"]["engine"]["state"] is None


def test_unquoted_wallet_exposure_does_not_assume_fifty_percent_iv():
    name = "BTC-20261009-100000-C"
    expiry = parse_option(name)[1]
    now = expiry - 3 * 86400
    positions = {name: {"smart": [3, 3, 3]}}
    result = wallets_reading(positions, {"ts": now, "expiries": {}}, 100000, now, 7)
    assert result["state"] is None and result["net_delta_usd"] is None and result["missing_positions"] == 3
    iv_only = {"ts": now, "expiries": {str(expiry): [[100000, 0, 0, .4, .4]]}}
    result = wallets_reading(positions, iv_only, 100000, now, 7)
    assert result["state"] is None and result["estimated_positions"] == 3
    assert result["estimated_gross_share"] == 1


def test_invalid_smile_uses_labelled_fallback():
    rows = [[k, 0, 0, v, v] for k, v in [(60, .5), (80, .5), (90, .5), (100, 1.2), (110, .5), (120, .5), (140, .5)]]
    expiry = NOW + 30 * 86400
    result = implied_by_expiry({"expiries": {str(expiry): rows}}, [{"expiry": expiry, "forward": 100, "atm_iv": .5}], NOW)[0]
    assert result["method"] == "atm" and result["quality"]["status"] == "invalid_curve"
    assert 98 < result["q"][2] < 100


def test_payout_minimum_belongs_to_one_expiry():
    near, far = NOW + 86400, NOW + 10 * 86400
    strikes = {"expiries": {str(near): [[80, 0, 50, .5, .5], [120, 80, 0, .5, .5]],
                            str(far): [[150, 1000, 1000, .5, .5]]}}
    result = option_levels(strikes, 100, NOW)
    assert result["max_pain_expiry"] == near and result["max_pain"] == 80
    assert result["by_expiry"] == [{"expiry": near, "max_pain": 80}, {"expiry": far, "max_pain": 150}]


def test_flow_catchup_uses_execution_buckets_and_preserves_legacy_data(tmp_path):
    end = NOW // 900 * 900
    root = tmp_path / "flow"
    root.mkdir()
    old = root / "sides" / "legacy.csv"
    old.parent.mkdir()
    old.write_text("legacy aggregates stay intact")
    start = end - 8 * 86400
    (root / "state.json").write_text(json.dumps({"last_ms": start * 1000, "keys_at_last": []}))
    def trade(tid, ts):
        return {"trade_id": tid, "wallet": "test", "subaccount_id": 1, "direction": "buy", "timestamp": ts * 1000,
                "instrument_name": "BTC-20261030-100000-C", "trade_amount": 1, "trade_price": 9000,
                "index_price": 100000, "liquidity_role": "taker"}
    feed = [trade("old", start + 60), trade("new", end - 900)]
    def handler(request):
        return httpx.Response(200, json={"result": {"trades": feed, "pagination": {"num_pages": 1}}})
    async def collect():
        client = DeriveClient("https://test/", transport=httpx.MockTransport(handler))
        try:
            await flow.update(client, tmp_path, end * 1000)
        finally:
            await client.close()
    asyncio.run(collect())
    windows = taker_sides(tmp_path, end)["BTC"]
    assert windows["24h"]["call"]["buy_premium_usd"] == 9000
    assert windows["7d"]["call"]["buy_premium_usd"] == 9000
    assert windows["7d"]["coverage"]["ready"]
    assert old.read_text() == "legacy aggregates stay intact"


def test_empty_collection_intervals_count_but_failed_queries_do_not(tmp_path):
    end = NOW // 900 * 900
    root = tmp_path / "flow"
    root.mkdir()
    (root / "state.json").write_text(json.dumps({"last_ms": (end - 86400) * 1000, "keys_at_last": []}))
    async def collect(fail=False):
        def handler(request):
            if fail:
                return httpx.Response(500)
            return httpx.Response(200, json={"result": {"trades": [], "pagination": {"num_pages": 1}}})
        client = DeriveClient("https://test/", transport=httpx.MockTransport(handler), retries=0)
        try:
            return await flow.update(client, tmp_path, end * 1000)
        finally:
            await client.close()
    with pytest.raises(Exception):
        asyncio.run(collect(True))
    assert not flow.window_coverage(tmp_path, end, 86400)["ready"]
    asyncio.run(collect())
    assert flow.window_coverage(tmp_path, end, 86400)["ready"]
    assert not flow.window_coverage(tmp_path, end, 7 * 86400)["ready"]
    assert not flow.window_coverage(tmp_path, end + 900, 86400)["ready"]


def test_publisher_withholds_stale_option_ranges(tmp_path):
    data, site = tmp_path / "data", tmp_path / "site"
    path = data / "v2_mainnet" / "BTC" / "latest.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"ts": NOW - 3600, "features": {"index_price": 100},
                               "expiries": [{"expiry": NOW + 7 * 86400, "forward": 100, "atm_iv": .5}]}))
    block = options_block(data, site, "BTC", NOW)
    assert block["status"] == "stale" and block["implied"] == [] and block["levels"] is None

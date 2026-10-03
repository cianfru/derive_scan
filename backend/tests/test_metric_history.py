"""Historical readings remain causal, truthful about gaps, and cheap to refresh."""
import csv
import json
import math

import pytest

from derive.candles import CandleCache, TF_SEC, last_closed_open
from derive import metric_history as mh
from derive.signals import process_symbol
from candle_snapshot import closed_candles

NOW = 1_791_000_000


def bars(tf, count, now=NOW, base=80_000):
    step = TF_SEC[tf]
    last = last_closed_open(tf, now)
    rows = []
    for ts in range(last - (count - 1) * step, last + 1, step):
        close = base * (1 + .1 * math.sin((ts + step) / 3_000_000))
        opening = base * (1 + .1 * math.sin(ts / 3_000_000))
        rows.append([ts * 1000, opening, max(opening, close) * 1.025,
                     min(opening, close) * .975, close, 10])
    return rows


@pytest.fixture
def cache(tmp_path):
    cache = CandleCache(tmp_path)
    for und, base in (("BTC", 80_000), ("ETH", 2600)):
        for tf, count in (("1d", 700), ("4h", 700), ("1w", 220)):
            cache.append(und, tf, bars(tf, count, base=base))
    return cache


def test_replay_matches_live_price_engines_at_each_closed_bar(cache):
    replay = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=3)
    for row in replay["rows"]:
        cutoff = row["ts"] * 1000
        data = closed_candles(cache.load("BTC", "1d"), "1d", cutoff)
        reference = process_symbol("BTC", "1d", data, cache.load("BTC", "1w"), data,
                                   cache.load("ETH", "1d"), cutoff)
        assert row["zscore"] == reference["zscore"]
        assert row["regime"] == reference["regime"]
        assert row["heat"] == reference["heat"]
        assert row["ribbon"] == reference["ribbon"]["state"]
        assert row["signal"] is row["unified_signal"] is row["funding_ann"] is row["oi_usd"] is None
        assert row["source"] == "reconstructed" and row["status"] == "ready"
        assert row["provenance"]["as_of"] == row["ts"]
    assert replay["coverage"]["samples"] == 3
    assert replay["coverage"]["requirements"] == {"regime_zscore_bars": 499, "ribbon_bars": 600, "heat_weekly_bars": 21}
    assert replay["cache"]["computed"] == 3
    assert not (cache.root.parent / "signals/state.pkl").exists()


def test_future_candles_do_not_change_history_and_new_tail_reuses_cache(cache, monkeypatch):
    original = mh.process_symbol
    calls = []
    monkeypatch.setattr(mh, "process_symbol", lambda *args: (calls.append(args[-1]), original(*args))[1])
    first = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=3)
    assert len(calls) == 3
    again = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=3)
    assert again["rows"] == first["rows"] and len(calls) == 3
    assert again["cache"]["reused"] == 3
    future = bars("1d", 1, now=NOW + TF_SEC["1d"])
    future[0][4] *= 1.5
    cache.append("BTC", "1d", future)
    causal = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=3)
    assert causal["rows"] == first["rows"] and len(calls) == 3
    tail = mh.build_engine_history(cache, "BTC", "1d", NOW + TF_SEC["1d"], max_samples=3)
    assert tail["cache"]["reused"] == 2 and tail["cache"]["computed"] == 1
    assert len(calls) == 4
    saved = json.loads((cache.root.parent / "metric_history/BTC/1d.json").read_text())
    assert len(saved["rows"]) == 3


def test_revised_reference_candle_invalidates_affected_rows(cache):
    first = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=3)
    path = cache.path("ETH", "1d")
    with path.open() as handle:
        rows = list(csv.reader(handle))
    rows[-1][4] = str(float(rows[-1][4]) * 1.01)
    with path.open("w") as handle:
        csv.writer(handle).writerows(rows)
    revised = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=3)
    assert revised["cache"]["computed"] == 1 and revised["cache"]["reused"] == 2
    assert revised["rows"][-1]["input_id"] != first["rows"][-1]["input_id"]


def test_warmup_and_unavailable_engines_are_gaps_not_neutral_readings(tmp_path):
    cache = CandleCache(tmp_path)
    cache.append("NEW", "1d", bars("1d", 300, base=10))
    cache.append("NEW", "1w", bars("1w", 10, base=10))
    row = mh.build_engine_history(cache, "NEW", "1d", NOW, max_samples=1)["rows"][0]
    assert row["status"] == "warming up"
    assert row["zscore"] is row["regime"] is row["heat"] is row["ribbon"] is None
    assert row["metric_status"] == {"zscore": "warming up", "regime": "warming up",
                                    "heat": "unavailable", "ribbon": "warmup"}
    cache.path("NEW", "1w").unlink()
    missing = mh.build_engine_history(cache, "NEW", "1d", NOW, max_samples=1)["rows"][0]
    assert "Weekly history missing" in missing["errors"] and missing["heat"] is None


def test_rcce_failure_does_not_publish_defaults(cache, monkeypatch):
    original = mh.process_symbol

    def failed(*args):
        result = original(*args)
        result.update(regime="FLAT", zscore=0, engine_errors=["RCCE"])
        return result

    monkeypatch.setattr(mh, "process_symbol", failed)
    row = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=1)["rows"][0]
    assert row["regime"] is row["zscore"] is None
    assert row["metric_status"]["regime"] == "unavailable" and row["heat"] is not None


def test_replay_exception_is_reported_without_fabricated_readings(cache, monkeypatch):
    def failed(*args):
        raise ValueError("invalid candle")

    monkeypatch.setattr(mh, "process_symbol", failed)
    row = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=1)["rows"][0]
    assert row["status"] == "unavailable" and row["errors"] == ["Price engine replay failed"]
    assert row["regime"] is row["zscore"] is row["heat"] is row["ribbon"] is None


def test_external_price_provenance_is_preserved(cache):
    native = bars("1d", 100)
    cache.path("BTC", "1d").unlink()
    cache.append("BTC", "1d", native)
    cache.write_backfill("BTC", "1d", bars("1d", 700)[:-100])
    status = cache.root.parent / "signals/status.json"
    status.parent.mkdir(parents=True)
    status.write_text(json.dumps({"backfill": {"BTC:1d": {"sources": ["okx", "coinbase BTC-USD spot"]}}}))
    row = mh.build_engine_history(cache, "BTC", "1d", NOW, max_samples=1)["rows"][0]
    price = row["provenance"]["price"]
    assert price["backfilled_bars"] == 600 and price["derive_bars"] == 100
    assert price["price_sources"] == ["derive index", "okx", "coinbase BTC-USD spot"]
    assert price["backfill_price_only"]


def test_recorded_rows_take_precedence_and_windows_are_bounded(cache):
    latest = last_closed_open("1d", NOW) + TF_SEC["1d"]
    replay = mh.build_engine_history(cache, "BTC", "1d", NOW,
                                     recorded_rows=[{"ts": latest, "signal": "WAIT"}], max_samples=3)
    assert len(replay["rows"]) == 2 and all(r["ts"] != latest for r in replay["rows"])
    assert replay["coverage"]["available_samples"] == 3
    daily = mh.build_engine_history(cache, "BTC", "1d", NOW)
    four_hour = mh.build_engine_history(cache, "BTC", "4h", NOW)
    assert len(daily["rows"]) == 120 and len(four_hour["rows"]) == 180
    assert all(r["ts"] <= NOW for r in daily["rows"] + four_hour["rows"])


def test_empty_history_and_bad_timeframe(tmp_path):
    assert mh.build_engine_history(CandleCache(tmp_path), "BTC", "1d", NOW)["rows"] == []
    with pytest.raises(ValueError, match="1d and 4h"):
        mh.build_engine_history(CandleCache(tmp_path), "BTC", "1w", NOW)

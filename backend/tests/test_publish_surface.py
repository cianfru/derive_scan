"""site-data surface/{UND}.json: gates, smoothing, past-year range, shape, has_surface."""
import json
import math
import shutil
from datetime import date, datetime, timedelta, timezone

import pytest

import publish_site
from derive import surface_history as sh
from publish_site import surface_block

START = date(2025, 1, 1)


def _write_csv(data, und, n, value, rec=None, overrides=None):
    """n daily rows; value(metric, i) gives a reading (None for a gap); halves track it closely."""
    rows = []
    for i in range(n):
        row = {"day": (START + timedelta(days=i)).isoformat(), "index": 100.0 + i, "index_src": "perp",
               "carry_day": 0.05, "carry_pairs": 5, "carry": 0.05, "points": 40, "contracts": 100.0, "rec_n": 0}
        for m in sh.METRICS:
            v = value(m, i)
            row[m] = v
            wobble = 0.002 * math.sin(i * 1.7 + len(m))
            row[f"{m}_a"] = None if v is None else v + wobble
            row[f"{m}_b"] = None if v is None else v - wobble
        if rec and i in rec:
            row.update({f"rec_{m}": v for m, v in rec[i].items()}, rec_n=96)
        row.update((overrides or {}).get(i, {}))
        rows.append(row)
    sh.append_rows(data / "history" / "surface" / f"{und}.csv", rows)


def _wave(m, i):
    base = {"atm7": 0.45, "atm30": 0.5, "atm90": 0.55, "rr7": -0.02, "rr30": -0.03}[m]
    return base + 0.08 * math.sin(i / 23) + 0.02 * math.sin(i / 5)


def test_shape_start_and_recorded_series(tmp_path):
    n = 400
    rec = {i: {"atm30": _wave("atm30", i) - 0.01, "rr30": _wave("rr30", i)} for i in range(n - 3, n)}
    # the first 40 days have no 30-day reading: the series starts once 30 trailing days are half covered
    _write_csv(tmp_path, "BTC", n, lambda m, i: None if i < 40 else _wave(m, i), rec=rec)
    doc = surface_block(tmp_path, "BTC", 1.8e9)
    assert set(doc) == {"und", "version", "generated_at", "status", "first_trade_day", "day0", "days", "index",
                        "traded", "recorded", "quality", "range_1y", "overlap"}
    assert doc["und"] == "BTC" and doc["version"] == 1 and doc["status"] == "ready" and doc["generated_at"] == int(1.8e9)
    assert doc["first_trade_day"] == "2025-01-01"
    start = datetime.fromtimestamp(doc["day0"], timezone.utc).date()
    assert start == START + timedelta(days=54)  # smoothed readings from day 40; 15 of the trailing 30 by day 54
    assert doc["days"] == n - 54 == len(doc["index"]) and all(len(v) == doc["days"] for v in doc["traded"].values())
    assert set(doc["traded"]) == set(sh.METRICS)
    assert doc["index"][0] == 154.0
    assert doc["recorded"]["from"] == doc["days"] - 3 and set(doc["recorded"]) == {"from", *sh.METRICS}
    assert doc["recorded"]["atm30"][-1] == round(rec[n - 1]["atm30"], 4) and doc["recorded"]["atm7"] == [None] * 3
    assert doc["overlap"]["atm30"]["days"] == 3 and doc["overlap"]["atm30"]["median_diff"] == -0.01
    for q in doc["quality"].values():
        assert set(q) == {"coverage", "reliability", "shown"} and q["shown"] and q["reliability"] >= 0.85
    for r in doc["range_1y"].values():
        assert set(r) == {"p10", "p50", "p90", "last", "pct"} and r["p10"] <= r["p50"] <= r["p90"] and 0 <= r["pct"] <= 100


def test_smoothing_skips_gaps_and_needs_three_values():
    assert sh.smooth([1, 2, None, 4, 5, None, None, None, 9]) == [None, 2.0, 3.0, 4.0, None, None, None, None, None]
    assert sh.smooth([1, 2, 3, 4, 5, 6])[-2:] == [4.5, 5.0]  # the newest end uses the days it has


def test_low_coverage_or_low_reliability_is_gated_out(tmp_path):
    def value(m, i):
        if m == "atm90" and i % 3:
            return None                       # one day in three: smoothed coverage well under 70%
        return _wave(m, i)

    noisy = {i: {"rr7_a": _wave("rr7", i) + (0.05 if i % 2 else -0.05), "rr7_b": _wave("rr7", i + 50)} for i in range(400)}
    _write_csv(tmp_path, "ETH", 400, value, overrides=noisy)
    doc = surface_block(tmp_path, "ETH", 1.8e9)
    assert doc["quality"]["atm90"]["coverage"] < 0.7 and not doc["quality"]["atm90"]["shown"]
    assert doc["quality"]["rr7"]["reliability"] < 0.85 and not doc["quality"]["rr7"]["shown"]
    assert set(doc["traded"]) == {"atm7", "atm30", "rr30"} and set(doc["range_1y"]) == {"atm7", "atm30", "rr30"}


def test_a_seam_with_recorded_quotes_hides_a_reading_after_14_days(tmp_path):
    for days, shown in ((13, True), (14, False)):
        data = tmp_path / str(days)
        rec = {i: {"atm30": _wave("atm30", i) + 0.05, "rr30": _wave("rr30", i) + 0.01} for i in range(400 - days, 400)}
        _write_csv(data, "BTC", 400, _wave, rec=rec)
        doc = surface_block(data, "BTC", 1.8e9)
        assert doc["overlap"]["atm30"] == {"days": days, "median_diff": 0.05}
        assert doc["quality"]["atm30"]["shown"] is shown and ("atm30" in doc["traded"]) is shown
        assert doc["quality"]["rr30"]["shown"]  # 1 point is within the 2-point RR limit


def test_past_year_range_uses_traded_readings_only(tmp_path):
    rec = {i: {"atm30": 3.0} for i in range(390, 400)}   # recorded far above anything traded
    _write_csv(tmp_path, "BTC", 400, _wave, rec=rec)
    doc = surface_block(tmp_path, "BTC", 1.8e9)
    r = doc["range_1y"]["atm30"]
    traded = [v for v in doc["traded"]["atm30"][-365:] if v is not None]
    assert r["p90"] <= max(traded) < 1 and r["last"] == traded[-1]
    assert r["pct"] == round(100 * sum(v < traded[-1] for v in traded) / len(traded), 1)
    assert doc["recorded"]["atm30"][-1] == 3.0


def test_sparse_when_nothing_passes(tmp_path):
    _write_csv(tmp_path, "ZEC", 200, lambda m, i: _wave(m, i) if i % 4 == 0 else None)
    doc = surface_block(tmp_path, "ZEC", 1.8e9)
    assert doc["status"] == "sparse" and doc["traded"] == {} and doc["range_1y"] == {} and doc["recorded"] is None
    assert doc["day0"] is None and doc["days"] == 0 and doc["index"] == []
    assert not any(q["shown"] for q in doc["quality"].values())
    assert surface_block(tmp_path, "SOL", 1.8e9) is None  # no CSV, no file


def test_series_ends_on_the_last_day_written(tmp_path):
    _write_csv(tmp_path, "BTC", 200, _wave)
    (tmp_path / "history" / "state.json").write_text(json.dumps({"surface_through": (START + timedelta(days=204)).isoformat()}))
    doc = surface_block(tmp_path, "BTC", 1.8e9)
    assert doc["traded"]["atm30"][-5:] == [None] * 5 and doc["index"][-5:] == [None] * 5


def test_has_surface_in_markets_and_coin_files(saved_site, tmp_path):
    data0, site0, now = saved_site
    markets = json.loads((site0 / "markets.json").read_text())
    assert all(c["has_surface"] is False for c in markets["coins"])
    assert not (site0 / "surface").exists()
    data, site = tmp_path / "data", tmp_path / "site"
    shutil.copytree(data0, data)
    _write_csv(data, "BTC", 400, _wave)
    _write_csv(data, "ETH", 400, lambda m, i: None if i % 3 else _wave(m, i))
    (site / "surface").mkdir(parents=True)
    (site / "surface" / "OLD.json").write_text("{}")
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(publish_site, "build_engine_history",
                   lambda *a, **k: {"rows": [], "coverage": {}})
        publish_site.build(data, site, now=now)
    markets = {c["und"]: c for c in json.loads((site / "markets.json").read_text())["coins"]}
    assert markets["BTC"]["has_surface"] is True and markets["ETH"]["has_surface"] is False
    assert markets["SOL"]["has_surface"] is False
    assert json.loads((site / "coins" / "BTC.json").read_text())["has_surface"] is True
    assert json.loads((site / "coins" / "ETH.json").read_text())["has_surface"] is False
    assert json.loads((site / "surface" / "ETH.json").read_text())["status"] == "sparse"
    assert sorted(p.name for p in (site / "surface").glob("*.json")) == ["BTC.json", "ETH.json"]

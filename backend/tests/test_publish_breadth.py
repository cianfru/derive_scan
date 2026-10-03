"""The daily regime mix across perps (markets.json breadth_1d)."""
import json
from collections import Counter, defaultdict

from publish_site import BREADTH_COLS, breadth_table, count_breadth


def _row(ts, regime, status="ready", regime_status="ready", **extra):
    return {"ts": ts, "regime": regime, "status": status, "metric_status": {"regime": regime_status}, **extra}


def test_only_ready_regimes_are_counted_in_column_order():
    breadth = defaultdict(Counter)
    count_breadth(breadth, [_row(1, "MARKUP"), _row(2, "REACC"), _row(2, "SOMETHING_NEW"),
                            _row(3, None), _row(3, "MARKUP", status="warming up", regime_status="warming up"),
                            _row(3, "CAP", regime_status="unavailable")])
    count_breadth(breadth, [_row(1, "MARKUP"), _row(2, "MARKDOWN"),
                            # a saved close filled from a ready replay counts like the replayed closes
                            _row(3, "ACCUM", status="not enough data", filled_from_replay=["regime", "zscore"]),
                            _row(4, "BLOWOFF", status="warming up", filled_from_replay=["heat", "heat_phase"])])
    table = breadth_table(breadth)
    assert table["cols"] == list(BREADTH_COLS) == ["MARKUP", "BLOWOFF", "REACC", "ACCUM", "CAP", "MARKDOWN", "FLAT"]
    assert table["rows"] == [[1, 2, 0, 0, 0, 0, 0, 0], [2, 0, 0, 1, 0, 0, 1, 1], [3, 0, 0, 0, 1, 0, 0, 0]]


def test_last_breadth_row_is_the_published_consensus(saved_site):
    _, site, _ = saved_site
    markets = json.loads((site / "markets.json").read_text())
    table = markets["breadth_1d"]
    assert table["cols"] == list(BREADTH_COLS) and len(table["rows"]) == 3
    assert [r[0] for r in table["rows"]] == sorted(r[0] for r in table["rows"])
    ts, *counts = table["rows"][-1]
    n = dict(zip(table["cols"], counts))
    consensus = markets["consensus_detail"]["1d"]
    assert ts == markets["bars"]["1d"] and consensus["status"] == "ready"
    expected = consensus["counts"]
    assert n["MARKUP"] == expected["markup"] and n["BLOWOFF"] == expected["blowoff"]
    assert n["MARKDOWN"] == expected["markdown"]
    assert n["ACCUM"] + n["REACC"] + n["CAP"] == expected["accum"]
    assert sum(counts) == expected["total"] == 3

"""Derive Scan's signal glue reproduces Reflex's own scanner on the same candles.

Fixtures come from research/make_reflex_fixtures.py, which runs Reflex's scanner._process_symbol,
compute_consensus, detect_divergence and decision_pipeline.evaluate_decision (commit in
reflex/SOURCE.md) on saved Derive candles for BTC, ETH and SOL.
"""
import gzip
import json
import math
from pathlib import Path

import numpy as np

from derive import signals as sig

FIX = Path(__file__).parent / "fixtures"
OURS_ONLY = {"underlying", "data_status", "volume_coverage", "volume_status", "ribbon"}


def _load():
    raw = json.load(gzip.open(FIX / "candles.json.gz", "rt"))
    candles = {u: {tf: {k: np.array(v) for k, v in d.items()} for tf, d in t.items()} for u, t in raw["candles"].items()}
    return raw["as_of"], candles, json.loads((FIX / "reflex_expected.json").read_text())


def _same(a, b, path=""):
    if isinstance(a, float) or isinstance(b, float):
        assert (a is None and b is None) or math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12), path
    elif isinstance(a, dict):
        assert set(a) == set(b), path
        for k in a:
            _same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            _same(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"


def test_engines_consensus_and_decisions_match_reflex():
    as_of, candles, expected = _load()
    ticker = dict(expected["ticker"], t=as_of * 1000)
    ctx = {k: (v, as_of) for k, v in expected["context"].items()}
    state = sig.fresh_state()
    for tf in ("4h", "1d"):
        exp = expected["timeframes"][tf]
        rows, engine_rows = [], {}
        for u in ("BTC", "ETH", "SOL"):
            c = candles[u]
            r = sig.process_symbol(u, tf, c[tf], c["1w"], candles["BTC"][tf], candles["ETH"][tf], as_of * 1000)
            assert r["volume_status"] == "ok"  # the volume override is Derive Scan's own; not exercised here
            sig.attach_positioning(r, ticker, None)
            rows.append(r)
        btc_regime = rows[0]["regime"]
        for r in rows:  # engine output as Reflex has it before synthesis (divergence included)
            engine_rows[r["underlying"]] = dict(r, divergence=sig.detect_divergence(r["regime"], btc_regime))
        consensus = sig.synthesize(rows, tf, ctx, state, {}, as_of)
        # Added quality fields do not alter the pinned baseline when all rows are eligible.
        baseline_consensus = {k: consensus[k] for k in exp["consensus"]}
        baseline_consensus["counts"] = {k: consensus["counts"][k] for k in exp["consensus"]["counts"]}
        _same(baseline_consensus, exp["consensus"], f"{tf}.consensus")
        for r in rows:
            u = r["underlying"]
            mine = sig.public_row(r)  # decision fields below come from the evaluated row itself
            engine = {k: v for k, v in engine_rows[u].items() if k in exp["engine"][u]}
            _same(json.loads(json.dumps(engine, default=float)), exp["engine"][u], f"{tf}.{u}.engine")
            assert set(exp["engine"][u]) <= set(engine_rows[u]) - OURS_ONLY
            decided = {k: r.get(k) for k in exp["decision"][u]}
            _same(decided, exp["decision"][u], f"{tf}.{u}.decision")
            assert mine["signal"] == exp["decision"][u]["signal"]

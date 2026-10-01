"""Build the golden fixtures for tests/test_signal_parity.py from Reflex's own code.

Run with Reflex's checkout (at the commit in reflex/SOURCE.md) and its dependencies:

    REFLEX_DIR=/path/to/RCCE_Scanner/backend python research/make_reflex_fixtures.py CANDLE_DIR

CANDLE_DIR is a data-branch checkout (candles/{UND}/{tf}.csv). Writes
tests/fixtures/candles.json.gz (the inputs) and tests/fixtures/reflex_expected.json
(Reflex's scanner._process_symbol, compute_consensus, detect_divergence and
decision_pipeline.evaluate_decision outputs on those inputs).
"""
from __future__ import annotations

import csv
import gzip
import json
import os
import sys
from pathlib import Path

import numpy as np

UNDS = ("BTC", "ETH", "SOL")
TFS = ("4h", "1d")
FIX = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
FIELDS = ("timestamp", "open", "high", "low", "close", "volume")
# Fixed decision time: 10 minutes after the newest 4H close in the fixture.
CONTEXT = {"global_metrics": {"btc_dominance": 58.6, "eth_dominance": 11.4, "total_market_cap": 2.9e12,
                              "alt_market_cap": 1.2e12},
           "sentiment": {"fear_greed_value": 74, "fear_greed_label": "Greed"},
           "stablecoin": {"trend": "STABLE", "change_7d_pct": -0.36, "total_cap": 2.58e11}}
TICKER = {"M": "100", "I": "100", "f": "0.0000125", "t": 0, "stats": {"oi": "1000", "v": "5000000"}}


def load(root: Path, und: str, tf: str, keep: int) -> dict:
    rows = list(csv.reader((root / "candles" / und / f"{tf}.csv").open()))[1:][-keep:]
    arr = np.array(rows, dtype=np.float64)
    return {f: arr[:, i] for i, f in enumerate(FIELDS)}


def plain(x):
    if isinstance(x, dict):
        return {str(k): plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [plain(v) for v in x]
    if isinstance(x, (np.floating, np.integer)):
        return x.item()
    if isinstance(x, np.bool_):
        return bool(x)
    return x


def main() -> None:
    root = Path(sys.argv[1])
    candles = {u: {tf: load(root, u, tf, 650) for tf in TFS} | {"1w": load(root, u, "1w", 210)} for u in UNDS}
    as_of = float(candles["BTC"]["4h"]["timestamp"][-1] / 1000 + 14_400 + 600)
    FIX.mkdir(parents=True, exist_ok=True)
    with gzip.open(FIX / "candles.json.gz", "wt") as f:
        json.dump({"as_of": as_of, "candles": {u: {tf: {k: v.tolist() for k, v in d.items()} for tf, d in t.items()}
                                                 for u, t in candles.items()}}, f)

    sys.path.insert(0, os.environ["REFLEX_DIR"])
    import scanner
    from decision_pipeline import evaluate_decision, new_state
    from signal_synthesizer import synthesize_signal

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from derive.signals import attach_positioning  # Derive's positioning source; same compute_positioning

    expected = {"as_of": as_of, "context": CONTEXT, "ticker": TICKER, "timeframes": {}}
    state = new_state()
    for tf in TFS:
        rows = []
        for u in UNDS:
            c = candles[u]
            r = scanner._process_symbol(f"{u}/USDT", tf, c[tf], c["1w"], candles["BTC"][tf], candles["ETH"][tf],
                                        as_of_ms=as_of * 1000)
            attach_positioning(r, TICKER, None)
            rows.append(r)
        consensus = scanner.compute_consensus(rows)
        btc_regime = next(r["regime"] for r in rows if r["symbol"] == "BTC/USDT")
        engine = {}
        for r in rows:
            r["divergence"] = scanner.detect_divergence(r["regime"], btc_regime)
            engine[r["symbol"].split("/")[0]] = plain({k: v for k, v in r.items()
                                                       if k not in ("cto", "expected_range", "input_metadata",
                                                                    "positioning", "symbol", "decision_input_id")})
        decided = {}
        for r in rows:
            context = dict(consensus=consensus, global_metrics=CONTEXT["global_metrics"], positioning=r.get("positioning"),
                           sentiment=CONTEXT["sentiment"], stablecoin=CONTEXT["stablecoin"],
                           cvd_trend="UNAVAILABLE", cvd_divergence=False, spot_dominance="NEUTRAL",
                           long_short_ratio=1.0, liquidation_24h_usd=0.0, etf_flow_usd=0.0, cb_premium=0.0,
                           has_coinglass=False, hl_consensus_trend="NEUTRAL", hl_consensus_confidence=0.0,
                           hl_consensus_net_ratio=0.0, has_hyperlens=False)
            metadata = {"funding": {"source": "derive", "observed_at": as_of},
                        "global_metrics": {"source": "market_totals", "observed_at": as_of},
                        "sentiment": {"source": "fear_greed", "observed_at": as_of},
                        "stablecoin": {"source": "stablecoin_supply", "observed_at": as_of}}
            evaluate_decision(r, context, state, as_of=as_of, metadata=metadata, synthesizer=synthesize_signal)
            decided[r["symbol"].split("/")[0]] = plain({k: r.get(k) for k in (
                "signal", "signal_status", "signal_reason", "signal_warnings", "conditions_met", "conditions_total",
                "signal_score", "entry_blocked", "regime_unstable")})
        expected["timeframes"][tf] = {"consensus": plain(consensus), "engine": engine, "decision": decided}
    (FIX / "reflex_expected.json").write_text(json.dumps(expected, indent=1, sort_keys=True))
    print("wrote", FIX)


if __name__ == "__main__":
    main()

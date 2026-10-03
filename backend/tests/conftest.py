import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def saved_site(tmp_path_factory):
    """App files built by publish_site from the saved Derive candles (BTC, ETH, SOL).

    The signal job's steps run on those candles at the saved time; every daily candle is
    published (long-history checks) and the price replay is limited to a few closes for speed.
    Returns (data dir, site dir, now).
    """
    import numpy as np

    import publish_site
    import signal_once
    from derive import signals as sig
    from derive.candles import CandleCache
    from derive.metric_history import build_engine_history

    raw = json.load(gzip.open(FIX / "candles.json.gz", "rt"))
    expected = json.loads((FIX / "reflex_expected.json").read_text())
    as_of = raw["as_of"]
    data = tmp_path_factory.mktemp("saved") / "data"
    cache = CandleCache(data)
    for und, frames in raw["candles"].items():
        for tf, c in frames.items():
            cache.append(und, tf, np.column_stack([c[k] for k in ("timestamp", "open", "high", "low", "close", "volume")]).tolist())
    unds = sorted(raw["candles"])
    ticker = dict(expected["ticker"], t=as_of * 1000)
    context = {k: (v, as_of) for k, v in expected["context"].items()}
    state, computed, blocks = sig.fresh_state(), {}, {}
    for tf in ("1d", "4h"):  # a first run computes the daily rows first, as signal_once does
        rows = []
        for und in unds:
            r = sig.process_symbol(und, tf, cache.load(und, tf), cache.load(und, "1w"),
                                   cache.load("BTC", tf), cache.load("ETH", tf), as_of * 1000)
            sig.attach_positioning(r, ticker, None)
            rows.append(r)
        other = {r["symbol"]: r for r in computed.get("1d" if tf == "4h" else "4h", [])}
        consensus = sig.synthesize(rows, tf, context, state, other, as_of)
        computed[tf] = rows
        bar_close = int(rows[0]["signal_bar_close_time"])
        blocks[tf] = {"bar_close": bar_close, "consensus": consensus, "skipped": {}}
    sig.attach_unified(computed["4h"], computed["1d"], as_of)
    for tf, rows in computed.items():
        day = datetime.fromtimestamp(blocks[tf]["bar_close"], timezone.utc).date().isoformat()
        signal_once.append_csv(data / "signals" / tf / f"{day}.csv", [signal_once._csv_row(r) for r in rows])
        blocks[tf]["rows"] = [sig.public_row(r) for r in rows]
    latest = {"universe": [f"{u}-PERP" for u in unds], "timeframes": blocks,
              "context": {**{k: v for k, v in expected["context"].items()},
                          **{f"{k}_at": as_of for k in expected["context"]}}}
    (data / "signals" / "latest.json").write_text(json.dumps(latest, default=float))
    site = data.parent / "site"
    now = as_of + 60
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(publish_site, "CANDLES_KEEP", {"4h": 500, "1d": 1000})
        mp.setattr(publish_site, "build_engine_history",
                   lambda *args, **kwargs: build_engine_history(*args, **kwargs, max_samples=3))
        publish_site.build(data, site, now=now)
    return data, site, now

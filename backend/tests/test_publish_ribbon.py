"""The published ribbon trail: one state per daily candle, agreeing with the engine's snapshot."""
import gzip
import json
from pathlib import Path

import numpy as np

from derive.signals import ribbon_trail
from engines.larsson_engine import CHART_WARMUP, compute_larsson_snapshot

FIX = Path(__file__).parent / "fixtures"
DAY_MS = 86_400_000


def _btc_daily():
    raw = json.load(gzip.open(FIX / "candles.json.gz", "rt"))
    return raw["as_of"], {k: np.array(v) for k, v in raw["candles"]["BTC"]["1d"].items()}


def test_trail_skips_the_warm_up_and_the_bar_in_progress():
    as_of, daily = _btc_daily()
    opens = [int(t // 1000) for t in daily["timestamp"]]
    trail = ribbon_trail(daily, "1d", as_of * 1000)
    assert CHART_WARMUP == 174 and len(opens) > 600
    assert list(trail) == opens[CHART_WARMUP:]
    assert set(trail.values()) <= {"gold", "blue", "grey"}
    snapshot = compute_larsson_snapshot(daily, "1d", as_of * 1000)
    assert snapshot["data_quality"] == "ready" and trail[opens[-1]] == snapshot["state"]
    # Before the newest bar has closed it is left out, exactly as the snapshot leaves it out.
    early = ribbon_trail(daily, "1d", daily["timestamp"][-1] + DAY_MS - 1)
    assert opens[-1] not in early and early[opens[-2]] == trail[opens[-2]]
    assert ribbon_trail(None, "1d", as_of * 1000) == {}


def test_coin_file_has_one_ribbon_character_per_daily_candle(saved_site):
    _, site, _ = saved_site
    for und in ("BTC", "ETH", "SOL"):
        coin = json.loads((site / "coins" / f"{und}.json").read_text())
        ribbon, candles = coin["ribbon"]["1d"], coin["candles"]["1d"]
        assert len(ribbon) == len(candles) > 600
        assert ribbon[:CHART_WARMUP] == "-" * CHART_WARMUP
        assert set(ribbon[CHART_WARMUP:]) <= set("gbn")
        latest = coin["latest"]["1d"]["ribbon"]
        assert latest["data_quality"] == "ready"
        assert ribbon[-1] == {"gold": "g", "blue": "b", "grey": "n"}[latest["state"]]
    assert "larsson" not in (site / "coins" / "BTC.json").read_text().lower()


def test_coin_file_carries_the_engine_context(saved_site):
    _, site, now = saved_site
    markets = json.loads((site / "markets.json").read_text())
    coin = json.loads((site / "coins" / "ETH.json").read_text())
    ctx = coin["engine_context"]
    assert set(ctx) == {"consensus", "btc_regime", "fear_greed", "stablecoin_7d_pct", "observed_at"}
    assert ctx["consensus"] == markets["consensus_detail"]
    assert ctx["btc_regime"]["1d"] == json.loads((site / "coins" / "BTC.json").read_text())["latest"]["1d"]["regime"]
    assert set(ctx["btc_regime"]) == {"4h", "1d"}
    assert ctx["fear_greed"] == markets["context"]["sentiment"]["fear_greed_value"] == 74
    assert ctx["stablecoin_7d_pct"] == markets["context"]["stablecoin"]["change_7d_pct"]
    assert ctx["observed_at"]["sentiment"] == markets["context"]["sentiment_at"]
    assert ctx["observed_at"]["consensus"] == markets["bars"]

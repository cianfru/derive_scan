"""Reflex's signals computed on Derive's candles.

The engines, synthesizer, decision pipeline and agent filters are Reflex's own files, copied
unchanged into backend/reflex (commit in reflex/SOURCE.md). This module is the glue Reflex
keeps in scanner.py: per-symbol engine run and merge (`_process_symbol`), consensus,
BTC divergence, positioning (`_attach_positioning`) and the per-timeframe synthesis loop
(`_synthesize_and_enrich`). It follows that code; the differences are Derive's:

- Symbols are Derive perps ("BTC-PERP"). Price is Derive's index, volume the perp's trades.
- Positioning comes from Derive's own funding and open interest (no Binance, Hyperliquid,
  Bybit or CoinGlass). HyperLens and CoinGlass inputs are absent, as in Reflex without them.
- Volume: where most recent bars have no trades, the volume-based exhaustion flags are set
  to unavailable instead of being read from empty bars (owner's decision, docs/signal-port.md).
- The CTO overlay and the range forecast are not computed; the CTO runs in shadow mode in
  Reflex by default and does not change the signal.
- Also reported, outside the signal path as in Reflex: the four-EMA ribbon (Reflex's
  larsson_engine), as a snapshot per row and as a per-bar trail for the chart. Its outputs
  are named "ribbon" here.
"""
from __future__ import annotations

import copy
import logging
from typing import List, Optional

import numpy as np

import reflex  # noqa: F401  (puts the copied Reflex code on the path)
from candle_snapshot import TF_MS, closed_candles, consistent_weekly, snapshot_key  # noqa: E402
from confluence import compute_confluence, unified_signal  # noqa: E402
from decision_pipeline import evaluate_decision, new_state  # noqa: E402
from engines.exhaustion_engine import compute_exhaustion  # noqa: E402
from engines.heatmap_engine import compute_heatmap  # noqa: E402
from engines.larsson_engine import compute_larsson_chart, compute_larsson_snapshot  # noqa: E402
from engines.positioning_engine import compute_positioning  # noqa: E402
from engines.rcce_engine import LEN_LONG, compute_rcce  # noqa: E402
from signal_synthesizer import synthesize_signal, enforce_signal_constraints  # noqa: E402

from .quality import ANALYTICS_VERSION, TF_SECONDS, engine_status, number

log = logging.getLogger(__name__)

MEME_TOKENS = {"DOGE", "SHIB", "PEPE", "WIF", "BONK", "FLOKI", "MEME"}
_ACCUM_FAMILY = {"ACCUM", "CAP", "REACC"}
# Volume-based exhaustion flags need traded volume on most recent bars.
VOLUME_WINDOW = 100
VOLUME_MIN_COVERAGE = 0.9


def symbol_of(und: str) -> str:
    return f"{und}-PERP"


def classify_asset(und: str) -> str:
    if und == "BTC":
        return "BTC"
    if und == "ETH":
        return "ETH"
    if und in MEME_TOKENS:
        return "MEME"
    return "ALT"


def data_status(history_bars: int, normalization_ready: bool) -> str:
    """'ready', 'warming up' (z-scores damped by Reflex's engine) or 'not enough data'."""
    if history_bars < LEN_LONG:
        return "not enough data"
    return "ready" if normalization_ready else "warming up"


def volume_coverage(ohlcv: dict) -> float:
    v = np.asarray(ohlcv["volume"][-VOLUME_WINDOW:], dtype=np.float64)
    return float((v > 0).mean()) if len(v) else 0.0


# -- per symbol (Reflex scanner._process_symbol) --------------------------------
def process_symbol(und: str, timeframe: str, ohlcv: dict, weekly: Optional[dict],
                   btc_data: Optional[dict], eth_data: Optional[dict], as_of_ms: float) -> dict:
    symbol = symbol_of(und)
    live_price = float(ohlcv["close"][-1])
    ribbon_state = ribbon(ohlcv, timeframe, as_of_ms)  # on the full history: its EMAs need 600+ bars
    ohlcv = closed_candles(ohlcv, timeframe, as_of_ms)
    weekly = closed_candles(weekly, "1w", as_of_ms)
    btc_data = closed_candles(btc_data, timeframe, as_of_ms)
    eth_data = closed_candles(eth_data, timeframe, as_of_ms)
    ohlcv = {k: v[-599:] for k, v in ohlcv.items()}
    weekly = consistent_weekly(weekly, ohlcv, timeframe)
    weekly = {k: v[-199:] for k, v in weekly.items()} if weekly is not None else None
    btc_data = {k: v[-599:] for k, v in btc_data.items()} if btc_data is not None else None
    eth_data = {k: v[-599:] for k, v in eth_data.items()} if eth_data is not None else None
    if len(ohlcv["close"]) == 0:
        raise ValueError("No completed candles available")
    engine_errors = [] if weekly is not None else ["Weekly history missing"]

    rcce: dict = {}
    try:
        rcce = compute_rcce(ohlcv, btc_data, eth_data)
    except Exception:
        engine_errors.append("RCCE")
        log.exception("RCCE engine failed for %s (%s)", symbol, timeframe)
    heatmap: dict = {}
    if weekly is not None:
        try:
            heatmap = compute_heatmap(ohlcv, weekly)
        except Exception:
            engine_errors.append("Heatmap")
            log.exception("Heatmap engine failed for %s (%s)", symbol, timeframe)
    exhaustion: dict = {}
    if weekly is not None:
        try:
            exhaustion = compute_exhaustion(ohlcv, weekly)
        except Exception:
            engine_errors.append("Exhaustion")
            log.exception("Exhaustion engine failed for %s (%s)", symbol, timeframe)

    previous_heat = None
    if len(ohlcv["close"]) >= 2 and weekly is not None:
        previous_close_ms = float(ohlcv["timestamp"][-2]) + TF_MS[timeframe]
        try:
            previous = compute_heatmap({k: v[:-1] for k, v in ohlcv.items()},
                                       closed_candles(weekly, "1w", previous_close_ms))
            if previous.get("bmsb_mid", 0):
                previous_heat = previous.get("heat")
        except Exception:
            log.warning("Previous heat unavailable for %s (%s)", symbol, timeframe)

    coverage = volume_coverage(ohlcv)
    volume_ok = coverage >= VOLUME_MIN_COVERAGE
    if not volume_ok and exhaustion:
        exhaustion = dict(exhaustion, is_climax=False, is_absorption=False, floor_confirmed=False, rel_vol=0.0, state="UNAVAILABLE")

    history_bars = int(rcce.get("data_bars", len(ohlcv["close"])))
    normalization_ready = bool(rcce.get("normalization_ready", False))
    result: dict = {
        "symbol": symbol,
        "underlying": und,
        "timeframe": timeframe,
        "price": live_price,
        "decision_price": float(ohlcv["close"][-1]),
        "decision_input_id": snapshot_key(ohlcv, timeframe, weekly, btc_data, eth_data, as_of_ms=as_of_ms),
        "signal_bar_close_time": (float(ohlcv["timestamp"][-1]) + TF_MS[timeframe]) / 1000,
        "previous_heat": previous_heat,
        "structure": {"swing_low": float(min(ohlcv["low"][-10:])),
                      "swing_high": float(max(ohlcv["high"][-10:])), "lookback_bars": 10},
        "bmsb_valid": bool(heatmap.get("bmsb_mid", 0)),
        "engine_errors": engine_errors,
        "signal_status": "unavailable" if engine_errors else "ready",
        "regime": rcce.get("regime", "FLAT"),
        "confidence": round(rcce.get("confidence", 0), 1),
        "regime_probability": round(rcce.get("confidence", 0), 1),
        "raw_signal": rcce.get("raw_signal", "WAIT"),
        "signal": "WAIT",
        "signal_reason": "",
        "signal_warnings": [],
        "zscore": round(rcce.get("z_score", 0), 3),
        "energy": round(rcce.get("energy", 0), 3),
        "vol_state": rcce.get("vol_state", "MID"),
        "momentum": round(rcce.get("momentum", 0), 2),
        "vol_scale": rcce.get("vol_scale", 1.0),
        "divergence": None,
        "asset_class": classify_asset(und),
        "heat": heatmap.get("heat", 0),
        "heat_direction": heatmap.get("direction", 0),
        "heat_phase": heatmap.get("phase", "Neutral"),
        "atr_regime": heatmap.get("atr_regime", "Normal"),
        "deviation_pct": round(heatmap.get("deviation_pct", 0), 2),
        "exhaustion_state": exhaustion.get("state", "NEUTRAL"),
        "floor_confirmed": exhaustion.get("floor_confirmed", False),
        "is_absorption": exhaustion.get("is_absorption", False),
        "is_climax": exhaustion.get("is_climax", False),
        "effort": round(exhaustion.get("effort", 0), 3),
        "rel_vol": round(exhaustion.get("rel_vol", 0), 2),
        "sparkline": [round(float(c), 6) for c in ohlcv["close"][-24:]],
        "deviation_abs": round(heatmap.get("deviation_abs", 0), 4),
        "bmsb_mid": round(heatmap.get("bmsb_mid", 0), 4),
        "r3": round(heatmap.get("r3", 0), 4),
        "dist_pct": round(exhaustion.get("dist_pct", 0), 4),
        "w_bmsb": round(exhaustion.get("w_bmsb", 0), 4),
        "beta_btc": round(rcce.get("beta_btc", 0), 4),
        "beta_eth": round(rcce.get("beta_eth", 0), 4),
        "atr_ratio": round(rcce.get("atr_ratio", 0), 3),
        "regime_transition": rcce.get("regime_transition"),
        "history_bars": history_bars,
        "normalization_ready": normalization_ready,
        "regime_probabilities": rcce.get("regime_probabilities", {}),
        "cool_off": rcce.get("cool_off", {"active": False}),
        # Derive Scan additions
        "data_status": data_status(history_bars, normalization_ready),
        "volume_coverage": round(coverage, 3),
        "volume_status": "ok" if volume_ok else "thin",
        "ribbon": ribbon_state,
    }
    return result


def ribbon(ohlcv: dict, timeframe: str, as_of_ms: float) -> dict:
    snap = compute_larsson_snapshot(ohlcv, timeframe, as_of_ms)
    snap.pop("version", None)
    return snap


def ribbon_trail(ohlcv: dict | None, timeframe: str, as_of_ms: float) -> dict[int, str]:
    """Ribbon state of every completed bar: {bar open (unix seconds): 'gold' | 'blue' | 'grey'}.

    Reads the full closed history, as `ribbon` does, so the newest bar agrees with the
    snapshot. Bars inside the chart warm-up (3 x 58 bars, Reflex's chart rule) are absent.
    """
    closed = closed_candles(ohlcv, timeframe, as_of_ms)
    if closed is None or not len(closed["close"]):
        return {}
    try:
        chart = compute_larsson_chart(closed["close"], closed["timestamp"])
    except ValueError:
        return {}
    return dict(zip(chart["time"], chart["state"]))


# -- market-wide (Reflex scanner.compute_consensus, detect_divergence) ----------
def compute_consensus(results: List[dict], as_of: float | None = None) -> dict:
    universe = len(results)
    results = [r for r in results if engine_status(r, as_of) == "ready"]
    total = len(results)
    if total == 0:
        return {"consensus": "MIXED", "strength": 0.0, "counts": {"total": 0, "universe": universe}, "status": "unavailable"}
    markup_n = blowoff_n = markdown_n = accum_n = 0
    for r in results:
        regime = r.get("regime", "FLAT").upper()
        if regime == "MARKUP":
            markup_n += 1
        elif regime == "BLOWOFF":
            blowoff_n += 1
        elif regime == "MARKDOWN":
            markdown_n += 1
        elif regime in _ACCUM_FAMILY:
            accum_n += 1
    counts = {"markup": markup_n, "blowoff": blowoff_n, "markdown": markdown_n, "accum": accum_n, "total": total, "universe": universe}
    if markup_n / total > 0.55:
        consensus, strength = "RISK-ON", markup_n / total * 100.0
    elif blowoff_n / total > 0.55:
        consensus, strength = "EUPHORIA", blowoff_n / total * 100.0
    elif markdown_n / total > 0.55:
        consensus, strength = "RISK-OFF", markdown_n / total * 100.0
    elif accum_n / total > 0.55:
        consensus, strength = "ACCUMULATION", accum_n / total * 100.0
    else:
        consensus = "MIXED"
        strength = max(markup_n, blowoff_n, markdown_n, accum_n) / total * 100.0
    return {"consensus": consensus, "strength": round(strength, 1), "counts": counts, "status": "ready"}


def detect_divergence(symbol_regime: str, btc_regime: str) -> Optional[str]:
    sym, btc = symbol_regime.upper(), btc_regime.upper()
    if sym in ("MARKUP", "REACC") and btc == "MARKDOWN":
        return "BEAR-DIV"
    if sym in ("MARKDOWN", "CAP") and btc == "MARKUP":
        return "BULL-DIV"
    return None


# -- positioning (Reflex scanner._attach_positioning, Derive as the source) -----
def attach_positioning(result: dict, ticker: Optional[dict], previous: dict | float | None) -> dict | None:
    """Compare contract OI and mark over the same two ticker observations.

    Legacy dollar-only state cannot establish an interval; the first v2 observation seeds it.
    The pinned engine still receives dollar OI for display, with an explicit contract-change override.
    """
    metadata = result.setdefault("input_metadata", {})
    if not ticker:
        metadata["funding"] = {"source": None, "observed_at": None}
        result.pop("positioning", None)
        return previous if isinstance(previous, dict) else None
    mark, index = number(ticker.get("M")), number(ticker.get("I"))
    funding = number(ticker.get("f"))
    stats = ticker.get("stats") or {}
    contracts, observed_ms = number(stats.get("oi")), number(ticker.get("t"))
    observed = observed_ms / 1000 if observed_ms and observed_ms > 0 else None
    metadata["funding"] = {"source": "derive", "observed_at": observed if funding is not None else None}
    valid = mark is not None and mark > 0 and contracts is not None and contracts >= 0 and observed is not None
    current = {"contracts": contracts, "mark": mark, "observed_at": observed} if valid else None
    prior = previous if isinstance(previous, dict) else {}
    elapsed = observed - prior["observed_at"] if observed and prior.get("observed_at") else None
    step = TF_SECONDS.get(result.get("timeframe"), 14400)
    comparable = (valid and elapsed is not None and 0 < elapsed <= step + 1800
                  and prior.get("contracts", 0) > 0 and prior.get("mark", 0) > 0)
    change = (contracts / prior["contracts"] - 1) * 100 if comparable else None
    price_change = (mark / prior["mark"] - 1) * 100 if comparable else None
    status = "ready" if comparable else "missing" if not valid else "initial" if not prior else "gap"
    pos = compute_positioning(funding_rate=funding or 0.0, open_interest=(contracts or 0) * (mark or 0),
                              price_change_pct=price_change or 0.0, oi_change_pct_override=change,
                              mark_price=mark or 0.0, oracle_price=index or 0.0,
                              volume_24h=number(stats.get("v")) or 0.0)
    result["positioning"] = {
        "funding_regime": pos.funding_regime if funding is not None else None, "funding_rate": funding,
        "oi_trend": pos.oi_trend, "oi_value": pos.oi_value if valid else None,
        "oi_contracts": contracts, "oi_change_pct": round(change, 2) if change is not None else None,
        "price_change_pct": round(price_change, 2) if price_change is not None else None,
        "oi_status": status, "interval_seconds": elapsed, "observed_at": observed,
        "previous_observed_at": prior.get("observed_at"), "oi_change_basis": "contracts",
        "leverage_risk": pos.leverage_risk, "predicted_funding": pos.predicted_funding,
        "mark_price": pos.mark_price, "volume_24h": pos.volume_24h,
        "source": "derive", "source_map": {"funding": "derive", "oi": "derive", "volume": "derive"},
        "liquidation_24h_usd": 0.0, "long_liq_usd": 0.0, "short_liq_usd": 0.0, "liquidation_4h_usd": 0.0,
        "liquidation_1h_usd": 0.0, "long_short_ratio": 1.0, "top_trader_lsr": 1.0, "oi_market_cap_ratio": 0.0,
        "spot_volume_usd": 0.0, "spot_futures_ratio": 0.0, "spot_dominance": "NEUTRAL",
    }
    # An out-of-order ticker must not move the saved baseline backwards.
    return current if current and (not prior or observed > prior.get("observed_at", 0)) else prior or None


def available_synthesis(row: dict, **context):
    """Derive availability policy around the unchanged Reflex synthesizer.

    Missing volume cannot confirm absence of a climax. Withhold new entries while this
    evidence is unavailable; retain price-based exits and disclose the missing condition.
    """
    out = synthesize_signal(row, **context)
    unknown = set()
    if row.get("volume_status") != "ok":
        unknown.add("no_climax")
    if context.get("consensus", {}).get("status") != "ready":
        unknown.add("consensus")
    if row.get("btc_status") != "ready":
        unknown.add("no_bear_div")
    if row.get("data_status") != "ready":
        unknown.update(("bullish_regime", "z_range", "heat_ok", "no_climax", "no_bear_div"))
    if unknown:
        earned = 0
        for condition in out.conditions_detail:
            if condition["name"] in unknown:
                earned += int(condition["met"])
                condition.update(met=False, available=False, status="unknown")
        out.conditions_met -= earned
        out.effective_conditions -= earned
        out.evidence_coverage = sum(c["available"] for c in out.conditions_detail) / out.conditions_total
        out.entry_blocked = True
        out.strong_long_blockers.append("core evidence unavailable")
        original = out.signal
        out.signal = enforce_signal_constraints(out.signal, entry_blocked=True)
        missing = ", ".join(c["label"] for c in out.conditions_detail if c["name"] in unknown)
        out.warnings.append(f"Unavailable evidence: {missing}; new entries suppressed")
        out.reason = (f"Unavailable evidence: {missing}; new entries suppressed" if original != out.signal
                      else f"{out.signal}: {row.get('regime', 'Unknown')} price structure; unavailable evidence: {missing}")
    if row.get("data_status") != "ready":
        out.signal, out.entry_blocked = "WAIT", True
        out.reason = "Price history is not ready; signal unavailable"
    return out


# -- synthesis per timeframe (Reflex scanner._synthesize_and_enrich) ------------
def synthesize(results: List[dict], tf: str, context_inputs: dict, state, other_rows: dict,
               as_of: float) -> dict:
    """Mutates `results` into final decisions. Returns the consensus."""
    consensus = compute_consensus(results, as_of)
    btc_regime = next((r["regime"] for r in results if r["underlying"] == "BTC" and engine_status(r, as_of) == "ready"), "FLAT")
    btc = next((r for r in results if r["underlying"] == "BTC"), None)
    for r in results:
        r["btc_status"] = engine_status(btc, as_of)
        r["divergence"] = detect_divergence(r["regime"], btc_regime)
    gm, gm_at = context_inputs.get("global_metrics") or (None, None)
    sent, sent_at = context_inputs.get("sentiment") or (None, None)
    stab, stab_at = context_inputs.get("stablecoin") or (None, None)
    for r in results:
        context = dict(
            consensus=consensus, global_metrics=gm, positioning=r.get("positioning"),
            sentiment=sent, stablecoin=stab,
            cvd_trend=r.get("cvd_trend", "UNAVAILABLE"), cvd_divergence=r.get("cvd_divergence", False),
            spot_dominance=(r.get("positioning") or {}).get("spot_dominance", "UNAVAILABLE"),
            long_short_ratio=(r.get("positioning") or {}).get("long_short_ratio", 1.0),
            liquidation_24h_usd=(r.get("positioning") or {}).get("liquidation_24h_usd", 0.0),
            etf_flow_usd=0.0, cb_premium=0.0, has_coinglass=False,
            hl_consensus_trend="NEUTRAL", hl_consensus_confidence=0.0, hl_consensus_net_ratio=0.0,
            has_hyperlens=False,
        )
        metadata = dict(r.get("input_metadata") or {})
        metadata["global_metrics"] = {"source": "market_totals", "observed_at": gm_at}
        metadata["sentiment"] = {"source": "fear_greed", "observed_at": sent_at}
        metadata["stablecoin"] = {"source": "stablecoin_supply", "observed_at": stab_at}
        metadata["macro"] = {"source": "macro_feed", "observed_at": None}
        metadata["hyperlens"] = {"source": "hyperlens", "observed_at": None}
        r["input_metadata"] = metadata
        other = other_rows.get(r["symbol"])
        if other:
            pair = (r, other) if tf == "4h" else (other, r)
            r["confluence"] = vars(compute_confluence(*pair))
        else:
            r.pop("confluence", None)
        evaluate_decision(r, context, state, as_of=as_of, metadata=metadata, synthesizer=available_synthesis)
        for condition in r.get("conditions_detail", []):
            if condition["name"] == "no_climax":
                condition.update(source="derive_perp_volume", freshness=r.get("volume_status"))
            elif condition["name"] == "consensus":
                condition.update(source="eligible_engines", observed_at=as_of, freshness=consensus["status"])
            elif condition["name"] == "no_bear_div":
                condition.update(source="BTC_engine", observed_at=(btc or {}).get("signal_bar_close_time"), freshness=r["btc_status"])
        r["analytics_version"] = ANALYTICS_VERSION
        if r.get("data_status") != "ready":
            r["signal_status"] = "unavailable"
    return consensus


def attach_unified(rows_4h: List[dict], rows_1d: List[dict], as_of: float | None = None) -> None:
    four = {r["symbol"]: r for r in rows_4h}
    daily = {r["symbol"]: r for r in rows_1d}
    for symbol in four.keys() | daily.keys():
        pair = (four.get(symbol), daily.get(symbol))
        complete = all(engine_status(r, as_of) == "ready" for r in pair)
        signal = unified_signal(*(r if engine_status(r, as_of) == "ready" else None for r in pair))
        for row in pair:
            if row is not None:
                row["unified_signal"] = signal
                row["unified_complete"] = complete


def engine_comparison(row_4h: dict | None, row_1d: dict | None, now: float) -> dict:
    """Compare the final stored decisions, not synthesis-time cached confluence.

    This publication view neither evaluates a new bar nor mutates recorder state.
    """
    pair = (row_4h, row_1d)
    complete = all(engine_status(r, now) == "ready" for r in pair)
    out = {}
    for tf, row in zip(("4h", "1d"), pair):
        r = row or {}
        out[tf] = {"timeframe": tf, "status": engine_status(row, now),
                   "observed_at": r.get("signal_bar_close_time"),
                   **{k: r.get(k) for k in ("signal", "regime", "heat", "zscore", "volume_status",
                                            "conditions_met", "conditions_total", "entry_blocked")}}
    out["confluence"] = vars(compute_confluence(*pair)) if complete else None
    out["unified"] = unified_signal(*pair) if complete else None
    return out


def fresh_state():
    return new_state()


def public_row(r: dict) -> dict:
    """The fields published for the frontend and the study (no internal decision snapshots)."""
    keys = ("symbol", "underlying", "timeframe", "signal_bar_close_time", "price", "decision_price",
            "signal", "signal_status", "signal_reason", "signal_warnings", "signal_score", "signal_confidence",
            "analytics_version", "unified_signal", "unified_complete", "regime", "regime_probability", "raw_signal", "zscore", "energy", "vol_state",
            "momentum", "heat", "heat_phase", "heat_direction", "atr_regime", "deviation_pct", "bmsb_mid",
            "exhaustion_state", "floor_confirmed", "is_absorption", "is_climax", "rel_vol", "divergence",
            "conditions_met", "conditions_total", "conditions_detail", "evidence_coverage", "weighted_total", "entry_blocked", "regime_changes_7d", "regime_unstable",
            "beta_btc", "beta_eth", "history_bars", "data_status", "volume_coverage", "volume_status",
            "ribbon", "positioning", "confluence", "cool_off", "sparkline", "asset_class", "backfilled_bars")
    out = {k: copy.deepcopy(r.get(k)) for k in keys}
    out["input_quality"] = copy.deepcopy(r.get("input_quality") or {})
    out["inputs"] = {k: v.get("status") for k, v in (r.get("input_quality") or {}).items()}
    return out

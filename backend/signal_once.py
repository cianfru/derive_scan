"""Compute Reflex's signals on Derive for every perp after each 4H and daily close, once.

    python signal_once.py --out DIR          update candles, compute any due timeframe, write files
    python signal_once.py --out DIR --due    only report whether a timeframe is due (no network)

Files under DIR (the checked-out data branch):
  candles/{UND}/{4h,1d,1w}.csv         closed bars (see derive/candles.py)
  signals/{4h,1d}/YYYY-MM-DD.csv       one row per perp per closed bar
  signals/latest.json                  newest rows for both timeframes, context and data status
  signals/status.json                  last computed bar per timeframe (read by --due)
  signals/state.pkl                    decision and agent-filter state carried between bars
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import logging
import os
import pickle
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

TFS = ("4h", "1d")                 # Reflex scans 4h then 1d
TF_SEC = {"4h": 14_400, "1d": 86_400, "1w": 604_800}
SETTLE_SEC = 180                   # let Derive close the bar before reading it
CSV_FIELDS = ("bar_close", "symbol", "signal", "unified_signal", "signal_status", "regime", "regime_probability",
              "raw_signal", "zscore", "heat", "heat_phase", "exhaustion_state", "divergence", "conditions_met",
              "conditions_total", "price", "funding_rate", "oi_trend", "ribbon", "data_status", "volume_status",
              "history_bars")
CSV_FIELDS += ("oi_usd", "oi_contracts", "positioning_at", "heat_valid", "ribbon_quality")


def newest_closed_open(tf: str, now: float) -> int:
    step = TF_SEC[tf]
    t = int(now) - SETTLE_SEC
    return t // step * step - step


def load_status(out: Path) -> dict:
    p = out / "signals" / "status.json"
    return json.loads(p.read_text()) if p.exists() else {}


def due_timeframes(out: Path, now: float) -> list[str]:
    done = load_status(out).get("last_bar_open", {})
    return [tf for tf in TFS if done.get(tf, -1) < newest_closed_open(tf, now)]


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=True, default=float))
    tmp.replace(path)


def _csv_row(r: dict) -> list:
    pos = r.get("positioning") or {}
    rib = r.get("ribbon") or {}
    vals = {"bar_close": int(r["signal_bar_close_time"]), "funding_rate": pos.get("funding_rate"),
            "oi_trend": pos.get("oi_trend"), "ribbon": rib.get("state"),
            "oi_usd": pos.get("oi_value"), "oi_contracts": pos.get("oi_contracts"),
            "positioning_at": pos.get("observed_at"),
            "heat_valid": int(r["bmsb_valid"]) if isinstance(r.get("bmsb_valid"), bool) else None,
            "ribbon_quality": rib.get("data_quality")}
    return [vals.get(k, r.get(k)) if k in vals else r.get(k) for k in CSV_FIELDS]


KEEP_KEYS = ("symbol", "underlying", "timeframe", "signal", "signal_status", "regime", "heat", "zscore",
             "confidence", "entry_blocked", "signal_bar_close_time", "data_status", "volume_status")


def slim(r: dict) -> dict:
    """What the next run needs from a row: the cross-timeframe confluence and unified signal inputs."""
    return {k: r.get(k) for k in KEEP_KEYS}


def append_csv(path: Path, rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    if not new:
        with path.open() as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames
            previous = list(reader) if header != list(CSV_FIELDS) else None
        if previous is not None:
            # Extend existing daily files by column name; old observations stay unknown.
            tmp = path.with_suffix(".csv.tmp")
            with tmp.open("w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, lineterminator="\n")
                writer.writeheader()
                writer.writerows({k: r.get(k, "") for k in CSV_FIELDS} for r in previous)
            tmp.replace(path)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if new:
        w.writerow(CSV_FIELDS)
    w.writerows(rows)
    with path.open("a") as f:
        f.write(buf.getvalue())


async def backfill_short(cache, unds: list[str], now: float, transport=None) -> dict:
    """Fetch earlier history once for series shorter than Reflex's warm-up (derive/backfill.py)."""
    from derive.backfill import TARGET_BARS, BACKFILL_VERSION, okx_before, supplemental_before

    log_ = (load_status(cache.root.parent).get("backfill") or {})
    for und in unds:
        for tf in ("4h", "1d", "1w"):
            key = f"{und}:{tf}"
            derive_n, early_n = cache.counts(und, tf)
            first = cache.first_ts_ms(und, tf)
            prev = log_.get(key) or {}
            if not derive_n or derive_n + early_n >= TARGET_BARS[tf] or (prev.get("ok") and prev.get("version") == BACKFILL_VERSION):
                continue
            if prev.get("version") == BACKFILL_VERSION and now - prev.get("at", 0) < 86_400:   # failed recently: retry daily
                continue
            # Preserve previously recovered history if either provider is unavailable.
            cached = cache.load(und, tf)
            rows = {int(cached["timestamp"][i]): [int(cached["timestamp"][i]), *[float(cached[k][i]) for k in
                    ("open", "high", "low", "close")], "0.0"] for i in range(early_n)}
            sources = list(prev.get("sources") or ([prev["source"]] if prev.get("source") else []))
            errors = []
            try:
                bars = await okx_before(und, tf, first, TARGET_BARS[tf] - derive_n, transport=transport)
                rows.update({r[0]: r for r in bars})
                if bars and "okx" not in sources:
                    sources.append("okx")
            except Exception as e:
                errors.append(f"OKX: {str(e)[:140]}")
            if len(rows) + derive_n < TARGET_BARS[tf]:
                try:
                    extra, source = await supplemental_before(und, tf, min(rows, default=first),
                        TARGET_BARS[tf] - derive_n - len(rows), transport=transport)
                    rows.update({r[0]: r for r in extra})
                    if extra and source not in sources:
                        sources.append(source)
                except Exception as e:
                    errors.append(f"Supplement: {str(e)[:140]}")
            bars = sorted(rows.values())[-(TARGET_BARS[tf] - derive_n):]
            if bars:
                cache.write_backfill(und, tf, bars)
            log_[key] = {"ok": not errors, "version": BACKFILL_VERSION, "at": int(now), "bars": len(bars),
                         "sources": sources, "errors": errors, "status": "extended" if bars else "no_earlier_history"}
    return log_


async def run(out: Path, now: float, due: list[str], client=None, context_transport=None, clock=time.time,
              backfill_transport=None) -> dict:
    from derive import signals as sig
    from derive.candles import CandleCache, update
    from derive.client import DeriveClient
    from derive.config import SOURCES
    from derive.context import fetch_context

    own_client = client is None
    client = client or DeriveClient(SOURCES["v2_mainnet"]["base"])
    cache = CandleCache(out)
    sdir = out / "signals"
    state_path = sdir / "state.pkl"
    saved = pickle.loads(state_path.read_bytes()) if state_path.exists() else {}
    state = saved.get("decision_state") or sig.fresh_state()
    prev_oi: dict = saved.get("prev_oi", {})
    last_rows: dict = saved.get("last_rows", {})
    try:
        tickers = (await client.public("get_tickers", {"instrument_type": "perp"})).get("tickers", {})
        unds = sorted(n[:-5] for n in tickers if n.endswith("-PERP"))
        fetch_errors = {}
        for und in unds:
            for tf in ("4h", "1d", "1w"):
                try:
                    await update(client, cache, und, tf, now)
                except Exception as e:
                    fetch_errors[f"{und}:{tf}"] = str(e)[:200]
                    logging.warning("candles %s %s failed: %s", und, tf, e)
        backfill_log = await backfill_short(cache, unds, now, transport=backfill_transport)
        context_inputs = await fetch_context(transport=context_transport, clock=clock)
    finally:
        if own_client:
            await client.close()

    # Decisions are evaluated after every input has been read, as Reflex evaluates after its fetches.
    as_of = float(clock())
    as_of_ms = as_of * 1000
    summary, computed = {}, {}
    # Reflex scans 4h then 1d, each meeting the other's newest rows. On a first run there are
    # no daily rows yet, so the daily timeframe goes first and the 4h rows get their confluence.
    order = ("1d", "4h") if "1d" in due and not last_rows.get("1d") else TFS
    for tf in order:
        if tf not in due:
            continue
        if cache.last_ts_sec("BTC", tf) != newest_closed_open(tf, now):
            logging.warning("%s: Derive has not published the newest bar yet; retrying next run", tf)
            continue
        btc, eth = cache.load("BTC", tf), cache.load("ETH", tf)
        rows, skipped = [], {}
        for und in unds:
            ohlcv, weekly = cache.load(und, tf), cache.load(und, "1w")
            if ohlcv is None or len(ohlcv["close"]) == 0:
                skipped[f"{und}-PERP"] = "no candles"
                continue
            try:
                r = sig.process_symbol(und, tf, ohlcv, weekly, btc, eth, as_of_ms)
            except Exception as e:
                skipped[f"{und}-PERP"] = f"engine error: {str(e)[:120]}"
                logging.exception("process %s %s", und, tf)
                continue
            prev_oi[f"{und}:{tf}"] = sig.attach_positioning(r, tickers.get(f"{und}-PERP"), prev_oi.get(f"{und}:{tf}"))
            r["backfilled_bars"] = cache.counts(und, tf)[1]
            rows.append(r)
        other_tf = "1d" if tf == "4h" else "4h"
        other_rows = {r["symbol"]: r for r in last_rows.get(other_tf, [])}
        consensus = sig.synthesize(rows, tf, context_inputs, state, other_rows, as_of)
        computed[tf] = rows
        last_rows[tf] = [slim(r) for r in rows]
        bar_open = newest_closed_open(tf, now)
        summary[tf] = {"bar_open": bar_open, "bar_close": bar_open + TF_SEC[tf], "consensus": consensus,
                       "skipped": skipped, "computed": len(rows)}
    # Unified 4H x 1D signal: the computed rows meet the other timeframe's newest rows.
    four = computed.get("4h") or last_rows.get("4h", [])
    daily = computed.get("1d") or last_rows.get("1d", [])
    sig.attach_unified(four, daily, as_of)
    for tf, rows in computed.items():
        day = datetime.fromtimestamp(summary[tf]["bar_close"], timezone.utc).strftime("%Y-%m-%d")
        append_csv(sdir / tf / f"{day}.csv", [_csv_row(r) for r in rows])

    status = load_status(out)
    status.setdefault("last_bar_open", {}).update({tf: s["bar_open"] for tf, s in summary.items()})
    status["computed_at"] = int(now)
    status["fetch_errors"] = fetch_errors
    status["backfill"] = backfill_log
    _write_json(sdir / "status.json", status)

    prev = json.loads((sdir / "latest.json").read_text()) if (sdir / "latest.json").exists() else {}
    tf_blocks = prev.get("timeframes", {})
    for tf in TFS:
        if tf in computed:
            s_ = summary[tf]
            tf_blocks[tf] = {"bar_close": s_["bar_close"], "consensus": s_["consensus"], "skipped": s_["skipped"],
                             "rows": [sig.public_row(r) for r in computed[tf]]}
        elif tf in tf_blocks:
            # the other timeframe moved on, so its unified signal may have changed
            unified = {r["symbol"]: r.get("unified_signal") for r in (four if tf == "4h" else daily)}
            for row in tf_blocks[tf]["rows"]:
                row["unified_signal"] = unified.get(row["symbol"], row.get("unified_signal"))
    gm, gm_at = context_inputs.get("global_metrics") or (None, None)
    sent, sent_at = context_inputs.get("sentiment") or (None, None)
    stab, stab_at = context_inputs.get("stablecoin") or (None, None)
    _write_json(sdir / "latest.json", {
        "generated_at": int(now), "source": "v2_mainnet", "reflex_commit": "e45ed97d91fa1cca58533144233dc807a63f4e8f",
        "universe": [f"{u}-PERP" for u in unds], "timeframes": tf_blocks,
        "context": {"global_metrics": gm, "global_metrics_at": gm_at, "sentiment": sent, "sentiment_at": sent_at,
                    "stablecoin": stab, "stablecoin_at": stab_at},
    })
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_bytes(pickle.dumps({"decision_state": state, "prev_oi": prev_oi, "last_rows": last_rows}))
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--due", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s %(message)s")
    out, now = Path(args.out), time.time()
    due = due_timeframes(out, now)
    if args.due:
        line = f"signals_due={'true' if due else 'false'}"
        print(line)
        if os.getenv("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                f.write(line + "\n")
        return 0
    if not due:
        print("signals up to date")
        return 0
    summary = asyncio.run(run(out, now, due))
    print(json.dumps({tf: {k: v for k, v in s.items() if k != "consensus"} | {"consensus": s["consensus"]["consensus"]}
                      for tf, s in summary.items()}, indent=1))
    return 0 if all(s["computed"] for s in summary.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

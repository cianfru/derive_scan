"""Build the app's data files from the data branch, for the `site-data` branch.

    python publish_site.py --data DATA_DIR --site SITE_DIR

The app reads only these files (one request per screen); nothing runs per user and users
never reach Derive. The site-data branch is force-pushed with a single commit each run, so it
keeps no history. Files:

  markets.json        every perp: price, change, signals, regime, heat, z, ribbon, funding, OI,
                      data status, options summary, sparkline; market-wide context; breadth_1d,
                      the daily regime mix of all perps over the engine history window
  coins/{UND}.json    candles (4H, 1D) with signal history, latest rows, ribbon state per daily
                      candle, the engine's market inputs (engine_context), engine history (recorded
                      and reconstructed price metrics, with coverage of the engine and the option
                      recording), options detail (term structure, per-strike open interest and IV,
                      14-day IV history, implied ranges, open-interest levels, options lean),
                      alignment by horizon
  wallets/{UND}.json  per coin: the ranked traders holding its options (biggest delta first) and how
                      each cohort is positioned on it within 7 days, 30 days and all expiries
  traders.json        options traders' leaderboard (market makers left out) and cohorts by results
                      and size with their positioning; traders/{address}.json per ranked trader
  flow.json           last 24 hours: large trades, most active wallets (market makers left out once
                      the rebuilt history has classed them), with each wallet's class
  strikes/{UND}.json  written by record_once.py (per-strike view of the newest chain)
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from derive.candles import CandleCache
from derive.signals import engine_comparison, ribbon_trail
from derive.quality import ANALYTICS_VERSION, engine_status, snapshot_status
from derive.implied import implied_by_expiry, option_levels
from derive.lean import alignment, options_lean, state_of
from derive import traders as traders_mod
from derive.history import last_complete_day, parse_option
from derive.metric_history import build_engine_history

SOURCE = "v2_mainnet"
CANDLES_KEEP = {"4h": 500, "1d": 400}
SIGNAL_DAYS = 120
IV_DAYS = 14
METRIC_DAYS = 90
FLOW_LARGE = 80
FLOW_WALLETS = 30
RIBBON_CHAR = {"gold": "g", "blue": "b", "grey": "n"}  # "-": warm-up or no reading
BREADTH_COLS = ("MARKUP", "BLOWOFF", "REACC", "ACCUM", "CAP", "MARKDOWN", "FLAT")
# Price metrics a replay may supply for a saved close that was not ready; heat carries its phase.
FILLABLE = {"regime": ("regime",), "zscore": ("zscore",), "heat": ("heat", "heat_phase"), "ribbon": ("ribbon",)}


def _days(n: int, now: float) -> list[str]:
    d0 = datetime.fromtimestamp(now, timezone.utc).date()
    return [(d0 - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def _read_csv(p: Path) -> list[dict]:
    return list(csv.DictReader(p.open())) if p.exists() else []


def _num(x):
    try:
        v = float(x)
        if not math.isfinite(v):
            return None
        return int(v) if v.is_integer() and abs(v) < 1e15 else v
    except (TypeError, ValueError):
        return None


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), default=float))


def signal_history(data: Path, now: float) -> dict:
    """{UND: {tf: [[bar_close, signal, regime, zscore, heat, heat_phase, exhaustion, ribbon, unified]]}}"""
    out: dict = defaultdict(lambda: defaultdict(list))
    for tf in ("4h", "1d"):
        for day in _days(SIGNAL_DAYS, now):
            for r in _read_csv(data / "signals" / tf / f"{day}.csv"):
                und = r["symbol"].split("-")[0]
                out[und][tf].append([int(r["bar_close"]), r["signal"], r["regime"], _num(r["zscore"]), _num(r["heat"]),
                                     r["heat_phase"], r["exhaustion_state"], r["ribbon"] or None, r["unified_signal"]])
    return out


def recorded_metrics(data: Path, now: float) -> dict:
    """Saved decisions retain their original timestamps and always win over replay."""
    out: dict = defaultdict(lambda: defaultdict(dict))
    latest_path = data / "signals" / "latest.json"
    latest = json.loads(latest_path.read_text()) if latest_path.exists() else {}
    metadata = {(tf, row["symbol"], row.get("signal_bar_close_time")): row
                for tf, block in latest.get("timeframes", {}).items() for row in block.get("rows", [])}
    for tf in ("4h", "1d"):
        for day in _days(SIGNAL_DAYS + 1, now):
            for row in _read_csv(data / "signals" / tf / f"{day}.csv"):
                ts = _num(row.get("bar_close"))
                if ts is None or ts > now:
                    continue
                status = row.get("data_status") or "unknown"
                calculated = row.get("signal_status") == "ready"
                ready = calculated and status == "ready"
                funding = _num(row.get("funding_rate"))
                original = metadata.get((tf, row["symbol"], ts), {})
                heat_flag = _num(row.get("heat_valid"))
                if heat_flag is None and isinstance(original.get("bmsb_valid"), bool):
                    heat_flag = int(original["bmsb_valid"])
                if heat_flag is None and _num(original.get("bmsb_mid")) is not None:
                    heat_flag = int(_num(original["bmsb_mid"]) > 0)
                heat = _num(row.get("heat"))
                # Legacy zero may be the engine's unavailable default, rather than a measured zero.
                heat_valid = calculated and (heat_flag == 1 or (heat_flag is None and heat is not None and heat > 0))
                ribbon_quality = row.get("ribbon_quality") or (original.get("ribbon") or {}).get("data_quality") or "unknown"
                out[row["symbol"].split("-")[0]][tf][ts] = {
                    "ts": ts, "source": "recorded", "status": status if calculated else "unavailable",
                    "signal": row.get("signal") if ready else None,
                    "regime": row.get("regime") if ready else None,
                    "zscore": _num(row.get("zscore")) if ready else None,
                    "heat": heat if heat_valid else None,
                    "ribbon": (row.get("ribbon") or None) if ribbon_quality == "ready" else None,
                    "metric_status": {"zscore": "ready" if ready else status,
                                      "regime": "ready" if ready else status,
                                      "heat": "ready" if heat_valid else "unavailable", "ribbon": ribbon_quality},
                    "funding_ann": funding * 24 * 365 if funding is not None else None,
                    "oi_usd": _num(row.get("oi_usd")), "oi_contracts": _num(row.get("oi_contracts")),
                    "positioning_at": _num(row.get("positioning_at")),
                }
    return out


OPTION_METRICS = ("index_price", "atm_iv_7d", "atm_iv_30d", "atm_iv_90d", "rr25_7d", "rr25_30d",
                  "bf25_30d", "pc_oi_ratio", "option_oi_contracts", "funding_ann", "perp_basis", "perp_oi_contracts")


def option_metric_history(data: Path, und: str, now: float) -> tuple[list[dict], dict]:
    """Publish all saved measurements, with gaps and the real recording start visible."""
    directory = data / SOURCE / und / "features"
    files = sorted(directory.glob("*.csv"))
    cutoff = now - METRIC_DAYS * 86400
    by: dict[int, dict] = defaultdict(dict)
    first = None
    for path in files:
        if path.stem < datetime.fromtimestamp(cutoff, timezone.utc).date().isoformat():
            if first is None:
                times = [_num(r.get("ts")) for r in _read_csv(path)]
                first = min((t for t in times if t is not None and t <= now), default=None)
            continue
        for r in _read_csv(path):
            ts = _num(r.get("ts"))
            if ts is None or ts > now:
                continue
            first = ts if first is None else min(first, ts)
            if ts >= cutoff:
                by[ts][r["feature"]] = _num(r.get("value"))
    rows = []
    for ts, features in sorted(by.items()):
        row = {"ts": ts, "source": "recorded", **{k: features.get(k) for k in OPTION_METRICS}}
        oi, index, basis = (features.get(k) for k in ("perp_oi_contracts", "index_price", "perp_basis"))
        row["perp_oi_usd"] = oi * index * (1 + basis) if all(v is not None for v in (oi, index, basis)) else None
        row["perp_funding_ann"] = row["funding_ann"]
        rows.append(row)
    start = rows[0]["ts"] if rows else None
    end = int(now) // 900 * 900
    expected = (end - start) // 900 + 1 if start is not None else 0
    missing = max(0, expected - len(rows))
    return rows, {"from": start, "to": rows[-1]["ts"] if rows else None,
                  "count": len(rows), "expected_count": expected, "missing_count": missing,
                  "interval_seconds": 900, "history_available_from": first,
                  "status": "missing" if not rows else "partial" if missing else "ready",
                  "limitation": "Derive does not provide past option surfaces. History starts when recording began; missed snapshots cannot be recreated."}


def fill_from_replay(saved: dict, replay: dict | None) -> dict:
    """A saved close that was not ready takes the replay's ready price metrics at the same close.

    Only regime, z-score, heat (with its phase) and ribbon, with their metric status; never the
    signal, funding, open interest or option fields, and never a value the saved row holds.
    The copied keys are listed in `filled_from_replay`.
    """
    if saved.get("status") == "ready" or not replay:
        return saved
    row, status, copied = dict(saved), dict(saved.get("metric_status") or {}), []
    for metric, keys in FILLABLE.items():
        if saved.get(metric) is not None or replay.get(metric) is None \
                or (replay.get("metric_status") or {}).get(metric) != "ready":
            continue
        for key in keys:
            row[key] = replay.get(key)
        copied.extend(keys)
        status[metric] = "ready"
    if copied:
        row.update(metric_status=status, filled_from_replay=copied)
    return row


def metric_history(data: Path, cache: CandleCache, und: str, now: float, recorded: dict) -> dict:
    engine, coverage = {}, {}
    for tf, days in (("1d", 120), ("4h", 30)):
        saved = {ts: row for ts, row in recorded.get(tf, {}).items() if now - days * 86400 < ts <= now}
        # Closes saved as ready are never replayed; the others are, so a ready replay can fill them.
        replay = build_engine_history(cache, und, tf, now, days=days,
                                      recorded_rows=[r for r in recorded.get(tf, {}).values() if r.get("status") == "ready"])
        replayed = {r["ts"]: r for r in replay["rows"]}
        merged = {ts: r for ts, r in replayed.items() if ts not in saved}
        reconstructed = list(merged.values())
        merged.update({ts: fill_from_replay(row, replayed.get(ts)) for ts, row in saved.items()})
        engine[tf] = []
        for ts in sorted(merged):
            row = {k: v for k, v in merged[ts].items() if k not in ("input_id", "provenance")}
            provenance = merged[ts].get("provenance", {}).get("price")
            if provenance:
                row["provenance"] = {"price": {k: provenance[k] for k in
                    ("price_sources", "backfilled_bars", "history_bars") if k in provenance}}
            engine[tf].append(row)
        rows = engine[tf]
        stored = [r for r in rows if r["source"] == "recorded"]
        coverage[tf] = {**replay["coverage"], "from": rows[0]["ts"] if rows else None,
                        "to": rows[-1]["ts"] if rows else None,
                        "samples": len(reconstructed),
                        "status_counts": dict(Counter(r.get("status") for r in reconstructed)),
                        "metric_counts": {k: sum(r.get(k) is not None for r in reconstructed) for k in FILLABLE},
                        "recorded_from": stored[0]["ts"] if stored else None,
                        "recorded_count": len(stored), "reconstructed_count": len(rows) - len(stored),
                        "filled_from_replay_count": sum(bool(r.get("filled_from_replay")) for r in stored),
                        "observed_count": len(rows), "expected_count": days * (6 if tf == "4h" else 1)}
    # Option rows are not published (the app reads options.iv_history); their coverage is.
    _, options_coverage = option_metric_history(data, und, now)
    return {"engine": engine, "coverage": {"engine": coverage, "options": options_coverage}}


def count_breadth(breadth: dict, rows: list[dict]) -> None:
    """Adds one coin's ready daily regimes to breadth[ts][regime].

    A saved close filled from a ready replay counts like the replayed closes before it, so a coin
    whose history was extended after the close is not dropped from those days.
    """
    for r in rows:
        ready = r.get("status") == "ready" or "regime" in (r.get("filled_from_replay") or ())
        if not ready or (r.get("metric_status") or {}).get("regime") != "ready" or not r.get("regime"):
            continue
        breadth[int(r["ts"])][r["regime"] if r["regime"] in BREADTH_COLS else "FLAT"] += 1


def breadth_table(breadth: dict) -> dict:
    return {"cols": list(BREADTH_COLS), "rows": [[ts, *(breadth[ts][c] for c in BREADTH_COLS)] for ts in sorted(breadth)]}


def ribbon_chars(trail: dict, bars: list) -> str:
    """One character per published candle: g gold, b blue, n grey, - warm-up or no reading."""
    return "".join(RIBBON_CHAR.get(trail.get(bar[0]), "-") for bar in bars)


def engine_context(sig: dict, rows: dict, meta: dict) -> dict:
    """The market-wide inputs of the engine's checks, so a coin page needs one request.

    BTC's regime is given only where the engine could read BTC (as the divergence check does).
    """
    context = sig.get("context") or {}
    btc = {tf: rows[tf].get("BTC-PERP") for tf in ("4h", "1d")}
    return {"consensus": meta["consensus_detail"],
            "btc_regime": {tf: r.get("regime") if engine_status(r) == "ready" else None for tf, r in btc.items()},
            "fear_greed": (context.get("sentiment") or {}).get("fear_greed_value"),
            "stablecoin_7d_pct": (context.get("stablecoin") or {}).get("change_7d_pct"),
            "observed_at": {"sentiment": context.get("sentiment_at"), "stablecoin": context.get("stablecoin_at"),
                            "consensus": meta["bars"]}}


def iv_history(data: Path, und: str, now: float) -> list[list]:
    """[[ts, atm_iv_7d, atm_iv_30d, atm_iv_90d, rr25_30d, bf25_30d, pc_oi_ratio, rr25_7d]] from the features files."""
    keys = ("atm_iv_7d", "atm_iv_30d", "atm_iv_90d", "rr25_30d", "bf25_30d", "pc_oi_ratio", "rr25_7d")
    by: dict[int, dict] = defaultdict(dict)
    for day in _days(IV_DAYS, now):
        for r in _read_csv(data / SOURCE / und / "features" / f"{day}.csv"):
            if r["feature"] in keys:
                by[int(r["ts"])][r["feature"]] = _num(r["value"])
    return [[ts, *[by[ts].get(k) for k in keys]] for ts in sorted(by)]


def options_block(data: Path, site: Path, und: str, now: float) -> dict | None:
    latest = data / SOURCE / und / "latest.json"
    if not latest.exists():
        return None
    doc = json.loads(latest.read_text())
    strikes_p = site / "strikes" / f"{und}.json"
    strikes = json.loads(strikes_p.read_text()) if strikes_p.exists() else None
    quality = snapshot_status(doc["ts"], now)
    usable_strikes = strikes if snapshot_status((strikes or {}).get("ts"), now) == "ready" and (strikes or {}).get("ts") == doc["ts"] else None
    return {"status": quality, "chain_status": snapshot_status((strikes or {}).get("ts"), now),
            "chain_at": (strikes or {}).get("ts"), "ts": doc["ts"], "features": doc["features"], "expiries": doc["expiries"],
            "strikes": strikes, "iv_history": iv_history(data, und, now),
            "implied": implied_by_expiry(usable_strikes, doc["expiries"], doc["ts"]) if quality == "ready" else [],
            "levels": option_levels(usable_strikes, doc["features"].get("index_price"), doc["ts"]) if quality == "ready" else None}


def taker_sides(data: Path, now: float) -> dict:
    """Trade-time windows with separately measured collection coverage."""
    from derive.flow import window_coverage
    coverage = {w: window_coverage(data, now, n) for w, n in (("24h", 86400), ("7d", 7 * 86400))}
    out: dict = defaultdict(lambda: {w: defaultdict(lambda: defaultdict(float)) for w in coverage})
    for day in _days(8, now):
        for r in _read_csv(data / "flow" / "sides_v2" / f"{day}.csv"):
            bucket = int(r["bucket_ts"])
            for window, c in coverage.items():
                if c["start"] <= bucket < c["end"]:
                    a = out[r["underlying"]][window][r["kind"]]
                    for k in ("buy_notional_usd", "sell_notional_usd", "buy_premium_usd", "sell_premium_usd"):
                        a[k] += float(r[k] or 0)
    result = {u: {w: {**{k: dict(v) for k, v in kinds.items()}, "coverage": coverage[w]}
                  for w, kinds in d.items()} for u, d in out.items()}
    result["_coverage"] = coverage
    return result


def change_pct(closes: list[float], bars: int) -> float | None:
    if len(closes) <= bars or not closes[-1 - bars]:
        return None
    return (closes[-1] / closes[-1 - bars] - 1) * 100


def wallet_classes(data: Path) -> dict[str, str]:
    """{wallet: tier or class} from the rebuilt history (derive/history.py); empty until it exists."""
    p = data / "history" / "wallets.json"
    return {w: v.get("tier") or v["class"] for w, v in json.loads(p.read_text()).get("wallets", {}).items()} if p.exists() else {}


def tier_positions(data: Path) -> dict:
    """history/positions.json (open option positions of each wallet tier); empty until it exists."""
    p = data / "history" / "positions.json"
    return json.loads(p.read_text()) if p.exists() else {}


def flow_block(data: Path, now: float, sides: dict | None = None) -> dict:
    """Large taker trades and the most active wallets, market makers left out."""
    from derive.flow import window_coverage
    coverage = window_coverage(data, now, 86400)
    since_ms = coverage["start"] * 1000
    classes = wallet_classes(data)
    large = []
    for day in _days(2, now):
        for r in _read_csv(data / "flow" / "large" / f"{day}.csv"):
            if since_ms <= int(r["ts"]) < coverage["end"] * 1000 and classes.get(r["wallet"]) != "market_maker":
                large.append({**r, "class": classes.get(r["wallet"])})
    large.sort(key=lambda r: float(r["notional_usd"]), reverse=True)
    large = sorted(large[:FLOW_LARGE], key=lambda r: int(r["ts"]), reverse=True)
    wallets: dict = defaultdict(lambda: defaultdict(float))
    for day in _days(2, now):
        for r in _read_csv(data / "flow" / "wallets_v2" / f"{day}.csv"):
            if not coverage["start"] <= int(r["bucket_ts"]) < coverage["end"] or classes.get(r["wallet"]) == "market_maker":
                continue
            w = wallets[r["wallet"]]
            for k in ("legs", "perp_notional_usd", "option_notional_usd", "premium_bought_usd", "premium_sold_usd",
                      "realized_pnl_usd", "fees_usd"):
                w[k] += float(r[k] or 0)
    top = sorted(wallets.items(), key=lambda kv: kv[1]["perp_notional_usd"] + kv[1]["option_notional_usd"],
                 reverse=True)[:FLOW_WALLETS]
    sides = taker_sides(data, now) if sides is None else sides
    return {"by_coin": {u: d.get("24h", {}) for u, d in sides.items() if u != "_coverage"},
            "since": int(since_ms // 1000), "coverage": coverage,
            "classes_ready": bool(classes),
            "large": [{k: (_num(v) if k not in ("instrument", "kind", "underlying", "direction", "wallet", "class") else v)
                       for k, v in r.items()} for r in large],
            "wallets": [{"wallet": a, "class": classes.get(a), **{k: round(v, 2) for k, v in w.items()}} for a, w in top]}


def _book(open_rows: list, chains: dict, now: float) -> list[dict]:
    out = []
    for name, net, entry in open_rows:
        if parse_option(name)[1] <= now:
            continue
        und = name.split("-")[0]
        strikes, index, _ = chains.get(und, (None, None, None))
        out.append(traders_mod.mark_position(name, net, entry, strikes, index, now))
    return out


def _lean(book: list[dict]) -> dict:
    net = sum(p["delta_usd"] or 0 for p in book)
    gross = sum(abs(p["delta_usd"] or 0) for p in book)
    score = round(net / gross, 3) if gross and all(p["delta_usd"] is not None and p["delta_source"] == "quoted" for p in book) else None
    return {"net_delta_usd": round(net, 2) if all(p["delta_usd"] is not None for p in book) else None,
            "gross_delta_usd": round(gross, 2) if all(p["delta_usd"] is not None for p in book) else None,
            "score": score, "state": state_of(score)}


def history_coverage(doc: dict, now: float) -> dict:
    """Readiness is about source coverage, never the publish timestamp."""
    expected = last_complete_day(now).isoformat()
    through = doc.get("through")
    caught_up = bool(through and through >= expected)
    ready = caught_up and doc.get("schema_version", 0) >= 2
    status = "ready" if ready else "updating" if caught_up else "backfilling"
    return {"ready": ready, "status": status, "through": through, "expected_through": expected}


def cohort_lean(insts: dict, chains: dict, now: float, max_days=None, min_days=0) -> dict:
    net = gross = 0.0
    positions = 0
    complete = True
    for name, cell in insts.items():
        expiry = parse_option(name)[1]
        if expiry <= now + min_days * 86400 or (max_days is not None and expiry > now + max_days * 86400):
            continue
        und = name.split("-")[0]
        strikes, index, _ = chains.get(und, (None, None, None))
        valued = traders_mod.mark_position(name, 1, None, strikes, index, now)
        delta = valued["delta_usd"]
        positions += cell[1]
        if delta is None or valued["delta_source"] != "quoted" or len(cell) < 3:
            complete = False
            continue
        net += cell[0] * delta
        gross += cell[2] * abs(delta)
    score = round(net / gross, 3) if complete and gross else None
    return {"net_delta_usd": round(net, 2) if complete else None, "gross_delta_usd": round(gross, 2) if complete else None,
            "score": score, "state": state_of(score), "positions": positions, "quotes_complete": complete}


COIN_HOLDERS = 12


def traders_block(data: Path, site: Path, chains: dict, flow: dict, now: float) -> None:
    """traders.json (leaderboard and cohorts) and traders/{address}.json (one per ranked trader)."""
    p = data / "history" / "traders.json"
    if not p.exists():
        unavailable = {"generated_at": int(now), **history_coverage({}, now)}
        _write(site / "traders.json", unavailable)
        for old in (site / "traders").glob("*.json"):
            _write(old, unavailable)
        return
    doc = json.loads(p.read_text())
    coverage = history_coverage(doc, now)
    if not coverage["ready"]:
        _write(site / "traders.json", {"generated_at": int(now), **coverage})
        for und in chains:
            _write(site / "wallets" / f"{und}.json", {"generated_at": int(now), **coverage, "und": und})
        # Existing direct links must not continue serving a stale, apparently current book.
        for old in (site / "traders").glob("*.json"):
            _write(old, {"generated_at": int(now), **coverage})
        for t in doc["traders"]:
            _write(site / "traders" / f"{t['address'].lower()}.json", {"generated_at": int(now), **coverage})
        return
    addresses = {t["address"].lower() for t in doc["traders"]}
    for old in (site / "traders").glob("*.json"):
        if old.stem not in addresses:
            _write(old, {"generated_at": int(now), **coverage, "ready": False, "status": "not_ranked"})
    rows = []
    holders: dict = defaultdict(list)  # und -> ranked traders holding options on it
    for t in doc["traders"]:
        book = _book(t["open"], chains, now)
        by_und: dict = defaultdict(list)
        for b in book:
            by_und[b["und"]].append(b)
        for und, legs in by_und.items():
            if any(b["delta_usd"] is None for b in legs):
                continue
            legs.sort(key=lambda b: -abs(b["delta_usd"]))
            holders[und].append({k: t.get(k) for k in ("address", "rank", "tier", "class", "pnl_cohort", "size_cohort",
                                                       "option_pnl", "win_rate")} | {
                "net_delta_usd": round(sum(b["delta_usd"] for b in legs), 2),
                "gross_delta_usd": round(sum(abs(b["delta_usd"]) for b in legs), 2),
                "positions": len(legs), "nearest_expiry": min(b["expiry"] for b in legs),
                "legs": [{k: b[k] for k in ("instrument", "net", "strike", "type", "expiry", "delta_usd", "entry", "mark")}
                         for b in legs[:4]]})
        summary = {k: v for k, v in t.items() if k not in ("open", "recent")}
        summary.update({"open_count": len(book), "lean": _lean(book),
                        "upnl": round(sum(b["upnl"] for b in book if b["upnl"] is not None), 2)
                        if book and all(b["upnl"] is not None for b in book) else None})
        rows.append(summary)
        large = [r for r in flow.get("large", []) if (r.get("wallet") or "").lower() == t["address"].lower()]
        _write(site / "traders" / f"{t['address'].lower()}.json",
               {"generated_at": int(now), **coverage, **summary, "book": book, "recent": t["recent"],
                "large_24h": large})
    cohorts = {}
    order = {"pnl": [c[0] for c in traders_mod.PNL_COHORTS][::-1], "size": [c[0] for c in traders_mod.SIZE_COHORTS][::-1]}
    for dim, names in order.items():
        cohorts[dim] = []
        for name in names:
            per = doc["cohort_positions"].get(dim, {}).get(name, {})
            combined = {i: c for insts in per.values() for i, c in insts.items()}
            windows = {}
            for window, end, start in (("all", None, 0), ("7d", 7, 0), ("30d", 30, 0), ("beyond30d", None, 30)):
                coins = {und: cohort_lean(insts, chains, now, end, start) for und, insts in per.items()}
                windows[window] = {"coins": coins, "total": cohort_lean(combined, chains, now, end, start)}
            cohorts[dim].append({"name": name, "wallets": doc["cohort_counts"].get(dim, {}).get(name, 0),
                                 "coins": windows["all"]["coins"], "windows": windows})
    _write(site / "traders.json", {"generated_at": int(now), **coverage,
                                   "ranked_total": doc.get("ranked_total"), "traders": rows, "cohorts": cohorts})
    for und in chains:
        coin_cohorts = {dim: [{"name": c["name"], "wallets": c["wallets"],
                               **{w: c["windows"][w]["coins"].get(und) for w in ("7d", "30d", "all")}} for c in cs]
                        for dim, cs in cohorts.items()}
        top = sorted(holders.get(und, []), key=lambda h: -abs(h["net_delta_usd"]))[:COIN_HOLDERS]
        _write(site / "wallets" / f"{und}.json", {"generated_at": int(now), **coverage, "und": und,
                                                  "holders": top, "holders_total": len(holders.get(und, [])),
                                                  "cohorts": coin_cohorts})


def build(data: Path, site: Path, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    from derive.flow import replay_pending
    replay_pending(data)
    sig_p = data / "signals" / "latest.json"
    sig = json.loads(sig_p.read_text()) if sig_p.exists() else {"timeframes": {}, "universe": [], "context": {}}
    rows = {tf: {r["symbol"]: r for r in (sig["timeframes"].get(tf) or {}).get("rows", [])} for tf in ("4h", "1d")}
    cache = CandleCache(data)
    status_path = data / "signals" / "status.json"
    backfill_log = json.loads(status_path.read_text()).get("backfill", {}) if status_path.exists() else {}
    history = signal_history(data, now)
    metrics = recorded_metrics(data, now)
    flows = taker_sides(data, now)
    held = tier_positions(data)
    coverage = history_coverage(held, now)
    chains: dict = {}  # und -> (strikes, index, ts) for valuing traders' positions
    markets = []
    meta = {"analytics_version": ANALYTICS_VERSION, "generated_at": int(now), "bars": {tf: (sig["timeframes"].get(tf) or {}).get("bar_close") for tf in ("4h", "1d")},
            "consensus": {tf: ((sig["timeframes"].get(tf) or {}).get("consensus") or {}).get("consensus") for tf in ("4h", "1d")},
            "consensus_detail": {tf: (sig["timeframes"].get(tf) or {}).get("consensus") for tf in ("4h", "1d")},
            "context": sig.get("context", {})}
    context = engine_context(sig, rows, meta)
    breadth: dict = defaultdict(Counter)
    for sym in sig.get("universe", []):
        und = sym.split("-")[0]
        r4, r1 = rows["4h"].get(sym) or {}, rows["1d"].get(sym) or {}
        daily_native, daily_early = cache.counts(und, "1d")
        evaluated = r1.get("history_bars")
        history_meta = {"available_bars": daily_native + daily_early, "evaluated_bars": evaluated,
                        "price_only_bars": daily_early, "normalization_bars": 499,
                        "sources": backfill_log.get(f"{und}:1d", {}).get("sources") or
                                   ([backfill_log[f"{und}:1d"]["source"]] if backfill_log.get(f"{und}:1d", {}).get("source") else []),
                        "refresh_pending": isinstance(evaluated, (int, float)) and evaluated < min(599, daily_native + daily_early)}
        if history_meta["refresh_pending"] and r1.get("data_status") != "ready":
            r1 = {**r1, "data_status": "history_updated"}
        candles, loaded = {}, {}
        for tf, keep in CANDLES_KEEP.items():
            c = loaded[tf] = cache.load(und, tf)
            candles[tf] = [] if c is None else [[int(c["timestamp"][i] // 1000), *(round(float(c[k][i]), 8) for k in
                                                ("open", "high", "low", "close", "volume"))]
                                                for i in range(max(0, len(c["close"]) - keep), len(c["close"]))]
        ribbon = {"1d": ribbon_chars(ribbon_trail(loaded["1d"], "1d", now * 1000), candles["1d"])}
        closes4 = [b[4] for b in candles["4h"]]
        closes1 = [b[4] for b in candles["1d"]]
        opts = options_block(data, site, und, now)
        coin_flows = flows.get(und) or {w: {"coverage": c} for w, c in flows["_coverage"].items()}
        align = None
        if opts:
            chains[und] = (opts["strikes"], opts["features"].get("index_price"), opts["ts"])
            opts["lean"] = options_lean(opts["features"], opts["iv_history"], coin_flows.get("7d"), observed_at=opts["ts"], now=now)
            align = alignment(r4, r1, opts["features"], opts["iv_history"], coin_flows,
                              (held.get("positions") or {}).get(und) if coverage["ready"] else None, opts["strikes"], opts["features"].get("index_price"),
                              now, options_at=opts["ts"])
            align["positions_through"] = held.get("through")
            align["wallet_coverage"] = coverage
        comparison = engine_comparison(r4, r1, now)
        pos = r4.get("positioning") or {}
        price = (opts or {}).get("features", {}).get("index_price") or (closes4[-1] if closes4 else None)
        markets.append({
            "und": und, "symbol": sym, "price": price,
            "chg_1d": change_pct(closes1, 1), "chg_24h": change_pct(closes4, 6), "chg_7d": change_pct(closes4, 42),
            "signal_4h": r4.get("signal") if engine_status(r4, now) == "ready" else None,
            "signal_1d": r1.get("signal") if engine_status(r1, now) == "ready" else None,
            "unified": comparison["unified"],
            "engine_comparison": comparison, "daily_history": history_meta, "engine_status_1d": engine_status(r1, now),
            "z_1d": r1.get("zscore"), "heat_1d": r1.get("heat"), "regime_4h": r4.get("regime"), "regime_1d": r1.get("regime"), "z_4h": r4.get("zscore"),
            "heat_4h": r4.get("heat"), "heat_phase_4h": r4.get("heat_phase"),
            "ribbon_1d": (r1.get("ribbon") or {}).get("state"), "ribbon_4h": (r4.get("ribbon") or {}).get("state"),
            "data_4h": r4.get("data_status"), "data_1d": r1.get("data_status"), "volume_status": r4.get("volume_status"),
            "funding_ann": pos["funding_rate"] * 24 * 365 if pos.get("funding_rate") is not None else None,
            "oi_usd": pos.get("oi_value"), "has_options": opts is not None,
            "atm_iv_30d": (opts or {}).get("features", {}).get("atm_iv_30d"),
            "rr25_30d": (opts or {}).get("features", {}).get("rr25_30d"),
            "lean": ((opts or {}).get("lean") or {}).get("state"),
            "align": None if not align else {"version": ANALYTICS_VERSION, "readings": align["horizons"], "score": align["score"], "wallet_coverage": coverage, **{h: [row[k]["state"] for k in ("engine", "options", "wallets")]
                                                                          for h, row in align["horizons"].items()}},
            "options": None if not opts else {
                "ts": opts["ts"], "status": opts["status"], "levels": opts["levels"],
                "expiries": opts["expiries"], **{k: opts["features"].get(k) for k in ("atm_iv_7d", "atm_iv_30d", "atm_iv_90d", "rr25_30d",
                                                                           "bf25_30d", "pc_oi_ratio", "option_oi_contracts")},
                "term": [[round(e["tenor_days"], 3), e["atm_iv"]] for e in opts["expiries"] if e.get("atm_iv") is not None],
                "iv30_hist": [[h[0], h[2]] for h in opts["iv_history"][-96 * 7:] if h[2] is not None][::4]},
            "spark_1d": closes1[-60:],
            "spark_times_1d": [b[0] + 86400 for b in candles["1d"][-60:]],
            "spark": closes4[-42:],
            "spark_times": [b[0] + 14400 for b in candles["4h"][-42:]],
        })
        tracking = metric_history(data, cache, und, now, metrics.get(und, {}))
        count_breadth(breadth, tracking["engine"]["1d"])
        tracking["coverage"]["wallets"] = coverage
        _write(site / "coins" / f"{und}.json", {
            "und": und, "symbol": sym, "generated_at": int(now), "candles": candles, "daily_history": history_meta,
            "engine_comparison": comparison, "ribbon": ribbon, "engine_context": context,
            "history": tracking,
            "backfilled": {tf: cache.counts(und, tf)[1] for tf in CANDLES_KEEP},
            "signals": history.get(und, {}), "latest": {"4h": r4 or None, "1d": r1 or None}, "options": opts,
            "taker_flow": coin_flows, "alignment": align,
        })
    meta["breadth_1d"] = breadth_table(breadth)
    _write(site / "markets.json", {**meta, "coins": markets})
    flow = flow_block(data, now, flows)
    tp = data / "history" / "traders.json"
    ranked = {t["address"].lower() for t in json.loads(tp.read_text())["traders"]} if tp.exists() else set()
    for r in flow["large"] + flow["wallets"]:
        r["ranked"] = (r.get("wallet") or "").lower() in ranked
    _write(site / "flow.json", {"generated_at": int(now), **flow})
    traders_block(data, site, chains, flow, now)
    return {"coins": len(markets)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--site", required=True)
    a = ap.parse_args()
    print(build(Path(a.data), Path(a.site)))


if __name__ == "__main__":
    main()

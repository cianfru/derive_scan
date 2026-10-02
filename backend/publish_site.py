"""Build the app's data files from the data branch, for the `site-data` branch.

    python publish_site.py --data DATA_DIR --site SITE_DIR

The app reads only these files (one request per screen); nothing runs per user and users
never reach Derive. The site-data branch is force-pushed with a single commit each run, so it
keeps no history. Files:

  markets.json        every perp: price, change, signals, regime, heat, z, ribbon, funding, OI,
                      data status, options summary, sparkline; market-wide context
  coins/{UND}.json    candles (4H, 1D) with signal history, latest rows, options detail
                      (term structure, per-strike open interest and IV, 14-day IV history,
                      implied ranges, open-interest levels, options lean), alignment by horizon
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
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from derive.candles import CandleCache
from derive.quality import ANALYTICS_VERSION, engine_status, snapshot_status
from derive.implied import implied_by_expiry, option_levels
from derive.lean import alignment, options_lean, state_of
from derive import traders as traders_mod
from derive.history import last_complete_day, parse_option

SOURCE = "v2_mainnet"
CANDLES_KEEP = {"4h": 500, "1d": 400}
SIGNAL_DAYS = 120
IV_DAYS = 14
FLOW_LARGE = 80
FLOW_WALLETS = 30


def _days(n: int, now: float) -> list[str]:
    d0 = datetime.fromtimestamp(now, timezone.utc).date()
    return [(d0 - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def _read_csv(p: Path) -> list[dict]:
    return list(csv.DictReader(p.open())) if p.exists() else []


def _num(x):
    try:
        v = float(x)
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


def flow_block(data: Path, now: float) -> dict:
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
    return {"since": int(since_ms // 1000), "coverage": coverage,
            "classes_ready": bool(classes),
            "large": [{k: (_num(v) if k not in ("instrument", "kind", "underlying", "direction", "wallet", "class") else v)
                       for k, v in r.items()} for r in large],
            "wallets": [{"wallet": a, "class": classes.get(a), **{k: round(v, 2) for k, v in w.items()}} for a, w in top]}


COHORT_COINS = ("BTC", "ETH")


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


def cohort_lean(insts: dict, chains: dict, now: float) -> dict:
    net = gross = 0.0
    positions = 0
    complete = True
    for name, cell in insts.items():
        if parse_option(name)[1] <= now:
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
            "score": score, "state": state_of(score), "positions": positions}


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
    for t in doc["traders"]:
        book = _book(t["open"], chains, now)
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
            coins = {}
            for und in list(COHORT_COINS) + ["Other"]:
                insts = per.get(und, {}) if und != "Other" else {i: c for u, d in per.items() if u not in COHORT_COINS for i, c in d.items()}
                coins[und] = cohort_lean(insts, chains, now)
            cohorts[dim].append({"name": name, "wallets": doc["cohort_counts"].get(dim, {}).get(name, 0), "coins": coins})
    _write(site / "traders.json", {"generated_at": int(now), **coverage,
                                   "ranked_total": doc.get("ranked_total"), "traders": rows, "cohorts": cohorts})


def build(data: Path, site: Path, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    sig_p = data / "signals" / "latest.json"
    sig = json.loads(sig_p.read_text()) if sig_p.exists() else {"timeframes": {}, "universe": [], "context": {}}
    rows = {tf: {r["symbol"]: r for r in (sig["timeframes"].get(tf) or {}).get("rows", [])} for tf in ("4h", "1d")}
    cache = CandleCache(data)
    history = signal_history(data, now)
    flows = taker_sides(data, now)
    held = tier_positions(data)
    coverage = history_coverage(held, now)
    chains: dict = {}  # und -> (strikes, index, ts) for valuing traders' positions
    markets = []
    for sym in sig.get("universe", []):
        und = sym.split("-")[0]
        r4, r1 = rows["4h"].get(sym) or {}, rows["1d"].get(sym) or {}
        candles = {}
        for tf, keep in CANDLES_KEEP.items():
            c = cache.load(und, tf)
            candles[tf] = [] if c is None else [[int(c["timestamp"][i] // 1000), *(round(float(c[k][i]), 8) for k in
                                                ("open", "high", "low", "close", "volume"))]
                                                for i in range(max(0, len(c["close"]) - keep), len(c["close"]))]
        closes4 = [b[4] for b in candles["4h"]]
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
        pos = r4.get("positioning") or {}
        price = (opts or {}).get("features", {}).get("index_price") or (closes4[-1] if closes4 else None)
        markets.append({
            "und": und, "symbol": sym, "price": price,
            "chg_24h": change_pct(closes4, 6), "chg_7d": change_pct(closes4, 42),
            "signal_4h": r4.get("signal") if engine_status(r4, now) == "ready" else None,
            "signal_1d": r1.get("signal") if engine_status(r1, now) == "ready" else None,
            "unified": r4.get("unified_signal") if all(engine_status(r, now) == "ready" for r in (r4, r1)) else None,
            "regime_4h": r4.get("regime"), "regime_1d": r1.get("regime"), "z_4h": r4.get("zscore"),
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
                "ts": opts["ts"], "status": opts["status"], **{k: opts["features"].get(k) for k in ("atm_iv_7d", "atm_iv_30d", "atm_iv_90d", "rr25_30d",
                                                                           "bf25_30d", "pc_oi_ratio", "option_oi_contracts")},
                "term": [[round(e["tenor_days"], 3), e["atm_iv"]] for e in opts["expiries"] if e.get("atm_iv") is not None],
                "iv30_hist": [[h[0], h[2]] for h in opts["iv_history"][-96 * 7:] if h[2] is not None][::4]},
            "spark": closes4[-42:],
            "spark_times": [b[0] + 14400 for b in candles["4h"][-42:]],
        })
        _write(site / "coins" / f"{und}.json", {
            "und": und, "symbol": sym, "generated_at": int(now), "candles": candles,
            "backfilled": {tf: cache.counts(und, tf)[1] for tf in CANDLES_KEEP},
            "signals": history.get(und, {}), "latest": {"4h": r4 or None, "1d": r1 or None}, "options": opts,
            "taker_flow": coin_flows, "alignment": align,
        })
    meta = {"analytics_version": ANALYTICS_VERSION, "generated_at": int(now), "bars": {tf: (sig["timeframes"].get(tf) or {}).get("bar_close") for tf in ("4h", "1d")},
            "consensus": {tf: ((sig["timeframes"].get(tf) or {}).get("consensus") or {}).get("consensus") for tf in ("4h", "1d")},
            "consensus_detail": {tf: (sig["timeframes"].get(tf) or {}).get("consensus") for tf in ("4h", "1d")},
            "context": sig.get("context", {})}
    _write(site / "markets.json", {**meta, "coins": markets})
    flow = flow_block(data, now)
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

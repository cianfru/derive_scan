"""Options traders on Derive: a leaderboard, each ranked trader's open positions and recent
activity, and cohorts by results and by size, all from the rebuilt history (derive/history.py).

Market makers are left out everywhere. Ranked: every other wallet with at least RANK_MIN_LEGS
option legs and at least one option that has expired, by option PnL on expired options
(premium received minus paid plus contracts held at expiry x settlement value).

Cohorts (same idea as wallet cohorts on perp venues):
- results: option PnL on expired options, from Giga-Rekt to Money Printer
- size: option premium traded over the wallet's life, from Shrimp to Leviathan
Their open positions are summed per cohort so the app can show how each cohort is positioned.
"""
from __future__ import annotations

import math
from collections import defaultdict

from .history import parse_option

INF = math.inf
PNL_COHORTS = (
    ("Giga-Rekt", -INF, -1e6), ("Full Rekt", -1e6, -100e3), ("Semi-Rekt", -100e3, -10e3), ("Exit Liquidity", -10e3, 0),
    ("Humble Earner", 0, 10e3), ("Grinder", 10e3, 100e3), ("Smart Money", 100e3, 1e6), ("Money Printer", 1e6, INF),
)
SIZE_COHORTS = (
    ("Shrimp", 0, 10e3), ("Fish", 10e3, 100e3), ("Dolphin", 100e3, 1e6), ("Whale", 1e6, 10e6), ("Leviathan", 10e6, INF),
)
RANK_MIN_LEGS = 10
RANKED = 200


def _pick(table, v: float | None) -> str | None:
    if v is None:
        return None
    return next((name for name, lo, hi in table if lo <= v < hi), None)


def pnl_cohort(stats: dict) -> str | None:
    return _pick(PNL_COHORTS, stats.get("option_pnl")) if stats.get("expired") else None


def size_cohort(stats: dict) -> str | None:
    return _pick(SIZE_COHORTS, stats.get("premium_traded"))


def open_positions(scan: dict, as_of: float) -> dict:
    """{wallet: [[instrument, net contracts, average entry price]]} for options not yet expired."""
    out: dict = defaultdict(list)
    for (wallet, name), i in scan["inst"].items():
        o = parse_option(name)
        if not o or o[1] <= as_of or abs(i["net"]) < 1e-9:
            continue
        entry = i.get("entry")
        out[wallet].append([name, round(i["net"], 6), None if entry is None else round(entry, 4)])
    for rows in out.values():
        rows.sort(key=lambda r: (parse_option(r[0])[1], r[0]))
    return out


def build(scan: dict, wallets: dict, as_of: float) -> dict:
    held = open_positions(scan, as_of)
    eligible = {a: v for a, v in wallets.items() if v["class"] != "market_maker"}
    ranked = sorted((a for a, v in eligible.items() if v["legs"] >= RANK_MIN_LEGS and v.get("expired")),
                    key=lambda a: eligible[a]["option_pnl"], reverse=True)
    traders = []
    for rank, a in enumerate(ranked[:RANKED], 1):
        v = eligible[a]
        coins = scan["coins"].get(a) or {}
        traders.append({"address": a, "rank": rank, **{k: v.get(k) for k in (
            "class", "tier", "option_pnl", "perp_pnl", "win_rate", "expired", "premium_traded", "legs", "first", "last",
            "sold_share")},
            "pnl_cohort": pnl_cohort(v), "size_cohort": size_cohort(v),
            "coins": {u: round(x, 2) for u, x in sorted(coins.items(), key=lambda kv: -kv[1])[:4]},
            "open": held.get(a, []), "recent": sorted(scan["recent"].get(a, []), reverse=True)[:120]})
    cohorts = {"pnl": defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0, 0.0]))),
               "size": defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0, 0.0])))}
    counts = {"pnl": defaultdict(int), "size": defaultdict(int)}
    for a, v in eligible.items():
        for dim, name in (("pnl", pnl_cohort(v)), ("size", size_cohort(v))):
            if not name:
                continue
            counts[dim][name] += 1
            for inst, net, _ in held.get(a, []):
                cell = cohorts[dim][name][inst.split("-")[0]][inst]
                cell[0] = round(cell[0] + net, 6)
                cell[1] += 1
                cell[2] = round(cell[2] + abs(net), 6)
    return {"ranked_total": len(ranked), "traders": traders,
            "cohort_counts": {d: dict(c) for d, c in counts.items()},
            "cohort_positions": {d: {c: {u: dict(i) for u, i in us.items()} for c, us in cs.items()} for d, cs in cohorts.items()}}


def mark_position(name: str, net: float, entry: float | None, strikes: dict | None, index: float | None,
                  now: float) -> dict:
    """An open option position valued now: Black-76 at the strike's quoted volatility on the
    index (the recorder's newest chain), its delta in USD and unrealised PnL against the entry."""
    from .history import option_delta, option_price
    und, expiry, strike, cp = parse_option(name)
    out = {"instrument": name, "und": und, "expiry": expiry, "strike": strike, "type": cp, "net": net, "entry": entry,
           "mark": None, "delta_usd": None, "upnl": None}
    if not index:
        return out
    t = max(expiry - now, 0) / (365 * 86400)
    iv = None
    for r in ((strikes or {}).get("expiries") or {}).get(str(expiry), []):
        if abs(float(r[0]) - strike) < 1e-9:
            iv = r[3] if cp == "C" else r[4]
    mark = option_price(index, strike, t, iv, cp) if iv else None
    out["delta_usd"] = round(net * option_delta(index, strike, t, iv or 0.5, cp) * index, 2)
    if mark is not None:
        out["mark"] = round(mark, 4)
        if entry is not None:
            out["upnl"] = round((mark - entry) * net, 2)
    return out

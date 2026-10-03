"""Replay the Questions zone rule and gates over kept option chains, and report how often they pass.

    python questions_sweep.py --data DATA_DIR [--coins BTC,ETH] [--hours 72] [--chains EXTRA_DIR]

Reads {DATA_DIR}/v2_mainnet/{UND}/chains/YYYY-MM-DD/HH.json.gz (hourly for BTC and ETH, daily for
the other coins). --chains adds a folder of further snapshots ({UND}/{unix ts}.json.gz, same
shape). Every snapshot is one gate check. Reports, per coin: the share of headline checks that
pass, how many dates pass per snapshot, how many snapshots show at least one date, and per date
the frozen zone and how often its zone or headline changed. Run it before the gates are fixed, and
again after a few weeks of recording.
"""
from __future__ import annotations

import argparse
import gzip
import json
import statistics
from pathlib import Path

from derive import question_job as qj
from derive import questions as Q


def snapshots(data: Path, und: str, since: float, extra: Path | None) -> list[tuple[int, Path]]:
    out = qj.kept_chains(data, "v2_mainnet", und, since)
    if extra and (extra / und).exists():
        out += [(int(p.name.split(".")[0]), p) for p in (extra / und).glob("*.json.gz") if int(p.name.split(".")[0]) >= since]
    return sorted(out)


def sweep(und: str, snaps: list[tuple[int, Path]]) -> dict:
    coin: dict = {"dates": {}}
    per_snap, checks, zones, heads = [], {}, {}, {}
    for ts, p in snaps:
        try:
            chain = json.load(gzip.open(p, "rt"))
        except (OSError, ValueError):
            continue
        for d in coin["dates"].values():
            d["check_hour"] = None  # one gate check per snapshot
        board = Q.step(und, chain, ts, Q.DEFAULT_SPEC, coin)
        passing = 0
        for e, d in coin["dates"].items():
            if not Q.offered(e, ts) or d["zone"] is None or d["check_hour"] != ts // 3600:
                continue
            ok = bool(d["checks"] and d["checks"][-1])
            passing += ok
            c = checks.setdefault(e, [0, 0])
            c[0] += ok
            c[1] += 1
            zones.setdefault(e, []).append(d["zone"])
            heads.setdefault(e, []).append(d["headline"])
        shown = sum(1 for d in board["dates"] if d["board"])
        live = sum(1 for d in board["dates"] if d["board"] for lv in d["levels"]
                   if lv["state"] == "open" and (lv["yes"] or {}).get("state") == "open" and (lv["no"] or {}).get("state") == "open")
        per_snap.append((ts, passing, shown, live))
    changes = lambda xs: sum(1 for a, b in zip(xs, xs[1:]) if a != b)  # noqa: E731
    return {"snapshots": len(per_snap), "checks": [sum(c[0] for c in checks.values()), sum(c[1] for c in checks.values())],
            "passing_median": statistics.median([x[1] for x in per_snap]) if per_snap else 0,
            "passing_min": min((x[1] for x in per_snap), default=0),
            "with_date": sum(1 for x in per_snap if x[2] > 0), "with_3_dates": sum(1 for x in per_snap if x[1] >= 3),
            "with_live": sum(1 for x in per_snap if x[3] > 0),
            "dates": {e: {"zone": zones[e][-1], "pass": checks[e], "zone_changes": changes(zones[e]),
                          "headline_changes": changes(heads[e])} for e in sorted(checks)}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--coins", default="")
    ap.add_argument("--hours", type=float, default=0, help="only the last N hours (0: all)")
    ap.add_argument("--chains", help="a folder of further snapshots, {UND}/{ts}.json.gz")
    args = ap.parse_args()
    data = Path(args.data)
    extra = Path(args.chains) if args.chains else None
    coins = [c for c in args.coins.split(",") if c] or sorted(p.name for p in (data / "v2_mainnet").iterdir() if p.is_dir())
    for und in coins:
        snaps = snapshots(data, und, 0, extra)
        if args.hours and snaps:
            snaps = [s for s in snaps if s[0] >= snaps[-1][0] - args.hours * 3600]
        r = sweep(und, snaps)
        ok, tot = r["checks"]
        g = f"G {Q.gate(und, 'cost') * 100:.0f}c, S ${Q.gate(und, 'size'):.0f}, zone from {Q.gate(und, 'min_zone_pct') * 100:.1f}%"
        print(f"{und} ({Q.tier(und)}; {g}): {r['snapshots']} snapshots; headline checks passing {ok}/{tot}"
              f" ({ok / tot * 100 if tot else 0:.0f}%); dates passing per snapshot median {r['passing_median']}, min {r['passing_min']};"
              f" snapshots with a date on the board {r['with_date']}, with a two-sided question {r['with_live']}, with 3+ dates passing {r['with_3_dates']}")
        for e, d in r["dates"].items():
            print(f"   {e}: zone {d['zone']:g}, passes {d['pass'][0]}/{d['pass'][1]}, zone changes {d['zone_changes']}, headline changes {d['headline_changes']}")


if __name__ == "__main__":
    main()

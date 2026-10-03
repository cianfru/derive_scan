"""Rebuild the options traders' history one finished UTC day at a time, within a time budget.

    python history_once.py --out DIR [--budget SECONDS]
    python history_once.py --out DIR --due     only report whether a day is waiting (no network)

Reads the oldest day not yet done (from December 2023), up to yesterday, until the budget is used;
the next run carries on (every run while behind, not only recording runs). Once caught up it reads each new day once, an hour after it ends. When
any day was added, wallet classes and tiers are recomputed (history/wallets.json), with the
open option positions of each tier (history/positions.json) and the traders' leaderboard and
cohorts (history/traders.json, derive/traders.py). See derive/history.py.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


# One-time repairs: days written before a parsing fix are read again from Derive. Days holding
# fractional strikes ("XRP-...-1_35-P") were stored with strike 135 instead of 1.35, which made
# their delta, implied volatility and out-of-the-money figures wrong (contracts and premiums were right).
REPAIR = "fractional_strikes"
SCHEMA_VERSION = 3


def is_due(out: Path, now: float) -> bool:
    """A finished day not yet read, or a repair not finished (no network; standard library only)."""
    p = out / "history" / "state.json"
    state = json.loads(p.read_text()) if p.exists() else {}
    done = state.get("done_through")
    last = (datetime.fromtimestamp(now - 3600, timezone.utc) - timedelta(days=1)).date()
    return done is None or date.fromisoformat(done) < last or (bool(done) and state.get("repaired") != REPAIR)


def repair_days(out: Path) -> list[str]:
    """Days whose files hold an instrument with a fractional strike."""
    import gzip
    days = []
    for p in sorted((out / "history" / "days").glob("*.csv.gz")):
        with gzip.open(p, "rt") as fh:
            fh.readline()
            if any("_" in line.split(",", 2)[1] for line in fh):
                days.append(p.name[:10])
    return days


async def run(out: Path, budget: float, now: float | None = None, client=None) -> dict:
    from derive import history, traders
    from derive.client import DeriveClient
    from derive.config import SOURCES, Settings

    now = time.time() if now is None else now
    t0 = time.monotonic()
    own = client is None
    if own:
        client = DeriveClient(SOURCES[Settings().sources[0]]["base"])
    state = history.load_state(out)
    added = []
    try:
        day, last = history.next_day(state), history.last_complete_day(now)
        while day <= last and time.monotonic() - t0 < budget:
            rows = history.day_rows(await history.fetch_day(client, day))
            history.write_day(out, day, rows)
            state["done_through"] = day.isoformat()
            history.save_state(out, state)
            added.append(day.isoformat())
            day = history.next_day(state)
        repaired_now = False
        if state.get("done_through") and state.get("repaired") != REPAIR:
            if "repair_pending" not in state:
                state["repair_pending"] = repair_days(out)
            while state["repair_pending"] and time.monotonic() - t0 < budget:
                fix = date.fromisoformat(state["repair_pending"][0])
                history.write_day(out, fix, history.day_rows(await history.fetch_day(client, fix)))
                state["repair_pending"].pop(0)
                history.save_state(out, state)
            if not state["repair_pending"]:
                state["repaired"] = REPAIR
                state.pop("repair_pending")
                history.save_state(out, state)
                repaired_now = True
        snapshots = [out / "history" / f"{name}.json" for name in ("wallets", "positions", "traders")]
        needs_rebuild = False
        for p in snapshots:
            doc = json.loads(p.read_text()) if p.exists() else {}
            if doc.get("schema_version") != SCHEMA_VERSION or doc.get("through") != state.get("done_through"):
                needs_rebuild = True
        if state.get("done_through") and (added or needs_rebuild or repaired_now):
            uni = out / "universe.json"
            unds = json.loads(uni.read_text()).get("underlyings", []) if uni.exists() else ["BTC", "ETH"]
            settlements = await history.update_settlements(client, out, unds)
            held: dict = {}
            as_of = min(now, datetime.fromisoformat(state["done_through"]).replace(tzinfo=timezone.utc).timestamp() + 86400)
            scan = history.scan_days(out, as_of)
            classes = history.classify(out, settlements, as_of, held, scan=scan)
            meta = {"as_of": int(as_of), "through": state["done_through"], "schema_version": SCHEMA_VERSION}
            (out / "history" / "wallets.json").write_text(json.dumps({**meta, "wallets": classes}, separators=(",", ":")))
            (out / "history" / "positions.json").write_text(json.dumps(
                {**meta, "positions": history.tier_positions(held, classes)}, separators=(",", ":")))
            (out / "history" / "traders.json").write_text(json.dumps(
                {**meta, **traders.build(scan, classes, as_of)}, separators=(",", ":")))
    finally:
        if own:
            await client.close()
    out_doc = {"added": len(added), "through": state.get("done_through")}
    if state.get("repair_pending"):
        out_doc["repair_pending"] = len(state["repair_pending"])
    return out_doc


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--budget", type=float, default=150)
    ap.add_argument("--due", action="store_true", help="print history_due=true|false and exit (no network)")
    a = ap.parse_args()
    if a.due:
        line = f"history_due={'true' if is_due(Path(a.out), time.time()) else 'false'}"
        print(line)
        if os.getenv("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                f.write(line + "\n")
        return
    logging.basicConfig(level=logging.WARNING)
    print(asyncio.run(run(Path(a.out), a.budget)))


if __name__ == "__main__":
    main()

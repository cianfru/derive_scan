"""Rebuild the options traders' history one finished UTC day at a time, within a time budget.

    python history_once.py --out DIR [--budget SECONDS]

Reads the oldest day not yet done (from December 2023), up to yesterday, until the budget is used;
the next run carries on. Once caught up it reads each new day once, an hour after it ends. When
any day was added, wallet classes are recomputed (history/wallets.json). See derive/history.py.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path

from derive import history
from derive.client import DeriveClient
from derive.config import SOURCES, Settings


async def run(out: Path, budget: float, now: float | None = None, client=None) -> dict:
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
        if added:
            uni = out / "universe.json"
            unds = json.loads(uni.read_text()).get("underlyings", []) if uni.exists() else ["BTC", "ETH"]
            settlements = await history.update_settlements(client, out, unds)
            classes = history.classify(out, settlements, now)
            (out / "history" / "wallets.json").write_text(json.dumps(
                {"as_of": int(now), "through": state["done_through"], "wallets": classes}, separators=(",", ":")))
    finally:
        if own:
            await client.close()
    return {"added": len(added), "through": state.get("done_through")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--budget", type=float, default=150)
    a = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)
    print(asyncio.run(run(Path(a.out), a.budget)))


if __name__ == "__main__":
    main()

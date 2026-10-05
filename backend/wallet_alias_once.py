"""Learn the V2 wallet of every subaccount that traded on V3 mainnet in the last days, ahead of the
switch to V3 (derive/wallet_alias.py). Run once while V2 (api.lyra.finance) still answers:

    python wallet_alias_once.py --out DIR [--days 30] [--budget 1200]

Reads each day's option and perp legs from V3 mainnet, newest day first, and looks up each new
subaccount on V2; writes DIR/history/wallet_aliases.json. Reads only public methods. The jobs do
the same lookup for any subaccount they meet later, as long as V2 answers.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from datetime import timedelta
from pathlib import Path


async def seed(out: Path, days: int, budget: float, client=None) -> dict:
    from derive import history
    from derive.client import DeriveClient
    from derive.config import SOURCES
    from derive.wallet_alias import attach, detach

    t0 = time.monotonic()
    own = client is None
    client = client or DeriveClient(SOURCES["v3_mainnet"]["base"])
    alias = attach(client, "v3_mainnet", out)
    read = []
    try:
        day = history.last_complete_day(time.time(), settle_sec=0)
        for _ in range(days):
            left = budget - (time.monotonic() - t0)
            if left <= 0:
                break
            alias.budget = left
            await history.fetch_day(client, day)
            read.append(day.isoformat())
            day -= timedelta(days=1)
    finally:
        await detach(client)
        if own:
            await client.close()
    known = alias.map
    return {"days": read, "subaccounts": len(known), "named_on_v2": sum(1 for v in known.values() if v),
            "lookup_errors": alias.stats["lookup_errors"], "seconds": round(time.monotonic() - t0, 1)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--budget", type=float, default=1200)
    a = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)
    print(json.dumps(asyncio.run(seed(Path(a.out), a.days, a.budget))))


if __name__ == "__main__":
    main()

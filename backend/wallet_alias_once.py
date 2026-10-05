"""Learn the owner's wallet (V3) of every subaccount that traded on V3 mainnet in the last days, and
the Derive Wallet (V2) of those whose history is kept under it (derive/wallet_alias.py):

    python wallet_alias_once.py --out DIR [--days 30] [--budget 60]

Reads each finished day's option and perp legs from V3 mainnet, newest first, skipping days already
read (`owner_days` in DIR/history/wallet_aliases.json), until the budget is used; the next run
carries on. Each leg names its subaccount's owner; a subaccount whose Derive Wallet is not known
and whose owner has none known yet is looked up once on V2 while V2 answers. Public methods only.
The Action runs it after every flow run, so the 30 days fill in a few runs and then each new day is
read once.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from datetime import timedelta
from pathlib import Path

SETTLE_SEC = 3600  # a day is marked read once it ended this long ago


async def seed(out: Path, days: int, budget: float, client=None, now: float | None = None) -> dict:
    from derive import history
    from derive.client import DeriveClient
    from derive.config import SOURCES
    from derive.wallet_alias import attach, detach

    t0 = time.monotonic()
    now = time.time() if now is None else now
    own = client is None
    client = client or DeriveClient(SOURCES["v3_mainnet"]["base"])
    alias = attach(client, "v3_mainnet", out)
    read, skipped = [], 0
    try:
        newest = history.last_complete_day(now, settle_sec=0)
        settled = history.last_complete_day(now, settle_sec=SETTLE_SEC)
        day = newest
        for _ in range(days):
            if day.isoformat() in alias.owner_days:
                skipped += 1
                day -= timedelta(days=1)
                continue
            left = budget - (time.monotonic() - t0)
            if left <= 0:
                break
            alias.budget = left
            await history.fetch_day(client, day)
            if day <= settled:
                alias.mark_day(day.isoformat())
                alias.save()
            read.append(day.isoformat())
            day -= timedelta(days=1)
    finally:
        await detach(client)
        if own:
            await client.close()
    canon = alias.canon()
    return {"days": read, "skipped_days": skipped, "subaccounts": len(alias.map), "owners": len(alias.owners),
            "translated_scws": len(canon), "conflicts": len(canon.conflicts),
            "lookup_errors": alias.stats["lookup_errors"], "seconds": round(time.monotonic() - t0, 1)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--budget", type=float, default=60)
    a = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)
    print(json.dumps(asyncio.run(seed(Path(a.out), a.days, a.budget))))


if __name__ == "__main__":
    main()

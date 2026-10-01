"""Record the current 15-minute slot into plain files, once. Run on a schedule (GitHub Actions).

    python record_once.py --out DIR           record every source:underlying not yet recorded for this slot
    python record_once.py --out DIR --due     only report whether anything is due (no network)

The schedule fires more often than the slot length, so a late or skipped run is caught by the
next one; a slot already recorded is never recorded twice.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

from derive.config import Settings
from derive.filestore import FileStore


def due_keys(settings: Settings, store: FileStore, slot: int) -> set[str]:
    status = store.load_status()
    keys = {f"{s}:{u}" for s in settings.sources for u in settings.underlyings}
    return {k for k in keys if not (status.get(k, {}).get("ok") and status[k].get("ts") == slot)}


async def record(settings: Settings, store: FileStore, slot: int, keys: set[str]) -> dict[str, dict]:
    from derive.recorder import Recorder  # needs httpx; the --due check does not

    rec = Recorder(settings, store)
    try:
        await rec.run_once(slot, only=keys)
    finally:
        await rec.close()
    store.record_runs(slot, rec.status)
    return rec.status


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="data directory (the checked-out data branch)")
    ap.add_argument("--due", action="store_true", help="print due=true|false and exit")
    args = ap.parse_args()
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s %(message)s")

    settings = Settings(data_dir=Path(args.out))
    store = FileStore(args.out)
    slot = int(time.time()) // settings.interval_sec * settings.interval_sec
    keys = due_keys(settings, store, slot)

    if args.due:
        line = f"due={'true' if keys else 'false'}"
        print(line)
        if os.getenv("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                f.write(line + "\n")
        return 0
    if not keys:
        print(f"slot {slot} already recorded")
        return 0
    status = asyncio.run(record(settings, store, slot, keys))
    print(json.dumps(status, indent=1))
    # Fail the run only when nothing at all was recorded, so a dead source shows in Actions.
    return 0 if any(v.get("ok") for v in status.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

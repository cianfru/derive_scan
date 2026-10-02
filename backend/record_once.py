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


UNIVERSE_TTL = 3600


def load_universe(out: Path) -> dict:
    p = out / "universe.json"
    return json.loads(p.read_text()) if p.exists() else {}


async def discover(settings: Settings, out: Path, now: float) -> list[str]:
    """Coins with options on Derive (`public/get_all_currencies`), refreshed hourly."""
    from derive.client import DeriveClient
    from derive.config import SOURCES

    uni = load_universe(out)
    if uni.get("underlyings") and now - uni.get("at", 0) < UNIVERSE_TTL:
        return uni["underlyings"]
    client = DeriveClient(SOURCES[settings.sources[0]]["base"])
    try:
        res = await client.public("get_all_currencies", {})
    finally:
        await client.close()
    unds = sorted(c["currency"] for c in res if "option" in (c.get("instrument_types") or []))
    (out / "universe.json").write_text(json.dumps({"at": int(now), "underlyings": unds}))
    return unds


async def record_flow(settings: Settings, out: Path) -> dict:
    from derive import flow
    from derive.client import DeriveClient
    from derive.config import SOURCES

    client = DeriveClient(SOURCES[settings.sources[0]]["base"])
    try:
        return await flow.update(client, out, int(time.time() * 1000))
    finally:
        await client.close()


def due_keys(settings: Settings, store: FileStore, slot: int) -> set[str]:
    status = store.load_status()
    keys = {f"{s}:{u}" for s in settings.sources for u in settings.underlyings}
    return {k for k in keys if not (status.get(k, {}).get("ok") and status[k].get("ts") == slot)}


async def record(settings: Settings, store: FileStore, slot: int, keys: set[str],
                 site: Path | None = None) -> dict[str, dict]:
    from derive.recorder import Recorder  # needs httpx; the --due check does not

    rec = Recorder(settings, store)
    try:
        await rec.run_once(slot, only=keys)
    finally:
        await rec.close()
    store.record_runs(slot, rec.status)
    if site is not None:  # per-strike views for the app (published, not kept in the data branch)
        for key, doc in rec.strikes.items():
            source, und = key.split(":")
            if source == settings.sources[0]:
                p = site / "strikes" / f"{und}.json"
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(doc, separators=(",", ":")))
    return rec.status


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="data directory (the checked-out data branch)")
    ap.add_argument("--due", action="store_true", help="print due=true|false and exit")
    ap.add_argument("--site", help="also write per-strike views here (the site-data checkout)")
    args = ap.parse_args()
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s %(message)s")

    settings = Settings(data_dir=Path(args.out))
    store = FileStore(args.out)
    out, now = Path(args.out), time.time()
    slot = int(now) // settings.interval_sec * settings.interval_sec
    if not os.getenv("DERIVE_UNDERLYINGS"):
        # Every coin with options. The due check reads the last list (no network).
        known = load_universe(out).get("underlyings")
        if args.due:
            settings.underlyings = known or settings.underlyings
        else:
            try:
                settings.underlyings = asyncio.run(discover(settings, out, now))
            except Exception as e:
                logging.warning("discovery failed, using the last list: %s", e)
                settings.underlyings = known or settings.underlyings
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
    status = asyncio.run(record(settings, store, slot, keys, Path(args.site) if args.site else None))
    try:
        print("flow:", asyncio.run(record_flow(settings, out)))
    except Exception as e:  # the radar's feed must never stop the options recording
        logging.warning("flow update failed: %s", e)
    print(json.dumps(status, indent=1))
    # Fail the run only when nothing at all was recorded, so a dead source shows in Actions.
    return 0 if any(v.get("ok") for v in status.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

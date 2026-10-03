"""Collect live flow and recover missing recent buckets independently of options snapshots.

    python flow_once.py --out DIR [--budget 120] [--max-intervals 8]
    python flow_once.py --out DIR --due

Recovery queries Derive's public trade history for actual missing complete buckets in the
last seven days. Newest gaps come first so the 24-hour view becomes complete first. Work is
bounded per invocation; interrupted writes and unfinished queries are retried on later runs.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
from pathlib import Path

from derive import flow


def is_due(out: Path, now: float) -> bool:
    if (out / "flow" / ".pending.json").exists():
        return True
    p = out / "flow" / "state.json"
    state = json.loads(p.read_text()) if p.exists() else {}
    boundary = int(now) // flow.BUCKET_SECONDS * flow.BUCKET_SECONDS * 1000
    return state.get("v2_checked_through", -1) < boundary or bool(flow.missing_intervals(out, now))


async def run(out: Path, budget: float = 120, max_intervals: int = 8, now: float | None = None,
              client=None) -> dict:
    if budget <= 0 or max_intervals < 1:
        raise ValueError("Flow budget and max-intervals must be positive")
    from derive.client import DeriveClient
    from derive.config import SOURCES, Settings

    now = time.time() if now is None else now
    now_ms = int(now * 1000)
    started = time.monotonic()
    deadline = started + budget
    own_client = client is None
    if own_client:
        client = DeriveClient(SOURCES[Settings().sources[0]]["base"])
    previous_calls = getattr(client, "calls", 0)
    try:
        try:
            live = await flow.update(client, out, now_ms, deadline=min(deadline, time.monotonic() + 45))
        except Exception as exc:
            logging.warning("live flow collection failed; retry remains due: %s", exc)
            live = {"error": str(exc)}
        recovery = await flow.recover_recent(client, out, now_ms, budget=budget,
                                             max_intervals=max_intervals, deadline=deadline)
        result = {"live": live, "recovery": recovery,
                  "requests": getattr(client, "calls", previous_calls) - previous_calls,
                  "elapsed_seconds": round(time.monotonic() - started, 2)}
        flow._atomic_text(out / "flow" / "status.json", json.dumps({"checked_at": int(now), **result}))
        return result
    finally:
        if own_client:
            await client.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--budget", type=float, default=120)
    parser.add_argument("--max-intervals", type=int, default=8)
    parser.add_argument("--due", action="store_true", help="print flow_due=true|false without network")
    args = parser.parse_args()
    out = Path(args.out)
    if args.due:
        line = f"flow_due={'true' if is_due(out, time.time()) else 'false'}"
        print(line)
        if os.getenv("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
                fh.write(line + "\n")
        return 0
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    result = asyncio.run(run(out, budget=args.budget, max_intervals=args.max_intervals))
    print(json.dumps(result))
    return 1 if result["live"].get("error") or result["recovery"]["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

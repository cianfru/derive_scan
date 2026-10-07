from __future__ import annotations

import argparse
import json
import math
import time
import urllib.request
from pathlib import Path

MAX_AGE = 2700


def problems(doc: dict, now: float) -> list[str]:
    errors = []

    def fresh(label, stamp, age):
        if not isinstance(stamp, (int, float)) or not math.isfinite(stamp) or stamp > now or now - stamp > age:
            errors.append(f"{label}: missing or stale timestamp")

    fresh("publication", doc.get("generated_at"), MAX_AGE)
    recordings = doc.get("recordings") or {}
    if not recordings:
        errors.append("recordings: missing")
    for key, status in recordings.items():
        if status.get("ok") is not True:
            errors.append(f"{key}: recording failed")
        fresh(key, status.get("ts"), MAX_AGE)
    for tf, age in (("4h", 14400), ("1d", 86400)):
        fresh(f"signals {tf}", (doc.get("signals") or {}).get(tf), age + MAX_AGE)
    if doc.get("questions_required") or doc.get("questions") is not None:
        fresh("questions", doc.get("questions"), MAX_AGE)
    if doc.get("coverage_required") or "coverage" in doc:
        coverage = doc.get("coverage") or {}
        if coverage.get("ready") is not True:
            errors.append("wallet history: incomplete coverage")
        if coverage.get("gaps", 0):
            errors.append("wallet history: unreconciled gaps")
    if doc.get("flow_required") or "flow" in doc:
        flow = doc.get("flow") or {}
        fresh("flow collection", flow.get("checked_at"), MAX_AGE)
        if flow.get("live_ok") is not True:
            errors.append("flow collection: failed or unavailable")
        windows = flow.get("coverage") or {}
        incomplete = [window for window in ("24h", "7d") if (windows.get(window) or {}).get("ready") is not True]
        if incomplete:
            # A bounded collector may need several runs to fill a gap. The publisher retains the
            # first degraded time, so recent recovery cannot mask a persistent coverage problem.
            since = flow.get("degraded_since")
            recovering = isinstance(since, (int, float)) and math.isfinite(since) and 0 <= now - since <= MAX_AGE
            if not recovering:
                errors.append(f"flow coverage: incomplete {', '.join(incomplete)}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    args = parser.parse_args()
    if args.source.startswith("https://"):
        with urllib.request.urlopen(args.source, timeout=30) as response:
            doc = json.load(response)
    else:
        doc = json.loads(Path(args.source).read_text())
    errors = problems(doc, time.time())
    for error in errors:
        print(error)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())

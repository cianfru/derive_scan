"""Rebuild the options traders' history one finished UTC day at a time, within a time budget.

    python history_once.py --out DIR [--budget SECONDS]
    python history_once.py --out DIR --due     only report whether a day is waiting (no network)

Reads the oldest day not yet done (from December 2023), up to yesterday, until the budget is used;
the next run carries on (every run while behind, not only recording runs). Once caught up it reads each new day once, an hour after it ends. When
any day was added, wallet classes and tiers are recomputed (history/wallets.json), with the
open option positions of each tier (history/positions.json) and the traders' leaderboard and
cohorts (history/traders.json, derive/traders.py). See derive/history.py. Wallets carry their
owner's name (derive/wallet_alias.py): legs read from V2 are renamed as they are read, older rows
when the files are rebuilt, which also happens when new owner names were learned (at most once
an hour, ALIAS_REBUILD_EVERY).

Then each new day adds one row per coin with options to history/surface/{UND}.csv: the day's
volatility readings rebuilt from its traded options (derive/surface_history.py). A new
SURFACE_VERSION rebuilds every row once, within the budget over as many runs as it needs, into
history/surface_rebuild/, which then replaces history/surface/. No network call.

Each new day's close is also appended to history/balance.json: the Smart wallets' option delta
balance per coin, from the positions just rebuilt, valued with the chain recorded at the close
(derive/balance_history.py). The last BALANCE_CLOSES closes are rebuilt once (point-in-time
tiers) by a backfill, and again when a catch-up skipped a close. The backfill never shares a run
with a new day or the surface rebuild, and waits for BALANCE_MIN_BUDGET seconds of budget.

A reading that does not reconcile (history.fetch_day keeps the deduplicated legs and notes it in
history/anomalies.json) is also queued in state["retry"] as [day, query, attempts, next_try]
(query "option", "perp" or an instrument). Later runs read it again, at most RETRY_PER_RUN per run
within the budget and each no sooner than RETRY_EVERY after its last try; only an exact reading
replaces the day's rows, then the wallet files are rebuilt and the balance closes backfilled again.
The wallet files carry the unresolved count ("gaps") and days ("gap_days") until the queue is empty.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import shutil
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


# One-time repairs, in order: days written before a fix are read again from Derive.
# "fractional_strikes": days holding fractional strikes ("XRP-...-1_35-P") were stored with strike
# 135 instead of 1.35, which made their delta, implied volatility and out-of-the-money figures wrong
# (contracts and premiums were right); the whole day is read again.
# "paging": offset paging could drop one leg and repeat another while the listed count still
# matched. Every (day, instrument) whose contracts do not net to zero across wallets is read again
# by instrument in exact time slices, replacing only that instrument's rows; then the surface rows
# and the balance closes are rebuilt from the repaired days.
REPAIRS = ("fractional_strikes", "paging")
REPAIR = REPAIRS[-1]
# 4: wallets under their owner's name (derive/wallet_alias.py, owner's decision 5 October 2026).
SCHEMA_VERSION = 5
# The wallet files are rebuilt when the owner names change (history/wallet_aliases.json), at most
# this often; a new day or a schema change rebuilds them anyway.
ALIAS_REBUILD_EVERY = 3600
# Definitions of history/surface (derive/surface_history.py); a new version rebuilds every row.
SURFACE_VERSION = 1
# Definitions of history/balance.json (derive/balance_history.py); a new version rebuilds its closes.
BALANCE_VERSION = 2
BALANCE_CLOSES = 90
BALANCE_MIN_BUDGET = 100  # seconds of budget left for a backfill to start
RETRY_PER_RUN = 4          # unreconciled readings read again per run
RETRY_EVERY = 6 * 3600     # seconds between two tries of one reading


def is_due(out: Path, now: float) -> bool:
    """A finished day not yet read, a repair not finished, surface rows not yet written, or the
    balance backfill pending once wallets are classed (no network; standard library only)."""
    p = out / "history" / "state.json"
    state = json.loads(p.read_text()) if p.exists() else {}
    done = state.get("done_through")
    last = (datetime.fromtimestamp(now - 3600, timezone.utc) - timedelta(days=1)).date()
    retry_due = any(item[3] <= now for item in state.get("retry") or ())
    return done is None or date.fromisoformat(done) < last or retry_due or (bool(done) and (
        state.get("repaired") != REPAIR or state.get("surface") != SURFACE_VERSION or state.get("surface_through") != done
        or (state.get("balance") != BALANCE_VERSION and (out / "history" / "wallets.json").exists())))


def queue_retries(state: dict, anomalies: list[dict], now: float) -> None:
    """Adds each unreconciled reading to state["retry"] once: [day, query, attempts, next_try]."""
    queue = state.setdefault("retry", [])
    held = {(item[0], item[1]) for item in queue}
    for a in anomalies:
        if a.get("reason") == "not_reconciled" and (a["day"], a["query"]) not in held:
            queue.append([a["day"], a["query"], 1, now + RETRY_EVERY])
            held.add((a["day"], a["query"]))


def gaps(state: dict) -> dict:
    """The unresolved readings, as published with the wallet files."""
    queue = state.get("retry") or []
    return {"gaps": len(queue), "gap_days": sorted({item[0] for item in queue})}


async def retry_step(out: Path, state: dict, client, now: float, keep_going) -> list[str]:
    """Reads due items of state["retry"] again (RETRY_PER_RUN at most); an exact reading replaces
    the day's rows for that query and leaves the queue, one that still does not reconcile leaves the
    file as it was and waits RETRY_EVERY. Returns the days resolved."""
    from derive import history

    resolved = []
    due = [item for item in state.get("retry") or () if item[3] <= now][:RETRY_PER_RUN]
    for item in due:
        if not keep_going():
            break
        day, query, anomalies = date.fromisoformat(item[0]), item[1], []
        if query in ("option", "perp"):
            legs = await history.fetch_kind_day(client, day, query, anomalies)
            if not anomalies:
                history.replace_kind(out, day, query, history.day_rows(legs))
        else:
            legs = await history.fetch_instrument_day(client, day, query, anomalies)
            if not anomalies:
                history.replace_instrument(out, day, query, history.day_rows(
                    [t for t in legs if t.get("instrument_name") == query]))
        if anomalies:
            item[2] += 1
            item[3] = now + RETRY_EVERY
        else:
            state["retry"].remove(item)
            resolved.append(item[0])
        history.save_state(out, state)
    if not state.get("retry"):
        state.pop("retry", None)
        history.save_state(out, state)
    return resolved


def next_repair(state: dict) -> str | None:
    """The first repair in REPAIRS not finished yet, or None."""
    done = state.get("repaired")
    i = REPAIRS.index(done) + 1 if done in REPAIRS else 0
    return REPAIRS[i] if i < len(REPAIRS) else None


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


def _days_after(out: Path, after: str | None, through: str) -> list[str]:
    """Saved history days after `after` (all when None), up to `through`."""
    names = (p.name[:10] for p in sorted((out / "history" / "days").glob("*.csv.gz")))
    return [d for d in names if (after is None or d > after) and d <= through]


def _surface_rebuild(out: Path, state: dict, keep_going) -> bool:
    """Rebuilds every surface row into history/surface_rebuild/ (resumable through
    state["surface_pending"]); when done, swaps it in for history/surface/ and returns True."""
    from derive import history, surface_history

    hist, through = out / "history", state["done_through"]
    work = hist / "surface_rebuild"
    if "surface_pending" not in state:
        shutil.rmtree(work, ignore_errors=True)
        state["surface_pending"] = _days_after(out, None, through)
        state.pop("surface_rebuilt_through", None)
        history.save_state(out, state)
    pending = state["surface_pending"]
    if pending:
        pending.extend(_days_after(out, pending[-1], through))
        n = surface_history.extend(out, work, pending, keep_going)
        if n:
            state["surface_rebuilt_through"] = pending[n - 1]
        state["surface_pending"] = pending[n:]
        history.save_state(out, state)  # before the swap, so a run stopped mid-swap finishes it next time
    if state["surface_pending"]:
        return False
    if work.exists():
        old = hist / "surface_old"
        shutil.rmtree(old, ignore_errors=True)
        if (hist / "surface").exists():
            (hist / "surface").rename(old)
        work.rename(hist / "surface")
        shutil.rmtree(old, ignore_errors=True)
    state.pop("surface_pending")
    state["surface"] = SURFACE_VERSION
    state["surface_through"] = state.pop("surface_rebuilt_through", None)
    history.save_state(out, state)
    return True


def surface_step(out: Path, state: dict, keep_going) -> None:
    """Appends the surface rows of saved days not yet in history/surface (derive/surface_history.py);
    a new SURFACE_VERSION first rebuilds them all (_surface_rebuild)."""
    from derive import history, surface_history

    if state.get("surface") != SURFACE_VERSION and not _surface_rebuild(out, state, keep_going):
        return
    through = state["done_through"]
    pending = _days_after(out, state.get("surface_through"), through)
    n = surface_history.extend(out, out / "history" / "surface", pending, keep_going) if pending else 0
    if n == len(pending):
        state["surface_through"] = through
    elif n:
        state["surface_through"] = pending[n - 1]
    history.save_state(out, state)


def balance_step(out: Path, state: dict, *, added: bool, surface_ready: bool, now: float, left: float) -> int | None:
    """The one-time balance backfill (derive/balance_history.py), when the history is caught up,
    no day was added in this run, the surface rebuild had finished before it and at least
    BALANCE_MIN_BUDGET seconds remain; otherwise it waits for a later run. Returns the closes written."""
    from derive import balance_history, history

    done = state.get("done_through")
    if state.get("balance") == BALANCE_VERSION or not done or added or not surface_ready \
            or state.get("repaired") != REPAIR or done < history.last_complete_day(now).isoformat() \
            or left < BALANCE_MIN_BUDGET:
        return None
    if state.get("balance_failed") == BALANCE_VERSION and now - state.get("balance_failed_at", 0) < 86400:
        return None  # a failed backfill is retried once a day, not on every run
    try:
        n = balance_history.backfill(out, BALANCE_CLOSES)
    except Exception as exc:  # the backfill must never fail the history step
        print(f"balance backfill failed: {exc!r}")
        state["balance_failed"], state["balance_failed_at"] = BALANCE_VERSION, now
        history.save_state(out, state)
        return None
    state["balance"] = BALANCE_VERSION
    history.save_state(out, state)
    return n


async def run(out: Path, budget: float, now: float | None = None, client=None) -> dict:
    from derive import balance_history, history, traders
    from derive.client import DeriveClient
    from derive.wallet_alias import canonical
    from derive.config import SOURCES, Settings

    now = time.time() if now is None else now
    t0 = time.monotonic()
    own = client is None
    if own:
        from derive.wallet_alias import attach
        source = Settings().sources[0]
        client = DeriveClient(SOURCES[source]["base"])
        attach(client, source, out)
    state = history.load_state(out)
    # The balance backfill never shares a run with the surface rebuild.
    surface_ready = state.get("surface") == SURFACE_VERSION and "surface_pending" not in state
    added = []
    backfilled = None
    try:
        day, last = history.next_day(state), history.last_complete_day(now)
        while day <= last and time.monotonic() - t0 < budget:
            anomalies: list = []
            rows = history.day_rows(await history.fetch_day(client, day, anomalies))
            history.write_day(out, day, rows)
            history.record_anomalies(out, anomalies)
            queue_retries(state, anomalies, now)
            state["done_through"] = day.isoformat()
            history.save_state(out, state)
            added.append(day.isoformat())
            day = history.next_day(state)
        repaired_now = False
        while state.get("done_through") and next_repair(state):  # each pass finishes a repair or stops
            name = next_repair(state)
            if state.get("repairing", REPAIRS[0]) != name:
                state.pop("repair_pending", None)
            if "repair_pending" not in state:
                state["repairing"] = name
                state["repair_pending"] = repair_days(out) if name == "fractional_strikes" else \
                    [list(pair) for pair in history.imbalanced_pairs(out)]
                history.save_state(out, state)
            while state["repair_pending"] and time.monotonic() - t0 < budget:
                item, anomalies = state["repair_pending"][0], []
                if name == "fractional_strikes":
                    fix = date.fromisoformat(item)
                    history.write_day(out, fix, history.day_rows(await history.fetch_day(client, fix, anomalies)))
                else:
                    fix, instrument = date.fromisoformat(item[0]), item[1]
                    legs = await history.fetch_instrument_day(client, fix, instrument, anomalies)
                    history.replace_instrument(out, fix, instrument, history.day_rows(
                        [t for t in legs if t.get("instrument_name") == instrument]))
                history.record_anomalies(out, anomalies)
                queue_retries(state, anomalies, now)
                state["repair_pending"].pop(0)
                history.save_state(out, state)
            if state["repair_pending"]:
                break
            state["repaired"] = name
            state.pop("repair_pending")
            state.pop("repairing", None)
            if name == "paging":  # rebuild what was derived from the repaired days
                for key in ("surface", "surface_pending", "surface_rebuilt_through", "balance"):
                    state.pop(key, None)
            history.save_state(out, state)
            repaired_now = True
        retried = await retry_step(out, state, client, now, lambda: time.monotonic() - t0 < budget) \
            if state.get("done_through") else []
        if retried and state.pop("balance", None):  # the balance closes rebuild from the completed days
            history.save_state(out, state)
        snapshots = [out / "history" / f"{name}.json" for name in ("wallets", "positions", "traders")]
        needs_rebuild = bool(retried)
        aliases = canonical(out).digest
        for p in snapshots:
            doc = json.loads(p.read_text()) if p.exists() else {}
            if doc.get("schema_version") != SCHEMA_VERSION or doc.get("through") != state.get("done_through") \
                    or doc.get("gaps", 0) != gaps(state)["gaps"]:
                needs_rebuild = True
            elif doc.get("aliases", "") != aliases and now - doc.get("built_at", 0) >= ALIAS_REBUILD_EVERY:
                needs_rebuild = True  # owner names learned since: they apply to the whole history
        if state.get("done_through") and (added or needs_rebuild or repaired_now):
            uni = out / "universe.json"
            unds = json.loads(uni.read_text()).get("underlyings", []) if uni.exists() else ["BTC", "ETH"]
            settlements = await history.update_settlements(client, out, unds)
            held: dict = {}
            as_of = min(now, datetime.fromisoformat(state["done_through"]).replace(tzinfo=timezone.utc).timestamp() + 86400)
            scan = history.scan_days(out, as_of)
            classes = history.classify(out, settlements, as_of, held, scan=scan)
            meta = {"as_of": int(as_of), "through": state["done_through"], "schema_version": SCHEMA_VERSION, **gaps(state),
                    "aliases": scan["aliases"], "built_at": int(now)}
            positions = history.tier_positions(held, classes)
            (out / "history" / "wallets.json").write_text(json.dumps({**meta, "wallets": classes}, separators=(",", ":")))
            (out / "history" / "positions.json").write_text(json.dumps(
                {**meta, "positions": positions, "directional_book": history.directional_book(held, classes)}, separators=(",", ":")))
            (out / "history" / "traders.json").write_text(json.dumps(
                {**meta, **traders.build(scan, classes, as_of, settlements)}, separators=(",", ":")))
            # The close just classed, valued as the live reading was; earlier closes are the backfill's.
            if state["done_through"] >= history.last_complete_day(now).isoformat() and state.get("repaired") == REPAIR:
                if balance_history.append(out, state["done_through"], positions) and state.pop("balance", None):
                    history.save_state(out, state)  # a close was skipped: the backfill fills it
        if state.get("done_through") and state.get("repaired") == REPAIR:
            surface_step(out, state, lambda: time.monotonic() - t0 < budget)
            backfilled = balance_step(out, state, added=bool(added), surface_ready=surface_ready and not repaired_now, now=now,
                                      left=budget - (time.monotonic() - t0))
    finally:
        if own:
            from derive.wallet_alias import detach
            await detach(client)
            await client.close()
    out_doc = {"added": len(added), "through": state.get("done_through")}
    if state.get("repair_pending"):
        out_doc["repair_pending"] = len(state["repair_pending"])
    if state.get("surface_pending"):
        out_doc["surface_pending"] = len(state["surface_pending"])
    if state.get("retry"):
        out_doc["retry_pending"] = len(state["retry"])
    if backfilled is not None:
        out_doc["balance_closes"] = backfilled
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

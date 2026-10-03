"""Trade flow from Derive's public trade feed, kept for the radar (who trades what, and how much).

Every run reads the trades since the last run (`public/get_trade_history`; each trade appears
once per side, with the side's wallet) and appends:

flow/large/YYYY-MM-DD.csv    taker legs at or above the size thresholds, one row each
flow/wallets_v2/YYYY-MM-DD.csv  per trade-time bucket and wallet: legs, perp and option notional,
                             option premium bought and sold, realised PnL, fees
flow/sides_v2/YYYY-MM-DD.csv    per trade-time bucket, coin and kind (call, put, perp): what takers bought and sold
                             (notional and option premium); takers crossed the spread, so this is
                             the aggressive side of the market
flow/coverage_v2/YYYY-MM-DD.csv successful query intervals, including empty intervals and replay provenance
flow/state.json              newest trade time read, trade keys and coverage watermark
flow/.pending.json           interrupted file transaction, replayed before the next collection
flow/recovery.json           bounded trailing-seven-day recovery progress

Only the taker leg of a trade enters the large list (the side that crossed the spread). Wallets
classed as market makers (history/wallets.json, from the rebuilt history) are left out of the
taker sides: their trades show inventory management, not a view.
"""
from __future__ import annotations

import csv
import asyncio
import io
import json
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .client import DeriveClient

log = logging.getLogger(__name__)

BUCKET_SECONDS = 900
COVERAGE_FIELDS = ("from_ms", "through_ms", "source", "queried_at_ms", "legs")
PAGE = 1000
MAX_PAGES = 100
RECENT_SECONDS = 7 * 86400
RECOVERY_CHUNK_SECONDS = 6 * 3600
FIRST_LOOKBACK_MS = 3_600_000
LARGE_PERP_USD = 25_000          # perp notional
LARGE_OPTION_USD = 100_000       # option notional (contracts x index)
LARGE_PREMIUM_USD = 2_000        # option premium paid or received
LARGE_FIELDS = ("ts", "instrument", "kind", "underlying", "direction", "amount", "price", "index_price",
                "notional_usd", "premium_usd", "wallet", "subaccount_id", "rfq", "realized_pnl")
SIDE_FIELDS = ("run_ts", "underlying", "kind", "buy_notional_usd", "sell_notional_usd", "buy_premium_usd",
               "sell_premium_usd", "legs")
WALLET_FIELDS = ("run_ts", "wallet", "legs", "perp_notional_usd", "option_notional_usd", "premium_bought_usd",
                 "premium_sold_usd", "realized_pnl_usd", "fees_usd")


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def kind_of(name: str) -> str:
    return "perp" if name.endswith("-PERP") else "option" if name.count("-") == 3 else "other"


def _day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def _csv_text(fields, rows) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(fields)
    w.writerows(rows)
    return buf.getvalue()


def _read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open() as fh:
        return list(csv.DictReader(fh))


def _append_text(path: Path, fields, rows) -> str:
    old = [[row.get(key, "") or "" for key in fields] for row in _read_rows(path)]
    return _csv_text(fields, old + rows)


def _atomic_text(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w") as fh:
        fh.write(contents)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(temporary, path)


def replay_pending(root: Path | str) -> bool:
    """Finish an interrupted flow write before reading checkpoints or querying again.

    The journal contains final file contents, not increments: replay cannot double-count.
    Data files precede coverage and the checkpoint in its ordered file list.
    """
    root = Path(root) / "flow"
    pending = root / ".pending.json"
    if not pending.exists():
        return False
    files = json.loads(pending.read_text())["files"]
    for relative, contents in files:
        _atomic_text(root / relative, contents)
    pending.unlink()
    return True


def _commit(root: Path, files: list[tuple[Path, str]]) -> None:
    pending = root / ".pending.json"
    _atomic_text(pending, json.dumps({"files": [[str(path.relative_to(root)), contents]
                                               for path, contents in files]}, separators=(",", ":")))
    replay_pending(root.parent)


def leg_key(t: dict) -> str:
    return f"{t.get('trade_id')}:{t.get('wallet')}:{t.get('subaccount_id')}:{t.get('direction')}"


def option_kind(name: str) -> str:
    return "call" if name.endswith("-C") else "put" if name.endswith("-P") else "perp"


def market_makers(root: Path) -> set[str]:
    p = root / "history" / "wallets.json"
    if not p.exists():
        return set()
    return {w for w, v in json.loads(p.read_text()).get("wallets", {}).items() if v.get("class") == "market_maker"}


def sides(trades: list[dict], run_ts: int, exclude: set[str] = frozenset()) -> list[list]:
    """Taker buying and selling per coin and kind, without the excluded wallets."""
    agg: dict = defaultdict(lambda: defaultdict(float))
    for t in trades:
        if t.get("tx_status") == "reverted":
            continue
        if t.get("liquidity_role") != "taker" or t.get("wallet") in exclude:
            continue
        name = t.get("instrument_name", "")
        if kind_of(name) == "other":
            continue
        kind = option_kind(name)
        amount, price, index = _f(t.get("trade_amount")), _f(t.get("trade_price")), _f(t.get("index_price"))
        notional = amount * (price if kind == "perp" else index)
        a = agg[(name.split("-")[0], kind)]
        side = "buy" if t.get("direction") == "buy" else "sell"
        a[f"{side}_notional_usd"] += notional
        if kind != "perp":
            a[f"{side}_premium_usd"] += amount * price
        a["legs"] += 1
    return [[run_ts, und, kind, *[round(v[k], 2) for k in SIDE_FIELDS[3:7]], int(v["legs"])]
            for (und, kind), v in sorted(agg.items())]


def summarise(trades: list[dict], run_ts: int) -> tuple[list[list], list[list]]:
    large, wallets = [], defaultdict(lambda: defaultdict(float))
    for t in trades:
        if t.get("tx_status") == "reverted":
            continue
        name = t.get("instrument_name", "")
        kind = kind_of(name)
        amount, price, index = _f(t.get("trade_amount")), _f(t.get("trade_price")), _f(t.get("index_price"))
        notional = amount * (price if kind == "perp" else index)
        premium = amount * price if kind == "option" else 0.0
        w = wallets[t.get("wallet") or "?"]
        w["legs"] += 1
        w["perp_notional_usd" if kind == "perp" else "option_notional_usd"] += notional
        if kind == "option":
            w["premium_bought_usd" if t.get("direction") == "buy" else "premium_sold_usd"] += premium
        w["realized_pnl_usd"] += _f(t.get("realized_pnl"))
        w["fees_usd"] += _f(t.get("trade_fee"))
        big = (kind == "perp" and notional >= LARGE_PERP_USD) or \
              (kind == "option" and (notional >= LARGE_OPTION_USD or premium >= LARGE_PREMIUM_USD))
        if big and t.get("liquidity_role") == "taker":
            large.append([int(t["timestamp"]), name, kind, name.split("-")[0], t.get("direction"), amount, price, index,
                          round(notional, 2), round(premium, 2), t.get("wallet"), t.get("subaccount_id"),
                          int(bool(t.get("rfq_id"))), _f(t.get("realized_pnl"))])
    wallet_rows = [[run_ts, addr, int(v["legs"]), *[round(v[k], 2) for k in WALLET_FIELDS[3:]]]
                   for addr, v in sorted(wallets.items())]
    large.sort(key=lambda r: r[0])
    return large, wallet_rows


async def fetch_since(client: DeriveClient, since_ms: int, until_ms: int, *,
                      deadline: float | None = None, max_pages: int = MAX_PAGES) -> list[dict]:
    out, page = [], 1
    expected = None
    while True:
        if page > max_pages:
            raise RuntimeError(f"Flow query exceeds the {max_pages}-page limit")
        remaining = deadline - time.monotonic() if deadline is not None else None
        if remaining is not None and remaining <= 0:
            raise TimeoutError("Flow query budget exhausted")
        call = client.public("get_trade_history", {"from_timestamp": since_ms, "to_timestamp": until_ms,
                                                   "page_size": PAGE, "page": page})
        res = await asyncio.wait_for(call, remaining) if remaining is not None else await call
        out.extend(res.get("trades", []))
        pagination = res.get("pagination") or {}
        count = pagination.get("count")
        if count is not None:
            if expected is not None and int(count) != expected:
                raise RuntimeError("Flow pagination count changed during the query")
            expected = int(count)
        if page >= int(pagination.get("num_pages", 1)):
            if expected is not None and len(out) != expected:
                raise RuntimeError(f"Flow query read {len(out)} legs, {expected} listed")
            return out
        page += 1


def event_buckets(trades: list[dict]):
    buckets: dict[int, list] = defaultdict(list)
    for trade in trades:
        bucket = int(trade["timestamp"]) // (BUCKET_SECONDS * 1000) * BUCKET_SECONDS
        buckets[bucket].append(trade)
    return sorted(buckets.items())


async def update(client: DeriveClient, root: Path | str, now_ms: int, *, deadline: float | None = None) -> dict:
    replay_pending(root)
    exclude = market_makers(Path(root))
    root = Path(root) / "flow"
    state_p = root / "state.json"
    state = json.loads(state_p.read_text()) if state_p.exists() else {}
    since = state.get("last_ms", now_ms - FIRST_LOOKBACK_MS)
    if since > now_ms:
        raise ValueError("Flow watermark is in the future")
    seen = set(state.get("keys_at_last", []))
    response = await fetch_since(client, since, now_ms, deadline=deadline)
    trades = list({leg_key(t): t for t in response if leg_key(t) not in seen
                   and since <= int(t["timestamp"]) <= now_ms}.values())
    # New versioned directories leave legacy collection-time aggregates untouched.
    # Every bucket is keyed by trade time, including catch-up after downtime.
    large, _ = summarise(trades, now_ms // 1000)
    files = []
    for day in sorted({_day(r[0]) for r in large}):
        path = root / "large" / f"{day}.csv"
        files.append((path, _append_text(path, LARGE_FIELDS, [r for r in large if _day(r[0]) == day])))
    by_day_wallets, by_day_sides = defaultdict(list), defaultdict(list)
    for bucket, legs in event_buckets(trades):
        _, wallets = summarise(legs, bucket)
        day = _day(bucket * 1000)
        by_day_wallets[day].extend(wallets)
        by_day_sides[day].extend(sides(legs, bucket, exclude))
    for directory, fields, groups in (("wallets_v2", ("bucket_ts", *WALLET_FIELDS[1:]), by_day_wallets),
                                      ("sides_v2", ("bucket_ts", *SIDE_FIELDS[1:]), by_day_sides)):
        for day, rows in groups.items():
            if rows:
                path = root / directory / f"{day}.csv"
                files.append((path, _append_text(path, fields, rows)))
    if trades:
        last = max(int(t["timestamp"]) for t in trades)
        keys = {leg_key(t) for t in trades if int(t["timestamp"]) == last}
        if last == since:
            keys |= seen
        state.update(last_ms=last, keys_at_last=sorted(keys))
    else:
        state.setdefault("last_ms", since)
        state.setdefault("keys_at_last", [])
    # Empty, successfully queried intervals count as collection coverage. A failed fetch
    # never reaches this point. On migration exclude the already-consumed watermark ms.
    # Historical recovery can advance the trade watermark ahead of an older uncovered
    # gap. A live query certifies only the interval it actually read, not that older gap.
    start = max(state.get("v2_checked_through", since), since + int(bool(seen)))
    if now_ms > start:
        path = root / "coverage_v2" / f"{_day(now_ms)}.csv"
        files.append((path, _append_text(path, COVERAGE_FIELDS, [[start, now_ms, "live", now_ms, len(trades)]])))
    state["v2_checked_through"] = now_ms
    state["schema_version"] = 2
    files.append((state_p, json.dumps(state)))
    _commit(root, files)
    return {"legs": len(trades)}


def window_coverage(root: Path, now: float, seconds: int) -> dict:
    """Complete 15-minute buckets ending at or before publication, including empty buckets."""
    end = int(now) // BUCKET_SECONDS * BUCKET_SECONDS
    start = end - seconds
    intervals = []
    directory = root / "flow" / "coverage_v2"
    for path in sorted(directory.glob("*.csv")):
        # Keep the publisher's scan bounded; catch-up intervals can begin before the file day.
        if path.stem < _day(start * 1000):
            continue
        for row in csv.DictReader(path.open()):
            a, b = max(start * 1000, int(row["from_ms"])), min(end * 1000, int(row["through_ms"]))
            if b > a:
                intervals.append((a, b))
    covered, right = 0, start * 1000
    for a, b in sorted(intervals):
        covered += max(0, b - max(a, right))
        right = max(right, b)
    ready = covered >= seconds * 1000
    return {"ready": ready, "status": "ready" if ready else "partial" if covered else "unavailable",
            "start": start, "end": end, "covered_seconds": covered / 1000,
            "required_seconds": seconds, "bucket_seconds": BUCKET_SECONDS,
            "fraction": round(covered / (seconds * 1000), 4)}


def missing_intervals(root: Path | str, now: float, seconds: int = RECENT_SECONDS,
                      chunk_seconds: int = RECOVERY_CHUNK_SECONDS) -> list[tuple[int, int]]:
    """Uncovered whole buckets, newest first, as half-open millisecond query intervals.

    A partially covered bucket is replayed in full. Its old aggregates are replaced rather
    than incremented, so migration boundaries and failed collections need no invented data.
    """
    if seconds <= 0 or seconds % BUCKET_SECONDS or chunk_seconds < BUCKET_SECONDS or chunk_seconds % BUCKET_SECONDS:
        raise ValueError("Recovery windows must be positive multiples of 15 minutes")
    end = int(now) // BUCKET_SECONDS * BUCKET_SECONDS * 1000
    start = end - seconds * 1000
    merged = []
    for path in sorted((Path(root) / "flow" / "coverage_v2").glob("*.csv")):
        if path.stem < _day(start):
            continue
        for row in _read_rows(path):
            a, b = max(start, int(row["from_ms"])), min(end, int(row["through_ms"]))
            if b > a:
                merged.append((a, b))
    ranges = []
    for a, b in sorted(merged):
        if ranges and a <= ranges[-1][1]:
            ranges[-1] = (ranges[-1][0], max(b, ranges[-1][1]))
        else:
            ranges.append((a, b))
    gaps, cursor = [], 0
    bucket_ms = BUCKET_SECONDS * 1000
    for a in range(start, end, bucket_ms):
        b = a + bucket_ms
        while cursor < len(ranges) and ranges[cursor][1] <= a:
            cursor += 1
        covered = cursor < len(ranges) and ranges[cursor][0] <= a and ranges[cursor][1] >= b
        if not covered:
            if gaps and gaps[-1][1] == a:
                gaps[-1] = (gaps[-1][0], b)
            else:
                gaps.append((a, b))
    chunks = []
    for a, b in reversed(gaps):
        while b > a:
            left = max(a, b - chunk_seconds * 1000)
            chunks.append((left, b))
            b = left
    return chunks


def _replace_range(path: Path, fields, rows, start: int, end: int, timestamp_field: str, scale: int) -> str:
    retained = [[row.get(key, "") or "" for key in fields] for row in _read_rows(path)
                if not start <= int(row[timestamp_field]) * scale < end]
    timestamp_index = fields.index(timestamp_field)
    combined = sorted(retained + rows, key=lambda row: int(row[timestamp_index]))
    return _csv_text(fields, combined)


def _recovery_files(root: Path, trades: list[dict], start: int, end: int, exclude: set[str]):
    large, _ = summarise(trades, end // 1000)
    wallets_by_day, sides_by_day = defaultdict(list), defaultdict(list)
    for bucket, legs in event_buckets(trades):
        day = _day(bucket * 1000)
        wallets_by_day[day].extend(summarise(legs, bucket)[1])
        sides_by_day[day].extend(sides(legs, bucket, exclude))
    days = sorted({_day(ms) for ms in range(start // 86_400_000 * 86_400_000, end, 86_400_000)})
    files = []
    for day in days:
        for directory, fields, rows, timestamp, scale in (
                ("large", LARGE_FIELDS, [row for row in large if _day(row[0]) == day], "ts", 1),
                ("wallets_v2", ("bucket_ts", *WALLET_FIELDS[1:]), wallets_by_day[day], "bucket_ts", 1000),
                ("sides_v2", ("bucket_ts", *SIDE_FIELDS[1:]), sides_by_day[day], "bucket_ts", 1000)):
            path = root / directory / f"{day}.csv"
            if rows or path.exists():
                files.append((path, _replace_range(path, fields, rows, start, end, timestamp, scale)))
    return files


async def recover_recent(client: DeriveClient, root: Path | str, now_ms: int, *, budget: float = 120,
                         max_intervals: int = 8, chunk_seconds: int = RECOVERY_CHUNK_SECONDS,
                         deadline: float | None = None) -> dict:
    """Replay missing trailing-seven-day flow without changing wallet-study history.

    Fetches must finish and pagination counts must agree before any interval is committed.
    Each transaction replaces complete buckets, then records public-query provenance and
    updates the live trade watermark if necessary. Interrupted writes replay on the next run.
    """
    if budget <= 0 or max_intervals < 1:
        raise ValueError("Flow recovery budget and max_intervals must be positive")
    root = Path(root)
    replay_pending(root)
    deadline = min(deadline, time.monotonic() + budget) if deadline is not None else time.monotonic() + budget
    plan = missing_intervals(root, now_ms / 1000, chunk_seconds=chunk_seconds)
    completed, legs, errors = 0, 0, []
    exclude = market_makers(root)
    flow_root = root / "flow"
    for start, end in plan[:max_intervals]:
        if time.monotonic() >= deadline:
            break
        try:
            response = await fetch_since(client, start, end - 1, deadline=deadline)
        except TimeoutError:
            break
        except Exception as exc:
            errors.append({"from_ms": start, "through_ms": end, "error": str(exc)})
            break
        trades = list({leg_key(t): t for t in response if start <= int(t["timestamp"]) < end}.values())
        files = _recovery_files(flow_root, trades, start, end, exclude)
        queried_at = int(time.time() * 1000)
        path = flow_root / "coverage_v2" / f"{_day(end - 1)}.csv"
        files.append((path, _append_text(path, COVERAGE_FIELDS,
                                        [[start, end, "public_trade_history_replay", queried_at, len(trades)]])))
        state_p = flow_root / "state.json"
        state = json.loads(state_p.read_text()) if state_p.exists() else {}
        if trades:
            last = max(int(t["timestamp"]) for t in trades)
            if last >= state.get("last_ms", -1):
                keys = {leg_key(t) for t in trades if int(t["timestamp"]) == last}
                if last == state.get("last_ms"):
                    keys.update(state.get("keys_at_last", []))
                state.update(last_ms=last, keys_at_last=sorted(keys))
        state["schema_version"] = 2
        # Recovery may run newest-first: it must never advance the continuous live-query
        # coverage watermark across an older gap. Its own coverage lives in interval files.
        files.append((state_p, json.dumps(state)))
        _commit(flow_root, files)
        completed += 1
        legs += len(trades)
    remaining = missing_intervals(root, now_ms / 1000, chunk_seconds=chunk_seconds)
    result = {"intervals": completed, "legs": legs, "remaining_intervals": len(remaining),
              "ready": not remaining, "errors": errors,
              "coverage": window_coverage(root, now_ms / 1000, RECENT_SECONDS)}
    _atomic_text(flow_root / "recovery.json", json.dumps({"checked_at": now_ms // 1000, **result}))
    return result

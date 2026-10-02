"""Trade flow from Derive's public trade feed, kept for the radar (who trades what, and how much).

Every run reads the trades since the last run (`public/get_trade_history`; each trade appears
once per side, with the side's wallet) and appends:

flow/large/YYYY-MM-DD.csv    taker legs at or above the size thresholds, one row each
flow/wallets_v2/YYYY-MM-DD.csv  per trade-time bucket and wallet: legs, perp and option notional,
                             option premium bought and sold, realised PnL, fees
flow/sides_v2/YYYY-MM-DD.csv    per trade-time bucket, coin and kind (call, put, perp): what takers bought and sold
                             (notional and option premium); takers crossed the spread, so this is
                             the aggressive side of the market
flow/coverage_v2/YYYY-MM-DD.csv successful query intervals, including empty intervals
flow/state.json              newest trade time read, trade keys and coverage watermark

Only the taker leg of a trade enters the large list (the side that crossed the spread). Wallets
classed as market makers (history/wallets.json, from the rebuilt history) are left out of the
taker sides: their trades show inventory management, not a view.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .client import DeriveClient

log = logging.getLogger(__name__)

BUCKET_SECONDS = 900
COVERAGE_FIELDS = ("from_ms", "through_ms")
PAGE = 1000
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


def _append(path: Path, fields, rows) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if new:
        w.writerow(fields)
    w.writerows(rows)
    with path.open("a") as f:
        f.write(buf.getvalue())


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


async def fetch_since(client: DeriveClient, since_ms: int, until_ms: int) -> list[dict]:
    out, page = [], 1
    while True:
        res = await client.public("get_trade_history", {"from_timestamp": since_ms, "to_timestamp": until_ms,
                                                        "page_size": PAGE, "page": page})
        out.extend(res.get("trades", []))
        if page >= (res.get("pagination") or {}).get("num_pages", 1):
            return out
        page += 1


def event_buckets(trades: list[dict]):
    buckets: dict[int, list] = defaultdict(list)
    for trade in trades:
        bucket = int(trade["timestamp"]) // (BUCKET_SECONDS * 1000) * BUCKET_SECONDS
        buckets[bucket].append(trade)
    return sorted(buckets.items())


async def update(client: DeriveClient, root: Path | str, now_ms: int) -> dict:
    exclude = market_makers(Path(root))
    root = Path(root) / "flow"
    state_p = root / "state.json"
    state = json.loads(state_p.read_text()) if state_p.exists() else {}
    since = state.get("last_ms", now_ms - FIRST_LOOKBACK_MS)
    if since > now_ms:
        raise ValueError("Flow watermark is in the future")
    seen = set(state.get("keys_at_last", []))
    response = await fetch_since(client, since, now_ms)
    trades = list({leg_key(t): t for t in response if leg_key(t) not in seen
                   and since <= int(t["timestamp"]) <= now_ms}.values())
    # New versioned directories leave legacy collection-time aggregates untouched.
    # Every bucket is keyed by trade time, including catch-up after downtime.
    large, _ = summarise(trades, now_ms // 1000)
    for day in sorted({_day(r[0]) for r in large}):
        _append(root / "large" / f"{day}.csv", LARGE_FIELDS, [r for r in large if _day(r[0]) == day])
    for bucket, legs in event_buckets(trades):
        _, wallets = summarise(legs, bucket)
        day = _day(bucket * 1000)
        _append(root / "wallets_v2" / f"{day}.csv", ("bucket_ts", *WALLET_FIELDS[1:]), wallets)
        _append(root / "sides_v2" / f"{day}.csv", ("bucket_ts", *SIDE_FIELDS[1:]), sides(legs, bucket, exclude))
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
    start = state.get("v2_checked_through", since + int(bool(seen)))
    if now_ms > start:
        _append(root / "coverage_v2" / f"{_day(now_ms)}.csv", COVERAGE_FIELDS, [[start, now_ms]])
    state["v2_checked_through"] = now_ms
    state["schema_version"] = 2
    root.mkdir(parents=True, exist_ok=True)
    state_p.write_text(json.dumps(state))
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

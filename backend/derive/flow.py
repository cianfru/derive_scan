"""Trade flow from Derive's public trade feed, kept for the radar (who trades what, and how much).

Every run reads the trades since the last run (`public/get_trade_history`; each trade appears
once per side, with the side's wallet) and appends:

flow/large/YYYY-MM-DD.csv    taker legs at or above the size thresholds, one row each
flow/wallets/YYYY-MM-DD.csv  one row per wallet per run: legs, perp and option notional,
                             option premium bought and sold, realised PnL, fees
flow/state.json              newest trade time read, and trade keys at that time

Only the taker leg of a trade enters the large list (the side that crossed the spread).
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

PAGE = 1000
FIRST_LOOKBACK_MS = 3_600_000
LARGE_PERP_USD = 25_000          # perp notional
LARGE_OPTION_USD = 100_000       # option notional (contracts x index)
LARGE_PREMIUM_USD = 2_000        # option premium paid or received
LARGE_FIELDS = ("ts", "instrument", "kind", "underlying", "direction", "amount", "price", "index_price",
                "notional_usd", "premium_usd", "wallet", "subaccount_id", "rfq", "realized_pnl")
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


def summarise(trades: list[dict], run_ts: int) -> tuple[list[list], list[list]]:
    large, wallets = [], defaultdict(lambda: defaultdict(float))
    for t in trades:
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


async def update(client: DeriveClient, root: Path | str, now_ms: int) -> dict:
    root = Path(root) / "flow"
    state_p = root / "state.json"
    state = json.loads(state_p.read_text()) if state_p.exists() else {}
    since = state.get("last_ms", now_ms - FIRST_LOOKBACK_MS)
    seen = set(state.get("keys_at_last", []))
    trades = [t for t in await fetch_since(client, since, now_ms) if leg_key(t) not in seen]
    if trades:
        large, wallets = summarise(trades, now_ms // 1000)
        for day in sorted({_day(r[0]) for r in large}):
            _append(root / "large" / f"{day}.csv", LARGE_FIELDS, [r for r in large if _day(r[0]) == day])
        _append(root / "wallets" / f"{_day(now_ms)}.csv", WALLET_FIELDS, wallets)
        last = max(int(t["timestamp"]) for t in trades)
        state = {"last_ms": last, "keys_at_last": sorted(leg_key(t) for t in trades if int(t["timestamp"]) == last)}
        root.mkdir(parents=True, exist_ok=True)
        state_p.write_text(json.dumps(state))
    return {"legs": len(trades)}

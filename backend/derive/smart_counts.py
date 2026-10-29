"""Daily counts of the Smart options wallets, for Reflex's market history page (its "Derive options" drawer).

At each daily close (00:00 UTC after the day), with that close's classes and tiers (history.classify, as the
wallet files history_once.py writes are built):
- how many Smart wallets (tiers top and smart) hold a net long and a net short options position in BTC, in ETH
  and over all coins together: $1,000 of open delta or more either way, the count form the app uses. Positions
  are valued at the close with Black-76 at the coin's daily index close and the traded implied volatility of the
  time (the instrument's own within 21 days, else the coin's near the money within 7, else the latest seen);
- the premium the Smart wallets of the previous close paid that day on net new long puts: a wallet's long put
  position growing that day, times its average buy price that day (buying back sold puts left out).

The same point-in-time series Reflex's seed was built with by a replay of every close (RCCE_Scanner
backend/backtest/derive_smart_series.py, group smart_pit), kept here one close at a time so the drawer runs on
past its seed. Context, not a signal.

history/smart_counts.json (data branch)
  schema   SCHEMA
  columns  COLUMNS: day, BTC and ETH daily index closes, then per coin (BTC, ETH, ALL) wallets long, wallets
           short and the day's premium on new puts (null the day after a missing close: the cohort is unknown)
  rows     one per close, oldest first, from START
  smart    the Smart wallets of the newest close, for the next day's puts
smart_counts.json (app files): schema, columns, through, rows (the last PUBLISH_ROWS).
"""
from __future__ import annotations

import json
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import history as H
from .balance_history import close_ts, day_ts, index_closes, recent_ivs

SCHEMA = 1
START = "2026-10-21"        # a week inside Reflex's seed (it ends 27 October 2026), so the two can be compared
COINS = ("BTC", "ETH", "ALL")
COUNT_MIN = 1_000           # a wallet counts long or short from $1,000 of open delta
SMART = ("top", "smart")
YEAR = 365 * 86400
IV_LOOKBACK = 100_000       # days of trades read for the implied volatility: all, as the seed's replay keeps them
PUBLISH_ROWS = 120
COLUMNS = ["day", "btc", "eth"] + [f"{c}.{k}" for c in COINS for k in ("long", "short", "puts")]


def path(root: Path) -> Path:
    return root / "history" / "smart_counts.json"


def read(root: Path) -> dict:
    try:
        doc = json.loads(path(root).read_text())
    except (FileNotFoundError, ValueError):
        return {}
    return doc if doc.get("schema") == SCHEMA else {}


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _keys(und: str) -> tuple:
    return (und, "ALL") if und in ("BTC", "ETH") else ("ALL",)


def close_row(day: str, classes: dict, held: dict, inst: dict, day_rows: list[dict], prev_smart: set | None,
              ivs, closes: dict) -> tuple[list, set]:
    """(the close's row, its Smart wallets). held: {(wallet, instrument): net contracts} open at the close;
    inst: history.scan_days' per-(wallet, instrument) totals up to the close; day_rows: the day's rows under
    canonical names; ivs: balance_history.TradeIVs with the trades up to the day; closes: index_closes."""
    as_of, bar = close_ts(day), day_ts(day)
    smart = {w for w, v in classes.items() if (v or {}).get("tier") in SMART}
    units: dict = {}

    def unit(name):
        if name not in units:
            o, res = ivs.opt(name), None
            if o:
                und, exp, k, cp = o
                idx = closes.get(und, {}).get(bar)
                if idx and exp > as_of:
                    iv = ivs.iv_for(name, und, day)
                    if not iv:
                        got = ivs.inst.get(name) or ivs.und.get(und)
                        iv = got[1] if got else None
                    if iv:
                        res = H.option_delta(idx, k, (exp - as_of) / YEAR, iv, cp) * idx
            units[name] = res
        return units[name]

    open_delta: dict = defaultdict(lambda: defaultdict(float))   # wallet -> und -> open delta
    for (w, name), net in held.items():
        if w in smart:
            u = unit(name)
            if u is not None:
                open_delta[w][ivs.opt(name)[0]] += net * u
    out = {c: [0, 0, 0.0] for c in COINS}
    for by in open_delta.values():
        total = 0.0
        for und, v in by.items():
            if und in ("BTC", "ETH"):
                out[und][0] += v >= COUNT_MIN
                out[und][1] += v <= -COUNT_MIN
            total += v
        out["ALL"][0] += total >= COUNT_MIN
        out["ALL"][1] += total <= -COUNT_MIN

    if prev_smart is None:
        for c in COINS:
            out[c][2] = None
    else:
        for r in day_rows:
            name, w = r["instrument"], r["wallet"]
            o = ivs.opt(name)
            if not o or o[3] != "P" or w not in prev_smart:
                continue
            buy, sell = _f(r["buy_contracts"]), _f(r["sell_contracts"])
            if buy <= 0:
                continue
            after = (inst.get((w, name)) or {}).get("net", 0.0)    # one row per wallet and instrument a day
            before = after - (buy - sell)
            opened = max(0.0, max(after, 0.0) - max(before, 0.0))
            if opened:
                for c in _keys(o[0]):
                    out[c][2] += opened * _f(r["buy_value_usd"]) / buy

    price = lambda und: None if closes.get(und, {}).get(bar) is None else round(closes[und][bar], 2)
    row = [day, price("BTC"), price("ETH")]
    for c in COINS:
        row += [int(out[c][0]), int(out[c][1]), None if out[c][2] is None else int(round(out[c][2]))]
    return row, smart


def _day_rows(root: Path, day: str) -> list[dict]:
    from .wallet_alias import canonical
    p = root / "history" / "days" / f"{day}.csv.gz"
    return H.canonical_rows(H.read_day(p), canonical(root), H.Members()) if p.exists() else []


def _write(root: Path, doc: dict) -> None:
    path(root).parent.mkdir(parents=True, exist_ok=True)
    path(root).write_text(json.dumps(doc, separators=(",", ":")))


def append(root: Path, day: str, classes: dict, held: dict, scan: dict, ivs=None, closes=None) -> bool:
    """Add the close of `day` (after the rows before it) from the classes, open positions and scan of that close.
    False when the day is already there or older than the newest row."""
    doc = read(root) or {"schema": SCHEMA, "columns": COLUMNS, "rows": [], "smart": []}
    rows = doc["rows"]
    if rows and rows[-1][0] >= day:
        return False
    prev = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    prev_smart = set(doc.get("smart") or ()) if rows and rows[-1][0] == prev else None
    closes = index_closes(root) if closes is None else closes
    ivs = recent_ivs(root, day, closes, IV_LOOKBACK) if ivs is None else ivs
    row, smart = close_row(day, classes, held, scan["inst"], _day_rows(root, day), prev_smart, ivs, closes)
    rows.append(row)
    doc.update(smart=sorted(smart), through=day)
    _write(root, doc)
    return True


def missing(root: Path, through: str) -> list[str]:
    """Days from START (or after the newest row) to `through` without a row, oldest first."""
    rows = read(root).get("rows") or []
    d = date.fromisoformat(rows[-1][0]) + timedelta(days=1) if rows else date.fromisoformat(START)
    out = []
    while d.isoformat() <= through:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


MIN_SECONDS = 30            # a close classed here takes about 25 s; none starts with less left


def catch_up(root: Path, through: str, settlements: dict, built: tuple | None, seconds: float) -> int:
    """Add every missing close up to `through`, oldest first. built: (classes, held, scan) of `through` when the
    wallet files were just rebuilt for it (then its close costs only the volatility read); every other close is
    classed and scanned at its own close (about 25 s). None starts with under MIN_SECONDS of `seconds` left; the
    next run carries on. Returns the closes added."""
    t0, added = time.monotonic(), 0
    closes = index_closes(root)
    for day in missing(root, through):
        if day == through and built is not None:
            added += append(root, day, *built, closes=closes)
            continue
        if seconds - (time.monotonic() - t0) < MIN_SECONDS:
            break
        as_of = datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp() + 86400
        held_d: dict = {}
        scan_d = H.scan_days(root, as_of)
        classes_d = H.classify(root, settlements, as_of, held_d, scan=scan_d)
        added += append(root, day, classes_d, held_d, scan_d, closes=closes)
    return added


def publish(root: Path) -> dict | None:
    """The app file: the last PUBLISH_ROWS closes, without the wallet list."""
    doc = read(root)
    if not doc.get("rows"):
        return None
    return {"schema": SCHEMA, "columns": doc["columns"], "through": doc["through"], "rows": doc["rows"][-PUBLISH_ROWS:]}

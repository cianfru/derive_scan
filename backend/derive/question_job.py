"""Questions, run inside the record step from the tickers the recorder already holds in memory.

Data branch (always, small):
  questions/state.json                  each date's frozen zone, headline and hold, hourly gate checks,
                                        published ids, and each coin's instrument spec
  questions/history/{UND}/{YYYYMMDD}.csv  hourly prices of every published question of that date:
                                        ts,id,fair,yes_buy,yes_sell,no_buy,no_sell,index

App files (site-data), only when publishing is switched on (QUESTIONS_PUBLISH=on):
  questions/index.json                  coins with at least one live question, prices_ts
  questions/{UND}.json                  the board: dates, levels, both answers' prices and legs
  questions/history/{UND}-{YYYYMMDD}.json  one date's hourly prices per question, and its settlement

No exchange reads beyond one settlement-price call per coin after an expiry it holds questions on.
"""
from __future__ import annotations

import csv
import gzip
import json
import logging
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from . import questions as Q

log = logging.getLogger(__name__)

SCHEMA = 1
HIST_COLS = ["ts", "id", "fair", "yes_buy", "yes_sell", "no_buy", "no_sell", "index"]
REBUILD_HOURS = 72  # a missing state is rebuilt from at most this many hours of kept chains
SETTLED_ON_BOARD_SEC = 86400
SETTLE_RETRY_SEC = 3600


def publishing() -> bool:
    """The off switch: questions reach the app only with QUESTIONS_PUBLISH=on (default off)."""
    return os.getenv("QUESTIONS_PUBLISH", "off").strip().lower() in ("on", "1", "true", "yes")


def _dump(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))


def load_state(root: Path) -> dict | None:
    p = root / "questions" / "state.json"
    try:
        s = json.loads(p.read_text())
        return s if s.get("schema") == SCHEMA else None
    except (OSError, ValueError):
        return None


def save_state(root: Path, state: dict) -> None:
    p = root / "questions" / "state.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_dump(state))


def _r4(x):
    return None if x is None else round(x, 4)


def append_history(root: Path, und: str, board: dict, coin: dict) -> list[str]:
    """One row per published question per hour; returns the dates written."""
    hour = board["ts"] // 3600
    if coin.get("hist_hour") == hour:
        return []
    coin["hist_hour"] = hour
    written = []
    for d in board["dates"]:
        rows = []
        for lv in d["levels"]:
            if lv["state"] in ("settling",):
                continue
            y, n = lv.get("yes") or {}, lv.get("no") or {}
            rows.append([board["ts"], lv["id"], _r4(lv["fair"]), _r4(y.get("buy")), _r4(y.get("sell")),
                         _r4(n.get("buy")), _r4(n.get("sell")), board["index"]])
        if not rows:
            continue
        p = root / "questions" / "history" / und / f"{d['expiry']}.csv"
        p.parent.mkdir(parents=True, exist_ok=True)
        new = not p.exists()
        with p.open("a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(HIST_COLS)
            w.writerows(["" if v is None else v for v in r] for r in rows)
        written.append(d["expiry"])
    return written


def load_settlements(root: Path, und: str) -> dict:
    p = root / "history" / "settlements" / f"{und}.json"
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return {}


def pending_settlements(state: dict, root: Path, now: float) -> list[str]:
    """Coins holding questions on an expiry that has passed without a saved settlement price."""
    out = []
    for und, coin in state["coins"].items():
        sett = load_settlements(root, und)
        due = [e for e, d in coin["dates"].items() if d.get("ids") and Q.expiry_ts(e) <= now and e not in sett]
        if due and now - state.setdefault("settle_try", {}).get(und, 0) >= SETTLE_RETRY_SEC:
            out.append(und)
    return out


def save_settlements(root: Path, und: str, res: dict) -> None:
    """Merge Derive's public/get_option_settlement_prices answer into history/settlements."""
    p = root / "history" / "settlements" / f"{und}.json"
    prices = load_settlements(root, und)
    for e in (res or {}).get("expiries") or []:
        v = Q._f(e.get("price"))
        if v and e.get("expiry_date"):
            prices[e["expiry_date"]] = v
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_dump(dict(sorted(prices.items()))))


def settled_dates(coin: dict, sett: dict, now: float) -> list[dict]:
    """Expired dates with published questions: settling, or settled with what Yes paid per $1."""
    out = []
    for e, d in sorted(coin["dates"].items()):
        if not d.get("ids") or Q.expiry_ts(e) > now:
            continue
        price = sett.get(e)
        levels = []
        for q, (lo, hi) in sorted(d["ids"].items(), key=lambda x: x[1][0]):
            row = {"id": q, "k": (lo + hi) / 2, "lo": lo, "hi": hi}
            if price is not None:
                row["paid"] = round(Q.payout_yes(price, lo, hi), 4)
            levels.append(row)
        out.append({"expiry": e, "settle_ts": Q.expiry_ts(e), "label": Q.day_label(e),
                    "zone": d.get("zone"), "settle_price": price, "levels": levels})
    return out


def prune(state: dict, root: Path, now: float) -> None:
    keep = Q.QUESTION_GATES["history_keep_days"] * 86400
    for und, coin in state["coins"].items():
        for e in list(coin["dates"]):
            if Q.expiry_ts(e) < now - keep or (not coin["dates"][e].get("ids") and Q.expiry_ts(e) <= now):
                coin["dates"].pop(e)
        hdir = root / "questions" / "history" / und
        if hdir.exists():
            for f in hdir.glob("*.csv"):
                if Q.expiry_ts(f.stem) < now - keep:
                    f.unlink()


def history_doc(root: Path, und: str, e: str, coin: dict, sett: dict, now: float) -> dict | None:
    """The published history of one date: columns per question, and its settlement once known."""
    p = root / "questions" / "history" / und / f"{e}.csv"
    d = coin["dates"].get(e)
    if d is None or not d.get("ids"):
        return None
    ts, index, rows = [], [], {}
    if p.exists():
        with p.open() as f:
            r = csv.DictReader(f)
            seen: dict[int, int] = {}
            for row in r:
                t = int(row["ts"])
                if t not in seen:
                    seen[t] = len(ts)
                    ts.append(t)
                    index.append(Q._f(row["index"]))
                i = seen[t]
                col = rows.setdefault(row["id"], {k: [] for k in ("i", "fair", "yb", "ys", "nb", "ns")})
                col["i"].append(i)
                for k, src in (("fair", "fair"), ("yb", "yes_buy"), ("ys", "yes_sell"), ("nb", "no_buy"), ("ns", "no_sell")):
                    col[k].append(Q._f(row[src]))
    # Expired dates keep four points a day.
    if ts and Q.expiry_ts(e) <= now - 86400:
        keep = {i for i, t in enumerate(ts) if t % 21600 == 0} | {len(ts) - 1}
        remap = {old: new for new, old in enumerate(sorted(keep))}
        ts = [ts[i] for i in sorted(keep)]
        index = [index[i] for i in sorted(keep)]
        for col in rows.values():
            pick = [j for j, i in enumerate(col["i"]) if i in remap]
            for k in col:
                col[k] = [remap[col["i"][j]] if k == "i" else col[k][j] for j in pick]
    price = sett.get(e)
    return {"schema": SCHEMA, "und": und, "expiry": e, "settle_ts": Q.expiry_ts(e), "zone": d.get("zone"),
            "ids": {q: lohi for q, lohi in d["ids"].items()}, "retired": d.get("retired", []),
            "ts": ts, "index": index, "rows": rows,
            "settle_price": price,
            "paid": {q: round(Q.payout_yes(price, lo, hi), 4) for q, (lo, hi) in d["ids"].items()} if price is not None else None}


def _live_count(board: dict) -> int:
    return sum(1 for d in board["dates"] if d["board"] for lv in d["levels"]
               if lv["state"] == "open" and ((lv["yes"] or {}).get("state") == "open" or (lv["no"] or {}).get("state") == "open"))


def write_site(site: Path, root: Path, boards: dict, state: dict, now: float, prices_ts: int, history_dates: dict) -> None:
    out = site / "questions"
    out.mkdir(parents=True, exist_ok=True)
    coins = []
    for und, board in sorted(boards.items()):
        coin = state["coins"][und]
        sett = load_settlements(root, und)
        settled = [s for s in settled_dates(coin, sett, now)
                   if s["settle_price"] is None or now - s["settle_ts"] <= SETTLED_ON_BOARD_SEC]
        doc = {"schema": SCHEMA, "und": und, "prices_ts": prices_ts, "index": board["index"], "thin": board["thin"],
               "spec": coin.get("spec") or Q.DEFAULT_SPEC, "dates": board["dates"], "settled": settled}
        (out / f"{und}.json").write_text(_dump(doc))
        live = _live_count(board)
        if live:
            coins.append({"und": und, "thin": board["thin"], "index": board["index"], "questions": live,
                          "dates": sum(1 for d in board["dates"] if d["board"])})
        hdir = out / "history"
        hdir.mkdir(exist_ok=True)
        for e in coin["dates"]:
            f = hdir / f"{und}-{e}.json"
            settled_now = e in sett and Q.expiry_ts(e) <= now and not coin["dates"][e].get("hist_settled")
            if e in history_dates.get(und, ()) or not f.exists() or settled_now:
                h = history_doc(root, und, e, coin, sett, now)
                if h:
                    f.write_text(_dump(h))
                    if h["settle_price"] is not None:
                        coin["dates"][e]["hist_settled"] = True
    # Coins without a board this run (none recorded) keep last run's file; drop ones gone from state.
    for f in out.glob("*.json"):
        if f.stem not in ("index",) and f.stem not in state["coins"]:
            f.unlink()
    for f in (out / "history").glob("*.json") if (out / "history").exists() else []:
        und, e = f.stem.rsplit("-", 1)
        if e not in (state["coins"].get(und) or {}).get("dates", {}):
            f.unlink()
    (out / "index.json").write_text(_dump({"schema": SCHEMA, "prices_ts": prices_ts, "generated_at": int(now),
                                           "coins": sorted(coins, key=lambda c: (c["thin"], Q.QUESTION_GATES["majors"].index(c["und"]) if not c["thin"] else 0, -c["questions"]))}))


def kept_chains(root: Path, source: str, und: str, since: float) -> list[tuple[int, Path]]:
    out = []
    for p in sorted((root / source / und / "chains").glob("*/*.json.gz")):
        try:
            day = p.parent.name
            t = int(datetime.fromisoformat(f"{day}T{p.name[:2]}:00:00+00:00").timestamp())
        except ValueError:
            continue
        if t >= since:
            out.append((t, p))
    return out


def new_state() -> dict:
    return {"schema": SCHEMA, "coins": {}, "settle_try": {}}


def rebuild(root: Path, source: str, unds: list[str], now: float, specs: dict) -> dict:
    """A missing state is rebuilt by replaying the kept chains of the last REBUILD_HOURS hours."""
    state = new_state()
    for und in unds:
        coin = state["coins"].setdefault(und, {"dates": {}, "spec": specs.get(und) or dict(Q.DEFAULT_SPEC)})
        for t, p in kept_chains(root, source, und, now - REBUILD_HOURS * 3600):
            try:
                chain = json.load(gzip.open(p, "rt"))
            except (OSError, ValueError):
                continue
            board = Q.step(und, chain, t, coin["spec"], coin)
            append_history(root, und, board, coin)
    return state


def run(root: Path, source: str, chains: dict, specs: dict, slot: int, site: Path | None = None,
        publish: bool | None = None, now: float | None = None) -> dict:
    """Advance every coin's questions by this slot's chains ({und: {"options", "perp"}}).

    Returns {und: board}. Settlement fetches are left to the caller (pending_settlements)."""
    now = time.time() if now is None else now
    publish = publishing() if publish is None else publish
    state = load_state(root)
    if state is None:
        state = rebuild(root, source, sorted(chains), slot, specs)
    boards = {}
    written: dict[str, list[str]] = {}
    for und, chain in sorted(chains.items()):
        coin = state["coins"].setdefault(und, {"dates": {}})
        if specs.get(und):
            coin["spec"] = specs[und]
        coin.setdefault("spec", dict(Q.DEFAULT_SPEC))
        board = Q.step(und, chain, slot, coin["spec"], coin)
        boards[und] = board
        written[und] = append_history(root, und, board, coin)
    prune(state, root, now)
    if site is not None:
        if publish:
            write_site(site, root, boards, state, now, slot, written)
        else:
            remove_site(site)
    save_state(root, state)
    return boards


def remove_site(site: Path) -> None:
    """With publishing off nothing Questions-related stays in the app data."""
    shutil.rmtree(site / "questions", ignore_errors=True)


def mark_paused(site: Path, now: float) -> bool:
    """At publish time: prices older than paused_sec mark the boards paused (the app checks too)."""
    p = site / "questions" / "index.json"
    try:
        idx = json.loads(p.read_text())
    except (OSError, ValueError):
        return False
    paused = now - (idx.get("prices_ts") or 0) > Q.QUESTION_GATES["paused_sec"]
    if bool(idx.get("paused")) == paused:
        return paused
    idx["paused"] = paused
    p.write_text(_dump(idx))
    for f in (site / "questions").glob("*.json"):
        if f.name == "index.json":
            continue
        try:
            doc = json.loads(f.read_text())
        except ValueError:
            continue
        doc["paused"] = paused
        f.write_text(_dump(doc))
    return paused

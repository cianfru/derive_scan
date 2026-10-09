"""Live Saloon prices: the published boards re-priced from Derive's live tickers.

Pure functions only. The 15-minute feed still decides which dates, zones and levels exist (and the
trading lease in questions/index.json); this only refreshes each published level's fair value and
both answers' prices, with the same pricing as the feed (derive.questions.price_level)."""
from __future__ import annotations

from derive import questions as Q

PRICED_STATES = ("open", "tail")  # a level's state is re-derived only from these; others are kept


def level_names(und: str, expiry: str, level_id: str) -> list[str]:
    """The four instruments a level is priced from: the call and put at both ends of its zone."""
    parts = level_id.split("-")
    if len(parts) != 5 or parts[2] != "A":
        return []
    return [f"{und}-{expiry}-{tok}-{kind}" for tok in parts[3:] for kind in ("C", "P")]


def board_names(board: dict) -> set[str]:
    """Every instrument the published board needs live, for the levels that can still trade."""
    und = board.get("und")
    out: set[str] = set()
    for d in board.get("dates") or []:
        for lv in d.get("levels") or []:
            if lv.get("state") in PRICED_STATES:
                out.update(level_names(und, d["expiry"], lv["id"]))
    return out


def _side(new: dict | None, old: dict | None, und: str) -> dict:
    out = Q._side_out(new, und)
    for key in ("smart",):  # annotations added at publishing are kept
        if old and key in old:
            out[key] = old[key]
    return out


def reprice(board: dict, tickers: dict, index: float | None, now: int) -> dict:
    """A copy of a published board with live prices; levels with a missing quote keep theirs.

    tickers: {instrument name: ticker} in Derive's ticker shape (b, a, B, A, M, option_pricing).
    The settling and retired states, ids, zones, ladder and annotations are kept as published."""
    und = board["und"]
    spec = board.get("spec") or Q.DEFAULT_SPEC
    out = dict(board)
    if not index:
        return out
    exs = Q.expiries({n: t for n, t in tickers.items() if n.startswith(f"{und}-")})
    dates = []
    for d in board.get("dates") or []:
        ex = exs.get(d["expiry"])
        levels = []
        for lv in d.get("levels") or []:
            if ex is None or lv.get("state") not in PRICED_STATES:
                levels.append(lv)
                continue
            p = Q.price_level(ex, lv["lo"], lv["hi"], index, spec)
            if p is None:
                levels.append(lv)
                continue
            row = dict(lv)
            row["fair"] = None if p["fair"] is None else round(p["fair"], 4)
            yes_v = (p.get("yes") or {}).get("buy", p["fair"])
            row["state"] = "open" if yes_v is not None and Q.QUESTION_GATES["yes_min"] <= yes_v <= Q.QUESTION_GATES["yes_max"] else "tail"
            row["yes"] = _side(p["yes"], lv.get("yes"), und)
            row["no"] = _side(p["no"], lv.get("no"), und)
            levels.append(row)
        dates.append({**d, "levels": levels})
    out.update(dates=dates, index=index, prices_ts=now, live=True)
    return out


def index_of(und: str, tickers: dict) -> float | None:
    """The coin's index from any of its live tickers (every ticker carries it as I)."""
    best = None
    for n, t in tickers.items():
        if n.startswith(f"{und}-"):
            v = Q._f(t.get("I"))
            ts = t.get("t") or 0
            if v and (best is None or ts > best[1]):
                best = (v, ts)
    return best[0] if best else None


def index_doc(published: dict, live_boards: dict, now: int) -> dict:
    """questions/index.json with the live price time and each coin's live index; the trading
    switches and their lease stay exactly as the feed published them."""
    out = dict(published)
    coins = []
    for c in published.get("coins") or []:
        b = live_boards.get(c.get("und"))
        coins.append({**c, "index": b["index"]} if b and b.get("live") else c)
    out.update(coins=coins, prices_ts=now if any((b or {}).get("live") for b in live_boards.values()) else published.get("prices_ts"))
    return out

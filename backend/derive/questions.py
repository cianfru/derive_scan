"""Questions: plain yes/no price questions built from Derive option spreads (stage 1).

Pure functions only: no network, no file IO. `question_job.py` feeds them the tickers the
recorder already read and keeps the state between runs.

A question "COIN above K on DATE?" is a vertical spread over its zone [lo, hi] (K is the middle):
Yes pays clip((S - lo) / w, 0, 1) per $1 at the settlement price S, No pays the rest. Each answer
can be built two ways (a debit spread, or its put-call twin, a credit spread with Derive holding
the width as margin); the cheaper one at the top of Derive's book is used. Fair is Derive's mark,
clipped into each leg's own bid and ask. Prices are per $1 of payout; nothing here is a chance.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from statistics import median

from .instruments import parse_option_name

# Every gate and threshold, in one place. Coins in "majors" use the strict gates; every other coin
# with options uses the looser "thin" gates and its questions are marked thin in the app.
QUESTION_GATES = {
    "majors": ("BTC", "ETH"),
    "cost": {"major": 0.05, "thin": 0.08},        # G: all-in over fair at `gate_payout`, worse side
    "size": {"major": 50.0, "thin": 25.0},        # S: top-of-book payout, smaller side, $ (also a side's minimum)
    "gate_payout": 1000.0,                        # $ of payout the cost gate is tested at
    "min_zone_pct": {"major": 0.065, "thin": 0.065},  # smallest zone, as a share of the index
    "max_zone_pct": {"major": 1.0, "thin": 0.25},  # thin coins: widest zone tried
    "min_levels": {"major": 4, "thin": 3},        # a zone needs this many valid levels ...
    "level_band": {"major": 0.07, "thin": 0.12},  # ... within this share of the forward
    # How a date's zone is picked at first sight. "min": the smallest qualifying width (BTC, ETH).
    # "gate": thin coins take the smallest qualifying width whose headline passes the gates then,
    # so a coarse, thin book gets the wider zone it needs; either way the zone is then frozen.
    "zone_pick": {"major": "min", "thin": "gate"},
    "ladder": 7, "ladder_more": 15,               # levels shown, and after "More levels"
    "yes_min": 0.03, "yes_max": 0.97,             # Yes buy window for the ladder
    "min_days": 1.0, "max_days": 35.0,            # dates offered (time to the 08:00 UTC expiry)
    "date_window": (3, 4),                        # date shown: headline passes in 3 of the last 4 hourly checks
    "lapse_checks": 4,                            # a shown date goes after this many failed checks in a row
    "headline_hold": 2,                           # slots the forward must sit nearer a new level
    "zone_change_min_days": 7.0,                  # the one allowed zone change, only this far out
    "settling_sec": 1800,                         # "Settling" from 07:30 UTC
    "stale_sec": 35 * 60, "paused_sec": 90 * 60,  # price age: amber, then paused
    "history_keep_days": 90,
}
DEFAULT_SPEC = {"tick": None, "min": None, "step": None, "taker": 0.0003, "base": 0.5, "cap": 0.125}


def tier(und: str) -> str:
    return "major" if und in QUESTION_GATES["majors"] else "thin"


def gate(und: str, key: str) -> float:
    return QUESTION_GATES[key][tier(und)]


def _f(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _r(x: float) -> float:
    """Strike key: fractional strikes compare exactly after rounding."""
    return round(float(x), 8)


def strike_token(name: str) -> str:
    """The strike as Derive writes it in the name ("1_35" for 1.35)."""
    return name.split("-")[2]


# -- the chain ---------------------------------------------------------------------------------
def spec_from_instruments(instruments: list[dict]) -> dict:
    """Tick, amount minimum and step, and the fee inputs, from Derive's instrument definitions."""
    for i in instruments or []:
        if i.get("instrument_type", "option") != "option":
            continue
        return {"tick": _f(i.get("tick_size")), "min": _f(i.get("minimum_amount")), "step": _f(i.get("amount_step")),
                "taker": _f(i.get("taker_fee_rate")) or DEFAULT_SPEC["taker"],
                "base": _f(i.get("base_fee")) if _f(i.get("base_fee")) is not None else DEFAULT_SPEC["base"],
                "cap": _f(i.get("mark_price_fee_rate_cap")) or DEFAULT_SPEC["cap"]}
    return dict(DEFAULT_SPEC)


def quote(t: dict) -> dict:
    return {"b": _f(t.get("b")), "a": _f(t.get("a")), "B": _f(t.get("B")), "A": _f(t.get("A")), "M": _f(t.get("M"))}


def expiries(options: dict) -> dict[str, dict]:
    """{YYYYMMDD: {"strikes": {K: {"C": (name, quote), "P": (name, quote)}}, "fwd": median forward}}."""
    out: dict[str, dict] = {}
    fws: dict[str, list[float]] = {}
    for name, t in (options or {}).items():
        on = parse_option_name(name)
        if on is None:
            continue
        e = out.setdefault(on.expiry_date, {"strikes": {}, "fwd": None})
        e["strikes"].setdefault(_r(on.strike), {})[on.kind] = (name, quote(t))
        f = _f((t.get("option_pricing") or {}).get("f"))
        if f:
            fws.setdefault(on.expiry_date, []).append(f)
    for d, e in out.items():
        e["fwd"] = median(fws[d]) if fws.get(d) else None
    return out


def listed(ex: dict) -> list[float]:
    """Strikes listed with both a call and a put."""
    return sorted(k for k, v in ex["strikes"].items() if "C" in v and "P" in v)


def expiry_ts(yyyymmdd: str) -> int:
    d = datetime.strptime(yyyymmdd, "%Y%m%d").replace(hour=8, tzinfo=timezone.utc)
    return int(d.timestamp())


def days_left(yyyymmdd: str, now: float) -> float:
    return (expiry_ts(yyyymmdd) - now) / 86400


def offered(yyyymmdd: str, now: float) -> bool:
    d = days_left(yyyymmdd, now)
    return QUESTION_GATES["min_days"] <= d <= QUESTION_GATES["max_days"]


# -- labels ------------------------------------------------------------------------------------
_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def day_label(yyyymmdd: str) -> str:
    """"Fri 9 Oct"."""
    d = datetime.strptime(yyyymmdd, "%Y%m%d").date()
    return f"{_DOW[d.weekday()]} {d.day} {_MON[d.month - 1]}"


def date_label(yyyymmdd: str, now: float) -> str:
    """"Mon 5 Oct", "This Friday · 9 Oct", "Fri 16 Oct", "End of Oct · Fri 30 Oct". No "Tomorrow"."""
    d = datetime.strptime(yyyymmdd, "%Y%m%d").date()
    plain = day_label(yyyymmdd)
    if d.weekday() != 4:
        return plain
    if (d + timedelta(days=7)).month != d.month:
        return f"End of {_MON[d.month - 1]} · {plain}"
    today = datetime.fromtimestamp(now, timezone.utc).date()
    if 0 <= (d - today).days < 7:
        return f"This Friday · {d.day} {_MON[d.month - 1]}"
    return plain


# -- pricing -----------------------------------------------------------------------------------
def clip_mark(q: dict) -> float | None:
    m, b, a = q["M"], q["b"], q["a"]
    if m is None:
        return None
    if b is not None and a is not None and b > 0 and a > 0:
        return min(max(m, b), a)
    return m


def leg_fee(index: float, price: float, contracts: float, spec: dict) -> float:
    """Derive's order-book fee for one leg: base + min(taker x index, cap x premium) x contracts."""
    return spec["base"] + min(spec["taker"] * index, spec["cap"] * price) * contracts


def _px(q: dict, side: str) -> float | None:
    """Ask for a buy, bid for a sell; None unless quoted with size."""
    p, s = (q["a"], q["A"]) if side == "buy" else (q["b"], q["B"])
    return p if p is not None and p > 0 and s is not None and s > 0 else None


def _construct(legs: list[tuple[str, dict, str]], w: float, credit: bool) -> dict | None:
    """Cost per $1 of a two-leg package, its sell-back, and its top-of-book size in $ of payout.

    legs: (name, quote, "buy"|"sell"), the bought leg first. A debit package costs the net paid;
    a credit one costs 1 minus the net received (Derive holds the width)."""
    px = [_px(q, s) for _, q, s in legs]
    if any(p is None for p in px):
        return None
    net = sum(p if s == "buy" else -p for p, (_, _, s) in zip(px, legs))  # paid per contract (debit > 0)
    buy = 1 + net / w if credit else net / w
    if not (0 <= buy <= 1):
        return None
    # Sell back the same package: every leg reversed (bid for the bought legs, ask for the sold).
    rev = [_px(q, "sell" if s == "buy" else "buy") for _, q, s in legs]
    sell = None
    if all(p is not None for p in rev):
        got = sum(p if s == "buy" else -p for p, (_, _, s) in zip(rev, legs))  # received per contract
        sell = 1 + got / w if credit else got / w
        sell = sell if 0 <= sell <= 1 else None
    size = min((q["A"] if s == "buy" else q["B"]) for _, q, s in legs) * w
    # Selling back: the short leg is bought back first, then the bought leg sold.
    close = [[n, "sell" if s == "buy" else "buy", p] for (n, _, s), p in zip(legs, rev)][::-1] if sell is not None else None
    return {"buy": buy, "sell": sell, "size": size, "form": "credit" if credit else "debit",
            "legs": [[n, s, p] for (n, _, s), p in zip(legs, px)], "close": close}


def price_level(ex: dict, lo: float, hi: float, index: float, spec: dict, payout: float | None = None) -> dict | None:
    """Fair, and for Yes and No the cheaper construction with its all-in cost over fair at `payout`."""
    payout = payout or QUESTION_GATES["gate_payout"]
    s = ex["strikes"]
    lo_, hi_ = s.get(_r(lo), {}), s.get(_r(hi), {})
    if not all(k in lo_ and k in hi_ for k in ("C", "P")):
        return None
    (lcn, lc), (hcn, hc) = lo_["C"], hi_["C"]
    (lpn, lp), (hpn, hp) = lo_["P"], hi_["P"]
    w = hi - lo
    cl = [clip_mark(x) for x in (lc, hc, lp, hp)]
    if cl[0] is not None and cl[1] is not None:
        fair = (cl[0] - cl[1]) / w
    elif cl[2] is not None and cl[3] is not None:
        fair = 1 - (cl[3] - cl[2]) / w
    else:
        fair = None
    if fair is not None:
        fair = min(max(fair, 0.0), 1.0)
    yes_c = [_construct([(lcn, lc, "buy"), (hcn, hc, "sell")], w, False),
             _construct([(lpn, lp, "buy"), (hpn, hp, "sell")], w, True)]
    no_c = [_construct([(hpn, hp, "buy"), (lpn, lp, "sell")], w, False),
            _construct([(hcn, hc, "buy"), (lcn, lc, "sell")], w, True)]
    n = payout / w

    def pick(cands, fair_side):
        c = [x for x in cands if x]
        if not c:
            return None
        best = min(c, key=lambda x: (round(x["buy"], 12), x["form"] != "debit"))
        fees = sum(leg_fee(index, p, n, spec) for _, _, p in best["legs"]) / payout
        best["over"] = best["buy"] + fees - fair_side if fair_side is not None else None
        return best

    yes = min((x for x in yes_c if x), key=lambda x: (round(x["buy"], 12), x["form"] != "debit"), default=None)
    if fair is not None and yes is not None:
        # The cheaper construction can sit across put-call parity from the clipped calls; keep the
        # order sell-back <= fair <= buy on the screen.
        fair = min(max(fair, yes["sell"] if yes["sell"] is not None else fair), yes["buy"])
    return {"lo": lo, "hi": hi, "k": (lo + hi) / 2, "w": w, "fair": fair,
            "yes": pick(yes_c, fair), "no": pick(no_c, None if fair is None else 1 - fair)}


def side_state(side: dict | None, und: str) -> str:
    if side is None or side["size"] < gate(und, "size"):
        return "no_quote"
    if side["over"] is None or side["over"] > gate(und, "cost"):
        return "screen_wide"
    return "open"


def passes(p: dict | None, und: str) -> bool:
    """The cost and size gates on both answers."""
    return bool(p and side_state(p["yes"], und) == "open" and side_state(p["no"], und) == "open")


def payout_yes(settle: float, lo: float, hi: float) -> float:
    return min(max((settle - lo) / (hi - lo), 0.0), 1.0)


def ticket(side: dict, w: float, index: float, spec: dict, dollars: float | None = None, contracts: float | None = None) -> dict:
    """Contracts for a dollar amount (floored to the amount step), premium, book fees, payout."""
    net = sum(p if s == "buy" else -p for _, s, p in side["legs"])  # per contract, signed (debit > 0)
    cost_per = side["buy"] * w  # cash per contract at risk (credit: width minus credit)
    if contracts is None:
        step = spec.get("step") or 1e-5
        contracts = math.floor(dollars / cost_per / step + 1e-9) * step
        contracts = round(contracts, 8)
    fees = sum(leg_fee(index, p, contracts, spec) for _, _, p in side["legs"])
    return {"contracts": contracts, "net": net, "premium": cost_per * contracts, "fees": fees,
            "payout": contracts * w, "at_k": contracts * w / 2}


# -- levels, zones, headlines ------------------------------------------------------------------
def valid_levels(ks: list[float], w: float) -> list[float]:
    have = set(ks)
    return [k for k in ks if _r(k - w / 2) in have and _r(k + w / 2) in have]


def zone_widths(ks: list[float], fwd: float, band: float) -> list[float]:
    """Symmetric widths made of listed strikes around a listed level near the forward."""
    have = set(ks)
    out = set()
    for k in ks:
        if abs(k - fwd) / fwd > band:
            continue
        for lo in ks:
            if lo >= k:
                break
            if _r(2 * k - lo) in have:
                out.add(_r(2 * (k - lo)))
    return sorted(out)


def choose_zone(ex: dict, index: float, und: str, below: float | None = None, spec: dict | None = None) -> float | None:
    """The smallest width of at least min_zone_pct of the index giving min_levels valid levels
    within level_band of the forward (below: only widths narrower than this). Thin coins also need
    the headline level to pass the gates at that width (zone_pick "gate")."""
    ks = listed(ex)
    fwd = ex["fwd"] or index
    if not ks or not fwd:
        return None
    band = gate(und, "level_band")
    floor_w, ceil_w = gate(und, "min_zone_pct") * index, gate(und, "max_zone_pct") * index
    for w in zone_widths(ks, fwd, band):
        if w < floor_w - 1e-9:
            continue
        if (below is not None and w >= below) or w > ceil_w + 1e-9:
            return None
        levels = valid_levels(ks, w)
        near = [k for k in levels if abs(k - fwd) / fwd <= band]
        if len(near) < gate(und, "min_levels"):
            continue
        if gate(und, "zone_pick") == "gate":
            k = nearest(levels, fwd)
            if not passes(price_level(ex, k - w / 2, k + w / 2, index, spec or DEFAULT_SPEC), und):
                continue
        return w
    return None


def qid(und: str, expiry: str, lo_name: str, hi_name: str) -> str:
    return f"{und}-{expiry}-A-{strike_token(lo_name)}-{strike_token(hi_name)}"


def parse_qid(q: str) -> dict | None:
    parts = q.split("-")
    if len(parts) != 5 or parts[2] != "A":
        return None
    try:
        lo, hi = (float(x.replace("_", ".")) for x in parts[3:])
    except ValueError:
        return None
    return {"und": parts[0], "expiry": parts[1], "lo": lo, "hi": hi}


def nearest(levels: list[float], x: float) -> float | None:
    return min(levels, key=lambda k: (abs(k - x), k)) if levels else None


# -- one snapshot ------------------------------------------------------------------------------
def new_date_state() -> dict:
    return {"zone": None, "zone_set": None, "zone_changes": 0, "headline": None, "cand": None, "cand_n": 0,
            "checks": [], "check_hour": None, "shown": False, "ids": {}, "retired": []}


def step(und: str, chain: dict, ts: int, spec: dict, state: dict) -> dict:
    """Advance one coin's state by one snapshot and return its board.

    state (mutated): {"dates": {YYYYMMDD: date state}}. The board lists every date on the board or
    still holding published ids, with priced levels. One hourly gate check per date per hour."""
    options = chain.get("options") or {}
    perp = chain.get("perp") or {}
    exs = expiries(options)
    index = _f(perp.get("I")) or next((_f(t.get("I")) for t in options.values() if _f(t.get("I"))), None)
    dates = state.setdefault("dates", {})
    hour = ts // 3600
    board = {"und": und, "ts": ts, "index": index, "thin": tier(und) == "thin", "dates": []}
    if not index:
        return board
    for e in sorted(set(exs) | set(dates)):
        exp_ts = expiry_ts(e)
        ex = exs.get(e)
        ds = dates.get(e)
        if ds is None:
            if ex is None or not offered(e, ts):
                continue
            ds = dates[e] = new_date_state()
        if exp_ts <= ts or ex is None:  # expired (or delisted): kept for settlement by the job
            continue
        fwd = ex["fwd"] or index
        ks = listed(ex)
        # Zone: set once a width qualifies; at most one later change toward the minimum.
        if ds["zone"] is None:
            if not offered(e, ts):
                continue
            ds["zone"] = choose_zone(ex, index, und, spec=spec)
            if ds["zone"] is None:
                continue
            ds["zone_set"] = ts
        elif ds["zone_changes"] == 0 and days_left(e, ts) > QUESTION_GATES["zone_change_min_days"]:
            narrower = choose_zone(ex, index, und, below=ds["zone"], spec=spec)
            if narrower:
                ds["retired"] = sorted(set(ds["retired"]) | set(ds["ids"]))
                ds.update(zone=narrower, zone_set=ts, zone_changes=1, headline=None, cand=None, cand_n=0)
        w = ds["zone"]
        levels = valid_levels(ks, w)
        # Headline: the valid level nearest the forward, moved only after a two-slot hold.
        near = nearest(levels, fwd)
        if ds["headline"] is None or _r(ds["headline"]) not in {_r(k) for k in levels}:
            ds["headline"], ds["cand"], ds["cand_n"] = near, None, 0
        elif near is not None and _r(near) != _r(ds["headline"]):
            ds["cand_n"] = ds["cand_n"] + 1 if ds["cand"] is not None and _r(ds["cand"]) == _r(near) else 1
            ds["cand"] = near
            if ds["cand_n"] >= QUESTION_GATES["headline_hold"]:
                ds["headline"], ds["cand"], ds["cand_n"] = near, None, 0
        else:
            ds["cand"], ds["cand_n"] = None, 0
        priced = {k: price_level(ex, k - w / 2, k + w / 2, index, spec) for k in levels}
        # Hourly gate check on the headline; the date shows on 3 of the last 4 (or all, while fewer).
        if ds["check_hour"] != hour and ds["headline"] is not None:
            ds["check_hour"] = hour
            ds["checks"] = (ds["checks"] + [passes(priced.get(ds["headline"]), und)])[-max(QUESTION_GATES["date_window"][1], QUESTION_GATES["lapse_checks"]):]
            need, window = QUESTION_GATES["date_window"]
            last = ds["checks"][-window:]
            if sum(last) >= min(need, len(last)):
                ds["shown"] = True
            elif ds["shown"] and len(ds["checks"]) >= QUESTION_GATES["lapse_checks"] and not any(ds["checks"][-QUESTION_GATES["lapse_checks"]:]):
                ds["shown"] = False
        if not ds["shown"] and not ds["ids"]:
            continue
        board["dates"].append(_date_board(und, e, ex, ds, priced, index, ts, spec))
    return board


def _ladder(priced: dict, index: float, size: int) -> list[float]:
    """Up to `size` levels centred on the price now, Yes inside the 3c-97c window."""
    lo, hi = QUESTION_GATES["yes_min"], QUESTION_GATES["yes_max"]
    ok = []
    for k, p in sorted(priced.items()):
        v = (p["yes"] or {}).get("buy") if p and p["yes"] else (p or {}).get("fair")
        if v is not None and lo <= v <= hi:
            ok.append(k)
    if len(ok) <= size:
        return ok
    i = min(range(len(ok)), key=lambda j: abs(ok[j] - index))
    start = max(0, min(len(ok) - size, i - size // 2))
    return ok[start:start + size]


def _side_out(side: dict | None, und: str) -> dict | None:
    if side is None:
        return {"state": "no_quote"}
    return {"state": side_state(side, und), "buy": round(side["buy"], 4),
            "sell": None if side["sell"] is None else round(side["sell"], 4),
            "size": round(side["size"], 2), "form": side["form"],
            "legs": [[n, s, p] for n, s, p in side["legs"]], "close": side.get("close")}


def _date_board(und: str, e: str, ex: dict, ds: dict, priced: dict, index: float, ts: int, spec: dict) -> dict:
    w = ds["zone"]
    seven = set(_ladder(priced, index, QUESTION_GATES["ladder"]))
    fifteen = set(_ladder(priced, index, QUESTION_GATES["ladder_more"]))
    on_board = ds["shown"] and offered(e, ts)
    if on_board:
        for k in fifteen:
            p = priced[k]
            name = ex["strikes"][_r(k - w / 2)]["C"][0], ex["strikes"][_r(k + w / 2)]["C"][0]
            ds["ids"].setdefault(qid(und, e, *name), [k - w / 2, k + w / 2])
    levels = []
    settling = ts >= expiry_ts(e) - QUESTION_GATES["settling_sec"]
    for q, (lo, hi) in sorted(ds["ids"].items(), key=lambda x: x[1][0]):
        k = (lo + hi) / 2
        p = priced[_r(k)] if _r(hi - lo) == _r(w) and _r(k) in priced else price_level(ex, lo, hi, index, spec)
        state = "retired" if q in ds["retired"] else "settling" if settling else "open"
        if state == "open":
            yes_v = (p or {}).get("yes", {}) or {}
            v = yes_v.get("buy", (p or {}).get("fair"))
            if v is None or not (QUESTION_GATES["yes_min"] <= v <= QUESTION_GATES["yes_max"]):
                state = "tail"
        row = {"id": q, "k": k, "lo": lo, "hi": hi, "fair": None if not p or p["fair"] is None else round(p["fair"], 4),
               "state": state, "ladder": 7 if _r(k) in seven and q not in ds["retired"] else 15 if _r(k) in fifteen and q not in ds["retired"] else 0,
               "yes": _side_out(p and p["yes"], und), "no": _side_out(p and p["no"], und)}
        if settling:
            row["yes"] = {"state": "settling"}
            row["no"] = {"state": "settling"}
        levels.append(row)
    head = ds["headline"]
    head_id = next((q for q, (lo, hi) in ds["ids"].items() if _r((lo + hi) / 2) == _r(head) and _r(hi - lo) == _r(w)), None) if head else None
    return {"expiry": e, "settle_ts": expiry_ts(e), "label": date_label(e, ts), "days": round(days_left(e, ts), 3),
            "board": on_board, "zone": w, "zone_set_ts": ds["zone_set"], "headline": head_id, "checks": ds["checks"],
            "levels": levels}

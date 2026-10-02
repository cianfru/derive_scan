"""Options traders' history rebuilt from Derive's public trades (part 1 of docs/options-traders-study.md).

Each finished UTC day is read once from `public/get_trade_history` (every option and perp leg,
with its wallet) and kept as one compressed file of per-wallet, per-instrument totals; raw legs
are not kept (they can be read again from Derive).

history/days/YYYY-MM-DD.csv.gz   one row per wallet and instrument traded that day:
    wallet, instrument, buy/sell contracts, buy/sell value (premium for options, notional for perps),
    maker and taker legs, delta added in USD (options: Black-76 delta at the implied volatility of
    each trade's price, on the index; perps: contracts x index), contract-weighted implied
    volatility, premium sold out of the money, realised PnL and fees as Derive reports them
history/settlements/{UND}.json   option settlement prices per expiry (Derive)
history/wallets.json             each wallet's class from all days so far (rules in the study doc)
history/state.json               days done

Positions are not stored: a wallet's open contracts in an instrument are the running sum of its
daily buys minus sells, and an option held to expiry settles at the settlement price.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .implied import YEAR, _ncdf, black76_call

FIRST_DAY = date(2023, 12, 1)  # Derive V2 public trades start mid-December 2023
PAGE = 1000
EXPIRY_HOUR = 8  # Derive options expire at 08:00 UTC
FIELDS = ("wallet", "instrument", "buy_contracts", "sell_contracts", "buy_value_usd", "sell_value_usd",
          "maker_legs", "taker_legs", "delta_usd", "iv", "otm_sell_usd", "realized_pnl_usd", "fees_usd")

# Wallet classes (docs/options-traders-study.md, approved 2 October 2026)
MM_MAKER_SHARE = 0.60
MM_BOTH_SIDES_SHARE = 0.50
INCOME_SOLD_SHARE = 0.80
INCOME_OTM_SHARE = 0.50
HEDGE_COVER = 0.50
HEDGE_DAYS_SHARE = 0.50
MIN_LEGS = 20
MIN_ACTIVE_DAYS = 90
SKILLED_FRACTION = 0.20


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def parse_option(name: str) -> tuple[str, int, float, str] | None:
    """'BTC-20240830-60000-C' -> (und, expiry_sec, strike, 'C'|'P')."""
    p = name.split("-")
    if len(p) != 4 or p[3] not in ("C", "P"):
        return None
    try:
        d = datetime.strptime(p[1], "%Y%m%d").replace(hour=EXPIRY_HOUR, tzinfo=timezone.utc)
        return p[0], int(d.timestamp()), float(p[2]), p[3]
    except ValueError:
        return None


def option_price(f: float, k: float, t: float, iv: float, cp: str) -> float:
    c = black76_call(f, k, t, iv)
    return c if cp == "C" else c - (f - k)


def implied_vol(price: float, f: float, k: float, t: float, cp: str) -> float | None:
    """Volatility at which Black-76 gives this price (bisection); None outside the no-arbitrage range."""
    if t <= 0 or f <= 0 or k <= 0:
        return None
    intrinsic = max(f - k, 0.0) if cp == "C" else max(k - f, 0.0)
    if price <= intrinsic + 1e-9 or price >= (f if cp == "C" else k):
        return None
    lo, hi = 1e-4, 8.0
    if option_price(f, k, t, hi, cp) < price:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if option_price(f, k, t, mid, cp) < price else (lo, mid)
    return (lo + hi) / 2


def option_delta(f: float, k: float, t: float, iv: float | None, cp: str) -> float:
    if not iv or t <= 0:
        itm = f > k if cp == "C" else f < k
        return (1.0 if itm else 0.0) * (1 if cp == "C" else -1)
    s = iv * math.sqrt(t)
    d = _ncdf((math.log(f / k) + 0.5 * s * s) / s)
    return d if cp == "C" else d - 1


def day_rows(trades: list[dict]) -> list[list]:
    """Per wallet and instrument totals for one day's legs (both sides of each trade)."""
    agg: dict = defaultdict(lambda: defaultdict(float))
    for tr in trades:
        if tr.get("tx_status") == "reverted":
            continue
        name = tr.get("instrument_name", "")
        opt = parse_option(name)
        if not opt and not name.endswith("-PERP"):
            continue
        amount, price, index = _f(tr.get("trade_amount")), _f(tr.get("trade_price")), _f(tr.get("index_price"))
        if amount <= 0 or index <= 0:
            continue
        sign = 1 if tr.get("direction") == "buy" else -1
        a = agg[(tr.get("wallet") or "?", name)]
        side = "buy" if sign > 0 else "sell"
        a[f"{side}_contracts"] += amount
        a["maker_legs" if tr.get("liquidity_role") == "maker" else "taker_legs"] += 1
        a["realized_pnl_usd"] += _f(tr.get("realized_pnl"))
        a["fees_usd"] += _f(tr.get("trade_fee"))
        if opt:
            _, expiry, strike, cp = opt
            t = (expiry - int(tr["timestamp"]) / 1000) / YEAR
            iv = implied_vol(price, index, strike, t, cp) or implied_vol(_f(tr.get("mark_price")), index, strike, t, cp)
            a[f"{side}_value_usd"] += amount * price
            a["delta_usd"] += sign * amount * option_delta(index, strike, t, iv, cp) * index
            if iv:
                a["iv_w"] += amount * iv
                a["iv_n"] += amount
            if sign < 0 and (strike > index if cp == "C" else strike < index):
                a["otm_sell_usd"] += amount * price
        else:
            a[f"{side}_value_usd"] += amount * price
            a["delta_usd"] += sign * amount * index
    rows = []
    for (wallet, name), a in sorted(agg.items()):
        iv = round(a["iv_w"] / a["iv_n"], 4) if a["iv_n"] else ""
        rows.append([wallet, name, round(a["buy_contracts"], 6), round(a["sell_contracts"], 6),
                     round(a["buy_value_usd"], 2), round(a["sell_value_usd"], 2), int(a["maker_legs"]),
                     int(a["taker_legs"]), round(a["delta_usd"], 2), iv, round(a["otm_sell_usd"], 2),
                     round(a["realized_pnl_usd"], 2), round(a["fees_usd"], 2)])
    return rows


def write_day(root: Path, day: date, rows: list[list]) -> Path:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(FIELDS)
    w.writerows(rows)
    p = root / "history" / "days" / f"{day.isoformat()}.csv.gz"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("wb") as fh, gzip.GzipFile(fileobj=fh, mode="wb", mtime=0) as gz:  # same bytes on a rerun
        gz.write(buf.getvalue().encode())
    return p


def read_day(p: Path) -> list[dict]:
    with gzip.open(p, "rt") as fh:
        return list(csv.DictReader(fh))


async def fetch_day(client, day: date) -> list[dict]:
    """Every option and perp leg of one UTC day; raises if the count does not add up."""
    start = int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)
    out = []
    for kind in ("option", "perp"):
        got, page, count = [], 1, 0
        while True:
            res = await client.public("get_trade_history", {"from_timestamp": start, "to_timestamp": start + 86_400_000 - 1,
                                                            "instrument_type": kind, "page_size": PAGE, "page": page})
            got.extend(res.get("trades", []))
            pag = res.get("pagination") or {}
            count = pag.get("count", len(got))
            if page >= pag.get("num_pages", 1):
                break
            page += 1
        if len(got) != count:
            raise RuntimeError(f"{day} {kind}: {len(got)} legs read, {count} listed")
        out.extend(got)
    return out


def load_state(root: Path) -> dict:
    p = root / "history" / "state.json"
    return json.loads(p.read_text()) if p.exists() else {}


def save_state(root: Path, state: dict) -> None:
    p = root / "history" / "state.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state))


def next_day(state: dict) -> date:
    done = state.get("done_through")
    return FIRST_DAY if not done else date.fromisoformat(done) + timedelta(days=1)


def last_complete_day(now: float, settle_sec: int = 3600) -> date:
    """The newest UTC day that ended at least settle_sec ago."""
    return (datetime.fromtimestamp(now - settle_sec, timezone.utc) - timedelta(days=1)).date()


async def update_settlements(client, root: Path, unds: list[str]) -> dict[str, dict[str, float]]:
    """{UND: {YYYYMMDD: price}} from Derive, kept in history/settlements."""
    out = {}
    for und in unds:
        p = root / "history" / "settlements" / f"{und}.json"
        try:
            res = await client.public("get_option_settlement_prices", {"currency": und})
            prices = {e["expiry_date"]: _f(e["price"]) for e in (res.get("expiries") or []) if e.get("price")}
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(dict(sorted(prices.items())), separators=(",", ":")))
        except Exception:  # keep the last saved prices
            prices = json.loads(p.read_text()) if p.exists() else {}
        out[und] = prices
    return out


def classify(root: Path, settlements: dict[str, dict[str, float]], as_of: float) -> dict:
    """Each wallet's class from every day file, using information up to as_of only.

    Market maker: > 60% of option legs as maker, or both sides of the same instrument on the same
    day for more than half of the instruments it traded. Income seller: > 80% of option premium
    sold, and at least half of it out of the money. Hedger: on more than half of the days it
    traded options, its perp trades that day offset at least half of the option delta added.
    Directional: the rest with at least 20 option legs over at least 90 days. Skilled: directional
    wallets with positive option PnL in the top fifth by option PnL. Option PnL counts instruments
    already expired: premium received minus paid plus contracts held at expiry x settlement value.
    """
    w: dict = defaultdict(lambda: defaultdict(float))
    inst: dict = defaultdict(lambda: defaultdict(float))  # (wallet, instrument) -> totals
    days_seen: dict = defaultdict(set)
    day_delta: dict = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))  # wallet -> (day, und) -> [opt, perp]
    for p in sorted((root / "history" / "days").glob("*.csv.gz")):
        day = p.name[:10]
        for r in read_day(p):
            wallet, name = r["wallet"], r["instrument"]
            und = name.split("-")[0]
            buy, sell = _f(r["buy_contracts"]), _f(r["sell_contracts"])
            if name.endswith("-PERP"):
                w[wallet]["perp_pnl"] += _f(r["realized_pnl_usd"])
                day_delta[wallet][(day, und)][1] += _f(r["delta_usd"])
                continue
            a = w[wallet]
            legs = _f(r["maker_legs"]) + _f(r["taker_legs"])
            a["legs"] += legs
            a["maker_legs"] += _f(r["maker_legs"])
            a["bought"] += _f(r["buy_value_usd"])
            a["sold"] += _f(r["sell_value_usd"])
            a["otm_sold"] += _f(r["otm_sell_usd"])
            days_seen[wallet].add(day)
            i = inst[(wallet, name)]
            i["net"] += buy - sell
            i["cash"] += _f(r["sell_value_usd"]) - _f(r["buy_value_usd"])
            i["days"] += 1
            i["both"] += 1 if buy > 0 and sell > 0 else 0
            day_delta[wallet][(day, und)][0] += _f(r["delta_usd"])
    for (wallet, name), i in inst.items():
        a = w[wallet]
        a["instruments"] += 1
        a["both_instruments"] += 1 if i["both"] else 0
        opt = parse_option(name)
        if opt and opt[1] <= as_of:
            settle = settlements.get(opt[0], {}).get(name.split("-")[1])
            if settle is not None:
                payoff = max(settle - opt[2], 0.0) if opt[3] == "C" else max(opt[2] - settle, 0.0)
                a["option_pnl"] += i["cash"] + i["net"] * payoff
    out = {}
    for wallet, a in w.items():
        if not a["legs"]:
            continue
        days = sorted(days_seen[wallet])
        span = (date.fromisoformat(days[-1]) - date.fromisoformat(days[0])).days + 1
        premium = a["bought"] + a["sold"]
        opt_days = [(o, pp) for (o, pp) in day_delta[wallet].values() if o]
        hedged = sum(1 for o, pp in opt_days if pp * o < 0 and abs(pp) >= HEDGE_COVER * abs(o))
        stats = {"legs": int(a["legs"]), "maker_share": round(a["maker_legs"] / a["legs"], 3),
                 "both_sides_share": round(a["both_instruments"] / a["instruments"], 3) if a["instruments"] else 0,
                 "sold_share": round(a["sold"] / premium, 3) if premium else 0,
                 "otm_sold_share": round(a["otm_sold"] / a["sold"], 3) if a["sold"] else 0,
                 "hedged_days_share": round(hedged / len(opt_days), 3) if opt_days else 0,
                 "first": days[0], "last": days[-1], "active_days": span,
                 "option_pnl": round(a["option_pnl"], 2), "perp_pnl": round(a["perp_pnl"], 2)}
        if stats["maker_share"] > MM_MAKER_SHARE or stats["both_sides_share"] > MM_BOTH_SIDES_SHARE:
            cls = "market_maker"
        elif stats["sold_share"] > INCOME_SOLD_SHARE and stats["otm_sold_share"] >= INCOME_OTM_SHARE:
            cls = "income"
        elif stats["hedged_days_share"] > HEDGE_DAYS_SHARE:
            cls = "hedger"
        elif stats["legs"] >= MIN_LEGS and span >= MIN_ACTIVE_DAYS:
            cls = "directional"
        else:
            cls = "occasional"
        out[wallet] = {"class": cls, **stats}
    directional = sorted((v["option_pnl"], k) for k, v in out.items() if v["class"] == "directional")
    n = max(1, round(len(directional) * SKILLED_FRACTION)) if directional else 0
    for pnl, k in directional[::-1][:n]:
        if pnl > 0:
            out[k]["class"] = "skilled"
    return out

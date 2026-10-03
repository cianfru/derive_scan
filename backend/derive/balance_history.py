"""Daily Smart-wallet option delta balance per coin, point in time (history/balance.json).

The live wallets reading (lean.wallets_reading) values the open options of the Smart cohort
(tiers top and smart, history.tier_positions) at the newest chain: net delta over gross delta for
the expiries within 7 and 30 days. This module keeps that reading for every daily close.

Appended close (history_once.py, each new day): the positions just rebuilt for the day are valued
with the 00:00 UTC chain the recorder kept at the close, through lean.wallets_reading, exactly as
the live reading. A coin whose chain is missing is modelled (below).

Backfill (once, and again after a gap): Replay reads every day file once, keeping the running
totals of history.scan_days, so each wallet's class and tier are recomputed at every close from
that close's information only (history.classify_stats, history.rank_tiers): a wallet joins the
cohort on the close it qualifies, never before. With them it keeps each wallet's open contracts per
instrument. Each close is valued with its recorded chain where one exists, otherwise modelled:
Black-76 delta (history.option_delta) at the daily index close, with the instrument's last traded
implied volatility (at most 21 days old), else the coin's last near-the-money traded volatility.

Roll share: (gross of the expiries that left the window since the previous close + gross of the
expiries newly inside it) / max(gross then, gross now). From 0.25 the close is flagged: most of
that move is the window rolling, not wallets trading.

history/balance.json
  schema        definitions version (SCHEMA)
  through       YYYY-MM-DD, the day of the newest close
  closes        {close_ts: {UND: {"7d": [score, net, gross, positions, flags], "30d": [...]}}}
                close_ts is the daily bar's close (00:00 UTC after the day). score is null below the
                live gates (gross >= $10k, >= 3 positions) or when a delta was missing or estimated;
                net and gross (USD delta) are null when a quote is missing. flags: bit 0 roll,
                bit 1 modelled. A coin or horizon without a Smart position is left out.
  expiry_gross  {close_ts: {UND: {expiry_ts: gross}}} for the two newest closes (the next roll)
"""
from __future__ import annotations

import gzip
import json
import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import history as H
from .lean import HORIZONS, WALLET_MIN_POSITIONS, WALLET_MIN_USD, WALLET_TIER, wallets_reading
from .valuation import delta_at

SCHEMA = 1
CLOSES = 90             # closes rebuilt by a backfill
SOURCE = "v2_mainnet"
DAY = 86400
YEAR = 365 * DAY
ROLL_FLAG = 0.25        # roll share from which a close is flagged
FLAG_ROLL, FLAG_MODELLED = 1, 2
IV_MAX_AGE = 21         # days an instrument's traded IV is carried forward
ATM_BAND = 0.10         # |log(strike / index)| of a near-the-money trade
ATM_DAYS = (3, 60)      # days to expiry of a near-the-money trade
IV_LOOKBACK = 60        # days read for the IVs of a modelled append
EXPIRY_GROSS_KEEP = 2


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def day_ts(day: str) -> int:
    return int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())


def close_ts(day: str) -> int:
    """The close of a day's daily bar (00:00 UTC after it)."""
    return day_ts(day) + DAY


def close_day(ts: int) -> str:
    return datetime.fromtimestamp(int(ts) - DAY, timezone.utc).date().isoformat()


def load_settlements(root: Path) -> dict:
    """Saved settlement prices of the coins history_once classifies with (universe.json)."""
    uni = root / "universe.json"
    unds = json.loads(uni.read_text()).get("underlyings", []) if uni.exists() else ["BTC", "ETH"]
    out = {}
    for und in unds:
        p = root / "history" / "settlements" / f"{und}.json"
        out[und] = json.loads(p.read_text()) if p.exists() else {}
    return out


def index_closes(root: Path) -> dict[str, dict[int, float]]:
    """{UND: {bar_open_sec: close}} of the daily index candles (backfilled bars before Derive's)."""
    from .candles import CandleCache
    cache, out = CandleCache(root), {}
    for d in sorted(cache.root.iterdir()) if cache.root.exists() else []:
        c = cache.load(d.name, "1d")
        if c is not None:
            out[d.name] = {int(t) // 1000: float(v) for t, v in zip(c["timestamp"], c["close"])}
    return out


def load_chain(root: Path, und: str, ts: int, source: str = SOURCE) -> dict | None:
    """The per-strike view of the chain the recorder kept at ts (a 00:00 UTC file), or None."""
    from .recorder import strikes_from_chain
    at = datetime.fromtimestamp(ts, timezone.utc)
    p = root / source / und / "chains" / at.date().isoformat() / f"{at.hour:02d}.json.gz"
    if not p.exists():
        return None
    try:
        doc = json.loads(gzip.decompress(p.read_bytes()))
    except (OSError, ValueError):
        return None
    strikes = strikes_from_chain(doc, ts)
    return strikes if strikes.get("index") and strikes.get("expiries") else None


def roll_share(prev_ts: int, prev: dict, ts: int, cur: dict, days: int) -> float | None:
    """Share of the window's gross that moved by expiry between two consecutive closes.

    prev and cur are {expiry: gross} at prev_ts and ts (expiries within the longest horizon)."""
    if ts - prev_ts != DAY:
        return None
    then = {int(e): g for e, g in prev.items() if prev_ts < int(e) <= prev_ts + days * DAY}
    now = {int(e): g for e, g in cur.items() if ts < int(e) <= ts + days * DAY}
    left = sum(g for e, g in then.items() if e <= ts)
    entered = sum(g for e, g in now.items() if e > prev_ts + days * DAY)
    base = max(sum(then.values()), sum(now.values()))
    return round((left + entered) / base, 3) if base else None


class TradeIVs:
    """Implied volatility evidence from the trades: each instrument's last traded IV and each
    coin's last near-the-money traded IV (contract-weighted over a day)."""

    def __init__(self):
        self.inst: dict[str, tuple[str, float]] = {}
        self.und: dict[str, tuple[str, float]] = {}
        self._parsed: dict = {}

    def opt(self, name: str):
        if name not in self._parsed:
            self._parsed[name] = H.parse_option(name)
        return self._parsed[name]

    def add(self, day: str, trades: list[tuple[str, float, float]], closes: dict) -> None:
        """trades: (instrument, contracts, iv) of the day's option rows with an IV."""
        bar = day_ts(day)
        acc: dict = defaultdict(lambda: [0.0, 0.0])
        atm: dict = defaultdict(lambda: [0.0, 0.0])
        for name, n, iv in trades:
            if n <= 0:
                continue
            a = acc[name]
            a[0] += iv * n
            a[1] += n
            o = self.opt(name)
            index = closes.get(o[0], {}).get(bar) if o else None
            if index and o[2] > 0 and abs(math.log(o[2] / index)) < ATM_BAND \
                    and ATM_DAYS[0] * DAY <= o[1] - (bar + DAY) <= ATM_DAYS[1] * DAY:
                b = atm[o[0]]
                b[0] += iv * n
                b[1] += n
        for name, (s, n) in acc.items():
            self.inst[name] = (day, s / n)
        for und, (s, n) in atm.items():
            self.und[und] = (day, s / n)

    def add_day(self, day: str, rows: list[dict], closes: dict) -> None:
        trades = []
        for r in rows:
            name = r["instrument"]
            iv = _f(r.get("iv"))
            if iv > 0 and not name.endswith("-PERP"):
                trades.append((name, _f(r["buy_contracts"]) + _f(r["sell_contracts"]), iv))
        self.add(day, trades, closes)

    def iv_for(self, name: str, und: str, day: str) -> float | None:
        got = self.inst.get(name)
        if got and (date.fromisoformat(day) - date.fromisoformat(got[0])).days <= IV_MAX_AGE:
            return got[1]
        got = self.und.get(und)
        return got[1] if got else None


def recent_ivs(root: Path, day: str, closes: dict, lookback: int = IV_LOOKBACK) -> TradeIVs:
    """TradeIVs from the last `lookback` day files up to day."""
    ivs = TradeIVs()
    first = (date.fromisoformat(day) - timedelta(days=lookback - 1)).isoformat()
    for p in sorted((root / "history" / "days").glob("*.csv.gz")):
        if first <= p.name[:10] <= day:
            ivs.add_day(p.name[:10], H.read_day(p), closes)
    return ivs


def value(positions: dict, und: str, as_of: int, index: float | None, horizon: str, chain: dict | None = None,
          ivs: TradeIVs | None = None, day: str | None = None, prev: tuple | None = None,
          tier: str = WALLET_TIER) -> dict:
    """One coin's Smart reading at a close.

    positions: {instrument: {tier: [net, wallets, gross]}} (history.tier_positions for the coin).
    With a chain ({ts, index, expiries}) it is lean.wallets_reading at that chain, as the live
    reading; otherwise Black-76 at `index` with traded IVs (modelled). prev = (prev_ts,
    {expiry: gross}) of the previous close gives the roll share.
    """
    days = HORIZONS[horizon]
    by_expiry: dict[int, float] = defaultdict(float)
    if chain is not None:
        now = max(as_of, int(chain["ts"]))
        r = wallets_reading(positions, chain, chain["index"], now, days, tier=tier)
        for name, cells in positions.items():
            o = H.parse_option(name)
            cell = (cells or {}).get(tier)
            if not o or not cell or not now < o[1] <= now + days * DAY:
                continue
            d, _ = delta_at(chain, o[1], o[2], o[3], chain["index"], now)
            if d is not None:
                by_expiry[o[1]] += cell[2] * abs(d * chain["index"])
        score, net, gross, held, modelled = (r["score"], r["net_delta_usd"], r["gross_delta_usd"], r["positions"], False)
    else:
        net = gross = 0.0
        held = 0
        for name, cells in positions.items():
            o = H.parse_option(name)
            cell = (cells or {}).get(tier)
            if not o or not cell or not as_of < o[1] <= as_of + days * DAY:
                continue
            iv = ivs.iv_for(name, und, day) if ivs is not None and day else None
            d = H.option_delta(index, o[2], (o[1] - as_of) / YEAR, iv, o[3]) * index
            net += cell[0] * d
            gross += cell[2] * abs(d)
            held += cell[1]
            by_expiry[o[1]] += cell[2] * abs(d)
        score = round(net / gross, 3) if gross >= WALLET_MIN_USD and held >= WALLET_MIN_POSITIONS else None
        modelled = True
    roll = roll_share(prev[0], prev[1], as_of, by_expiry, days) if prev and prev[1] is not None else None
    return {"score": score, "net": None if net is None else round(net), "gross": None if gross is None else round(gross),
            "positions": held, "roll": roll, "modelled": modelled, "expiry_gross": dict(by_expiry)}


def close_readings(positions: dict, as_of: int, day: str, indexes: dict, chains: dict, ivs: TradeIVs | None,
                   prev: tuple | None) -> tuple[dict, dict]:
    """Every coin's readings at one close: ({UND: {h: [score, net, gross, positions, flags]}},
    {UND: {expiry: gross}} within the longest horizon). prev = (prev_ts, {UND: {expiry: gross}})."""
    out, expiry_gross = {}, {}
    longest = max(HORIZONS, key=HORIZONS.get)
    for und in sorted(positions):
        chain = chains.get(und)
        index = chain["index"] if chain else indexes.get(und)
        if not index:
            continue
        before = (prev[0], (prev[1] or {}).get(und)) if prev else None
        row = {}
        for h in HORIZONS:
            v = value(positions[und], und, as_of, index, h, chain=chain, ivs=ivs, day=day, prev=before)
            if h == longest:
                expiry_gross[und] = {str(e): round(g) for e, g in sorted(v["expiry_gross"].items())}
            if not v["positions"]:
                continue
            flags = (FLAG_ROLL if (v["roll"] or 0) >= ROLL_FLAG else 0) | (FLAG_MODELLED if v["modelled"] else 0)
            row[h] = [v["score"], v["net"], v["gross"], v["positions"], flags]
        if row:
            out[und] = row
    return out, expiry_gross


class Replay:
    """One pass over the day files, in order, with point-in-time wallet tiers and open contracts.

    add_day keeps the running totals of history.scan_days; settle_through adds the PnL of the
    instruments expired by a cutoff; tiers() applies history.classify's rules to them, so at a
    close after add_day of its day and settle_through(close) it equals history.classify(root,
    settlements, close)'s tiers.
    """

    def __init__(self, settlements: dict):
        self.sett = settlements
        self.w: dict = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0.0])  # legs, maker legs, bought, sold, otm sold
        self.pairs: dict = {}            # (wallet, instrument) -> [net, cash, seq, both]; first-trade order
        self.ninst: dict = defaultdict(int)
        self.nboth: dict = defaultdict(int)
        self.first: dict = {}
        self.last: dict = {}
        self.opt_days: dict = defaultdict(int)
        self.hedged: dict = defaultdict(int)
        self.open: dict = {}             # unexpired pairs, first-trade order
        self.by_expiry: dict = defaultdict(list)
        self.settled: dict = defaultdict(list)  # wallet -> [(seq, pnl)]
        self.cls: dict = {}
        self._dirty: set = set()
        self._pnl: dict = {}
        self._pnl_dirty: set = set()
        self.ivs = TradeIVs()

    def opt(self, name: str):
        return self.ivs.opt(name)

    def add_day(self, day: str, rows: list[dict], closes: dict) -> None:
        dd: dict = defaultdict(lambda: [0.0, 0.0])
        trades = []
        for r in rows:
            wallet, name = r["wallet"], r["instrument"]
            und = name.split("-")[0]
            if name.endswith("-PERP"):
                dd[(wallet, und)][1] += _f(r["delta_usd"])
                continue
            buy, sell = _f(r["buy_contracts"]), _f(r["sell_contracts"])
            bv, sv = _f(r["buy_value_usd"]), _f(r["sell_value_usd"])
            maker = _f(r["maker_legs"])
            a = self.w[wallet]
            a[0] += maker + _f(r["taker_legs"])
            a[1] += maker
            a[2] += bv
            a[3] += sv
            a[4] += _f(r["otm_sell_usd"])
            self.first.setdefault(wallet, day)
            self.last[wallet] = day
            self._dirty.add(wallet)
            key = (wallet, name)
            p = self.pairs.get(key)
            if p is None:
                p = self.pairs[key] = [0.0, 0.0, len(self.pairs), False]
                self.ninst[wallet] += 1
                o = self.opt(name)
                if o:
                    self.open[key] = None
                    self.by_expiry[o[1]].append(key)
            if buy > 0 and sell > 0 and not p[3]:
                p[3] = True
                self.nboth[wallet] += 1
            p[0] += buy - sell
            p[1] += sv - bv
            dd[(wallet, und)][0] += _f(r["delta_usd"])
            iv = _f(r["iv"])
            if iv > 0:
                trades.append((name, buy + sell, iv))
        for (wallet, _), (o, pp) in dd.items():
            if o:
                self.opt_days[wallet] += 1
                if pp * o < 0 and abs(pp) >= H.HEDGE_COVER * abs(o):
                    self.hedged[wallet] += 1
        self.ivs.add(day, trades, closes)

    def settle_through(self, as_of: float) -> None:
        for e in sorted(e for e in self.by_expiry if e <= as_of):
            for key in self.by_expiry.pop(e):
                self.open.pop(key, None)
                o = self.opt(key[1])
                s = self.sett.get(o[0], {}).get(key[1].split("-")[1])
                if s is None:
                    continue
                p = self.pairs[key]
                payoff = max(s - o[2], 0.0) if o[3] == "C" else max(o[2] - s, 0.0)
                self.settled[key[0]].append((p[2], p[1] + p[0] * payoff))
                self._pnl_dirty.add(key[0])

    def _class(self, wallet: str) -> str | None:
        a = self.w[wallet]
        legs = a[0]
        if not legs:
            return None
        span = (date.fromisoformat(self.last[wallet]) - date.fromisoformat(self.first[wallet])).days + 1
        premium = a[2] + a[3]
        n, both, opt_days = self.ninst[wallet], self.nboth[wallet], self.opt_days[wallet]
        return H.classify_stats({
            "legs": int(legs), "maker_share": round(a[1] / legs, 3),
            "both_sides_share": round(both / n, 3) if n else 0,
            "sold_share": round(a[3] / premium, 3) if premium else 0,
            "otm_sold_share": round(a[4] / a[3], 3) if a[3] else 0,
            "hedged_days_share": round(self.hedged[wallet] / opt_days, 3) if opt_days else 0,
            "active_days": span})

    def _option_pnl(self, wallet: str) -> float:
        """Summed in first-trade order, as history.classify sums it."""
        if wallet in self._pnl_dirty or wallet not in self._pnl:
            total = 0.0
            for _, pnl in sorted(self.settled.get(wallet, ())):
                total += pnl
            self._pnl[wallet] = round(total, 2)
            self._pnl_dirty.discard(wallet)
        return self._pnl[wallet]

    def tiers(self) -> dict[str, str]:
        """{wallet: tier} of the tiered wallets with the information added so far."""
        for wallet in self._dirty:
            self.cls[wallet] = self._class(wallet)
        self._dirty.clear()
        out = {w: {"class": c, "option_pnl": self._option_pnl(w)} for w, c in self.cls.items() if c == "directional"}
        return {w: v["tier"] for w, v in H.rank_tiers(out).items() if v.get("tier")}

    def held(self, as_of: float) -> dict:
        """{(wallet, instrument): net contracts} of the instruments not yet expired at as_of."""
        out = {}
        for key in self.open:
            n = self.pairs[key][0]
            if abs(n) > 1e-9 and self.opt(key[1])[1] > as_of:
                out[key] = n
        return out

    def open_cells(self, tiers: dict[str, str], as_of: float) -> dict:
        """{UND: {instrument: {tier: [net, wallets, gross]}}}: history.tier_positions of the open
        contracts at as_of, for the given point-in-time tiers."""
        cohort = {w: {"tier": t} for w, t in tiers.items()}
        held = {k: n for k, n in self.held(as_of).items() if k[0] in cohort}
        return H.tier_positions(held, cohort)

    def value(self, positions: dict, und: str, as_of: int, index: float | None, horizon: str,
              chain: dict | None = None, day: str | None = None, prev: tuple | None = None) -> dict:
        return value(positions, und, as_of, index, horizon, chain=chain, ivs=self.ivs,
                     day=day or close_day(as_of), prev=prev)


# -- history/balance.json ---------------------------------------------------------------------

def path(root: Path) -> Path:
    return root / "history" / "balance.json"


def read(root: Path) -> dict | None:
    p = path(root)
    if not p.exists():
        return None
    try:
        doc = json.loads(p.read_text())
        return doc if isinstance(doc, dict) else None
    except ValueError:
        return None


def write(root: Path, closes: dict, expiry_gross: dict) -> dict:
    keys = sorted(closes, key=int)
    keep = sorted(expiry_gross, key=int)[-EXPIRY_GROSS_KEEP:]
    doc = {"schema": SCHEMA, "through": close_day(int(keys[-1])) if keys else None,
           "closes": {k: closes[k] for k in keys}, "expiry_gross": {k: expiry_gross[k] for k in keep}}
    p = path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, separators=(",", ":")))
    return doc


def append(root: Path, day: str, positions: dict, source: str = SOURCE) -> bool:
    """Writes the close of `day` from the positions just rebuilt for it (history.tier_positions),
    valued with the chains kept at the close, a coin without one modelled. Returns True when an
    earlier close is missing (a catch-up skipped it; the backfill fills it)."""
    as_of = close_ts(day)
    doc = read(root)
    if doc is not None and doc.get("schema") != SCHEMA:
        return True  # older definitions: the backfill rebuilds the file
    closes, expiry_gross = dict((doc or {}).get("closes") or {}), dict((doc or {}).get("expiry_gross") or {})
    chains = {und: load_chain(root, und, as_of, source) for und in positions}
    indexes, ivs = {}, None
    if any(c is None for c in chains.values()):
        candles = index_closes(root)
        indexes = {und: candles.get(und, {}).get(day_ts(day)) for und in positions}
        ivs = recent_ivs(root, day, candles)
    key, before = str(as_of), str(as_of - DAY)
    prev = (as_of - DAY, expiry_gross[before]) if before in expiry_gross else None
    readings, eg = close_readings(positions, as_of, day, indexes, chains, ivs, prev)
    gap = bool(closes) and before not in closes and min(int(k) for k in closes) < as_of
    closes[key], expiry_gross[key] = readings, eg
    write(root, closes, expiry_gross)
    return gap


def backfill(root: Path, n: int = CLOSES, source: str = SOURCE) -> int:
    """Rebuilds the last n closes (through the newest day file) with point-in-time tiers, valued
    with the recorded chain where one exists, otherwise modelled. Closes older than these are kept
    when the file's schema is current. Returns the number of closes written."""
    files = sorted((root / "history" / "days").glob("*.csv.gz"))
    days = [p.name[:10] for p in files]
    targets = set(days[-(n + 1):])  # one more close for the first close's roll
    write_from = days[-n] if len(days) >= n else (days[0] if days else None)
    candles = index_closes(root)
    replay = Replay(load_settlements(root))
    closes, expiry_gross, prev = {}, {}, None
    for p, day in zip(files, days):
        replay.add_day(day, H.read_day(p), candles)
        if day not in targets:
            continue
        as_of = close_ts(day)
        replay.settle_through(as_of)
        positions = replay.open_cells(replay.tiers(), as_of)
        chains = {und: load_chain(root, und, as_of, source) for und in positions}
        indexes = {und: candles.get(und, {}).get(day_ts(day)) for und in positions}
        readings, eg = close_readings(positions, as_of, day, indexes, chains, replay.ivs, prev)
        prev = (as_of, eg)
        if day >= write_from:
            closes[str(as_of)], expiry_gross[str(as_of)] = readings, eg
    old = read(root)
    if old and old.get("schema") == SCHEMA:
        closes = {**{k: v for k, v in (old.get("closes") or {}).items() if k not in closes}, **closes}
        expiry_gross = {**(old.get("expiry_gross") or {}), **expiry_gross}
    write(root, closes, expiry_gross)
    return len([d for d in days if d >= write_from]) if write_from else 0

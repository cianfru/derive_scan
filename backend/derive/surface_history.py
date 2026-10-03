"""Daily option-surface readings rebuilt from traded options (history/surface/{UND}.csv).

Derive kept no quote history before recording began (1 October 2026) and past surfaces cannot be
recovered. This is a separate measurement: for each finished UTC day, the implied volatilities of
the options traded that day (history/days, derive/history.py) are fitted across strikes and
expiries. Wherever it is shown it is labelled as rebuilt from traded options, and it is never
joined to the recorded quotes (derive/features.py).

Definitions (fixed 3 October 2026, before publication, as features.py fixes the recorded ones):
- Index S for the day: perp rows traded on one side only (a wallet that only bought or only sold
  the perp that day), sum |delta_usd| / contracts: the index at each perp trade, contract-weighted.
  Fallback: the daily candle's (high + low + close) / 3 (derive/candles.py, backfilled bars in front).
- Instrument point: every leg of one option that day, its contract-weighted implied volatility (the
  history's `iv`: Black-76 on the index at the trade, no discounting) and total contracts. Tenor T
  runs from 12:00 UTC of the day to the 08:00 UTC expiry; points within 12 hours of expiry are left out.
- Carry c: Derive prices options on a forward above the index, and in its convention a call and a
  put at the same strike and expiry share one implied volatility; in the history's convention they
  differ by about K*c*T/vega. Each same-day call/put pair (7 to 200 days, strike within one standard
  deviation of the index) gives c = (iv_call - iv_put) * vega / (K * T); carry_day is the day's
  median. The carry used is the median of carry_day over the CSV's last 14 fitted rows (days that
  traded options and had an index) and the day (at least 3 values, else 5% a year), held within
  [-20%, 50%] a year.
- Derive's convention: each point's price (Black-76 on S at the history's iv) is inverted again with
  the forward F = S*e^(cT) and the discount e^(-cT).
- Fit, for tenor X in 7, 30 and 90 days: out-of-the-money points (calls with K >= F, puts below),
  |delta| >= 0.05, tenor in [X/2, 2X], |x| <= 2 with x = ln(K/F) / (iv_ref * sqrt(T)) and iv_ref
  the sqrt(contracts)-weighted mean iv. Weighted least squares (weights sqrt(contracts)), then one
  bisquare pass (residuals beyond 6 median absolute residuals get no weight):
  iv = a + b*x + c*x^2 [+ d*ln(T/X) when points sit on both sides of X].
- ATM = a. RR25 = iv(x_c25) - iv(x_p25), read from the fit at the 25-delta call and put points
  (x = +-0.6745 + sd/2, sd = ATM * sqrt(X/365)); dropped beyond +-0.5.
- No extrapolation: a reading needs at least 5 points, points on both sides of the money within 0.75
  standard deviations, and points on both sides of X or one within 25% of it; RR also needs points
  beyond 0.3 standard deviations on both wings. ATM outside (0.03, 5) is dropped.
- Halves (*_a, *_b): the same fits on the instruments with crc32(name) % 2 == 0 and == 1, at the
  day's carry; the publisher's reliability gate compares them.
- Recorded (rec_*): the median of that day's recorded 15-minute snapshots (features.py), over rec_n
  snapshots; null unless rec_n >= 72 of 96.

Rows are appended once per finished day and never rewritten; a change to these definitions needs
a new history_once.SURFACE_VERSION, which rebuilds every row.

The publisher (publish_site.surface_block) shows a 5-day median (centred where later days exist,
at least 3 values) and applies its own gates; smooth(), start_day() and reliability() are its helpers.
"""
from __future__ import annotations

import csv
import io
import math
import os
import zlib
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .history import parse_option, read_day

YEAR = 365 * 86400
TENORS = (7, 30, 90)
RR_TENORS = (7, 30)
WINDOWS = {7: (3.5, 14.0), 30: (15.0, 60.0), 90: (45.0, 180.0)}
MIN_DELTA = 0.05
X_MAX = 2.0
MIN_POINTS = 5
CARRY_ROWS = 14            # earlier rows read for the carry; with the day itself, a 15-day median
CARRY_DEFAULT = 0.05
CARRY_LIMITS = (-0.2, 0.5)
Z25 = 0.6744897501960817   # standard normal quantile at 0.75
FULL_DAY_SNAPSHOTS = 72    # of 96 fifteen-minute snapshots
SMOOTH_DAYS, SMOOTH_MIN = 5, 3
START_SPAN, START_SHARE = 30, 0.5
METRICS = ("atm7", "atm30", "atm90", "rr7", "rr30")
RECORDED = {"atm_iv_7d": "atm7", "atm_iv_30d": "atm30", "atm_iv_90d": "atm90", "rr25_7d": "rr7", "rr25_30d": "rr30"}
FIELDS = ("day", "index", "index_src", "carry_day", "carry_pairs", "carry", "points", "contracts",
          *METRICS, "n7", "n30", "n90",
          *(f"{m}_a" for m in METRICS), *(f"{m}_b" for m in METRICS),
          *(f"rec_{m}" for m in METRICS), "rec_n")
TEXT_FIELDS = ("day", "index_src")

_erf = np.frompyfunc(math.erf, 1, 1)


# ---------- pricing ----------

def ncdf(x):
    return 0.5 * (1.0 + _erf(np.asarray(x, dtype=float) / math.sqrt(2)).astype(float))


def b76(F, K, T, s, call):
    """Undiscounted Black-76 call or put (arrays)."""
    sd = s * np.sqrt(T)
    d1 = (np.log(F / K) + 0.5 * sd * sd) / sd
    c = F * ncdf(d1) - K * ncdf(d1 - sd)
    return np.where(call, c, c - (F - K))


def implied(price, F, K, T, call, lo0=1e-3, hi0=6.0, n=50):
    """Black-76 implied volatility by bisection (arrays); NaN outside the no-arbitrage range."""
    lo, hi = np.full(price.shape, lo0), np.full(price.shape, hi0)
    for _ in range(n):
        mid = (lo + hi) / 2
        up = b76(F, K, T, mid, call) < price
        lo, hi = np.where(up, mid, lo), np.where(up, hi, mid)
    out = (lo + hi) / 2
    intrinsic = np.where(call, np.maximum(F - K, 0), np.maximum(K - F, 0))
    return np.where((price > intrinsic) & (out < hi0 - 1e-3) & (out > lo0 * 1.5), out, np.nan)


def to_derive(S, K, T, iv_h, call, carry):
    """History-convention IVs (Black-76 on the index, no discount) in Derive's convention
    (forward S*e^(cT), discount e^(-cT))."""
    S = np.broadcast_to(np.asarray(S, dtype=float), np.shape(K))
    price = b76(S, K, T, iv_h, call)
    return implied(price * np.exp(carry * T), S * np.exp(carry * T), K, T, call)


# ---------- one day ----------

def _f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def day_points(day_rows) -> dict:
    """{und: {"perp": [sum |delta_usd|, contracts] of one-sided perp rows,
              "opt": {instrument: [iv * contracts, contracts]}}} for one history day."""
    out: dict = defaultdict(lambda: {"perp": [0.0, 0.0], "opt": {}})
    for r in day_rows:
        name = r["instrument"]
        buy, sell = _f(r.get("buy_contracts")) or 0.0, _f(r.get("sell_contracts")) or 0.0
        if name.endswith("-PERP"):
            if (buy > 0) != (sell > 0):
                a = out[name.split("-")[0]]["perp"]
                a[0] += abs(_f(r.get("delta_usd")) or 0.0)
                a[1] += buy + sell
            continue
        o = parse_option(name)
        iv = _f(r.get("iv"))
        if not o or not iv or buy + sell <= 0:
            continue
        a = out[o[0]]["opt"].setdefault(name, [0.0, 0.0])
        a[0] += iv * (buy + sell)
        a[1] += buy + sell
    return dict(out)


def instrument_points(day_rows, und: str) -> dict | None:
    """One coin's entry of day_points()."""
    return day_points(day_rows).get(und)


def option_points(day: str, S: float, opt: dict) -> list[dict]:
    t0 = datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp() + 43200
    pts = []
    for name, (ivc, c) in opt.items():
        _, expiry, strike, cp = parse_option(name)
        T = (expiry - t0) / YEAR
        if T <= 0.5 / 365:
            continue
        pts.append({"name": name, "expiry": expiry, "strike": strike, "cp": cp, "iv_h": ivc / c, "c": c, "T": T, "S": S})
    return pts


def carry_pairs(points: list[dict]) -> tuple[float | None, int]:
    """(median carry, pairs) from same-strike call/put pairs (history-convention IVs)."""
    by: dict = defaultdict(dict)
    for p in points:
        by[(p["expiry"], p["strike"])][p["cp"]] = p
    vals = []
    for (_, K), cp in by.items():
        if "C" not in cp or "P" not in cp:
            continue
        c, p = cp["C"], cp["P"]
        T, S = c["T"], c["S"]
        if not (7 / 365 <= T <= 200 / 365):
            continue
        s = (c["iv_h"] + p["iv_h"]) / 2
        sd = s * math.sqrt(T)
        k = math.log(K / S)
        if abs(k) / sd >= 1.0:
            continue
        d1 = (-k + 0.5 * sd * sd) / sd
        vega = S * math.sqrt(T) * math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
        vals.append((c["iv_h"] - p["iv_h"]) * vega / (K * T))
    return (float(np.median(vals)), len(vals)) if vals else (None, 0)


def _wls(X, y, w):
    W = np.sqrt(w)
    beta, *_ = np.linalg.lstsq(X * W[:, None], y * W, rcond=None)
    return beta


def _robust_wls(X, y, w):
    """WLS, then one bisquare pass (residuals beyond 6 median absolute residuals get no weight)."""
    b = _wls(X, y, w)
    r = y - X @ b
    s = np.median(np.abs(r)) * 6 or 1e-9
    u = np.clip(r / s, -1, 1)
    w2 = w * (1 - u * u) ** 2
    if (w2 > 0).sum() >= X.shape[1] + 1:
        b = _wls(X, y, w2)
    return b


def fit_tenor(P: dict, tenor: int, mask=None) -> dict | None:
    """{"atm", "rr", "n"} at `tenor` days from converted points P (dict of arrays), or None."""
    lo, hi = WINDOWS[tenor]
    Td = P["T"] * 365
    m = (Td >= lo) & (Td <= hi) & ((P["call"] & (P["k"] >= 0)) | (~P["call"] & (P["k"] < 0))) \
        & (np.abs(P["delta"]) >= MIN_DELTA) & np.isfinite(P["iv"])
    if mask is not None:
        m &= mask
    if m.sum() < MIN_POINTS:
        return None
    iv, k, T, c = P["iv"][m], P["k"][m], P["T"][m], P["c"][m]
    ref = float(np.average(iv, weights=np.sqrt(c)))
    x = k / (ref * np.sqrt(T))
    keep = np.abs(x) <= X_MAX
    iv, x, T, c = iv[keep], x[keep], T[keep], c[keep]
    if len(iv) < MIN_POINTS:
        return None
    lt = np.log(T * 365 / tenor)
    near = np.abs(x) <= 0.75
    if not ((x[near] < 0).any() and (x[near] >= 0).any()):
        return None  # one side of the money
    if not (((lt < 0).any() and (lt >= 0).any()) or (np.abs(lt) <= math.log(1.25)).any()):
        return None  # one side of the tenor, none near it
    cols = [np.ones(len(iv)), x, x * x]
    if (lt < 0).any() and (lt >= 0).any() and np.ptp(lt) > 0.05:
        cols.append(lt)
    X = np.column_stack(cols)
    if len(iv) < X.shape[1] + 2:
        return None
    b = _robust_wls(X, iv, np.sqrt(c))
    atm = float(b[0])
    if not 0.03 < atm < 5:
        return None
    rr = None
    if (x <= -0.3).any() and (x >= 0.3).any():
        sd = atm * math.sqrt(tenor / 365)
        xc, xp = Z25 + 0.5 * sd, -Z25 + 0.5 * sd
        rr = float(b[1] * (xc - xp) + b[2] * (xc * xc - xp * xp))
        if abs(rr) > 0.5:
            rr = None
    return {"atm": atm, "rr": rr, "n": int(len(iv))}


def _half(name: str) -> int:
    return zlib.crc32(name.encode()) % 2


def day_values(day: str, S: float, points: dict, carry_hist: list) -> dict:
    """One day's readings from its instrument points ({instrument: [iv * contracts, contracts]}).

    carry_hist: carry_day of the coin's previous fitted rows (None where a day had no pair), as carry_tail().
    """
    pts = option_points(day, S, points)
    cd, npairs = carry_pairs(pts)
    window = [v for v in carry_hist[-CARRY_ROWS:] if v is not None] + ([cd] if cd is not None else [])
    carry = float(np.median(window)) if len(window) >= 3 else CARRY_DEFAULT
    carry = min(max(carry, CARRY_LIMITS[0]), CARRY_LIMITS[1])
    row = {"day": day, "carry_day": cd, "carry_pairs": npairs, "carry": carry, "points": len(pts),
           "contracts": sum(p["c"] for p in pts)}
    for t in TENORS:
        row[f"n{t}"] = 0
    if not pts:
        return row
    K = np.array([p["strike"] for p in pts])
    T = np.array([p["T"] for p in pts])
    call = np.array([p["cp"] == "C" for p in pts])
    iv = to_derive(S, K, T, np.array([p["iv_h"] for p in pts]), call, carry)
    F = S * np.exp(carry * T)
    k = np.log(K / F)
    sd = iv * np.sqrt(T)
    d1 = (-k + 0.5 * sd * sd) / sd
    nd1 = ncdf(np.nan_to_num(d1))
    P = {"iv": iv, "k": k, "T": T, "call": call, "c": np.array([p["c"] for p in pts]),
         "delta": np.where(np.isfinite(d1), np.where(call, nd1, nd1 - 1), np.nan)}
    half = np.array([_half(p["name"]) for p in pts])
    for suffix, mask in (("", None), ("_a", half == 0), ("_b", half == 1)):
        for t in TENORS:
            r = fit_tenor(P, t, mask)
            row[f"atm{t}{suffix}"] = r["atm"] if r else None
            if t in RR_TENORS:
                row[f"rr{t}{suffix}"] = r["rr"] if r else None
            if not suffix:
                row[f"n{t}"] = r["n"] if r else 0
    return row


def recorded_daily(data: Path, und: str, day: str, source: str = "v2_mainnet") -> dict:
    """{metric: median of the day's recorded snapshots, "n": snapshots} from the features file."""
    p = Path(data) / source / und / "features" / f"{day}.csv"
    by: dict = defaultdict(list)
    snaps = set()
    if p.exists():
        start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()
        with p.open() as fh:
            for r in csv.DictReader(fh):
                ts, v = _f(r.get("ts")), _f(r.get("value"))
                if ts is None or not start <= ts < start + 86400:
                    continue
                snaps.add(ts)
                if r.get("feature") in RECORDED and v is not None:
                    by[RECORDED[r["feature"]]].append(v)
    return {**{m: float(np.median(v)) for m, v in by.items()}, "n": len(snaps)}


def candle_index(data: Path, und: str) -> dict[str, float]:
    """{YYYY-MM-DD: (high + low + close) / 3} of the daily candles, the index fallback."""
    from .candles import CandleCache
    c = CandleCache(data).load(und, "1d")
    if c is None:
        return {}
    return {datetime.fromtimestamp(int(ts) // 1000, timezone.utc).date().isoformat(): float((h + lo + cl) / 3)
            for ts, h, lo, cl in zip(c["timestamp"], c["high"], c["low"], c["close"])}


def surface_row(day: str, entry: dict | None, fallback_index: float | None, carry_hist: list,
                recorded: dict) -> dict | None:
    """The CSV row for one coin and day; None when it neither traded options nor was recorded."""
    entry = entry or {"perp": [0.0, 0.0], "opt": {}}
    if not entry["opt"] and not recorded.get("n"):
        return None
    perp = entry["perp"]
    S, src = (perp[0] / perp[1], "perp") if perp[1] > 0 else (fallback_index, "candle" if fallback_index else None)
    if S and entry["opt"]:
        row = day_values(day, S, entry["opt"], carry_hist)
    else:
        pts = option_points(day, 1.0, entry["opt"])
        row = {"day": day, "carry_pairs": 0, "points": len(pts), "contracts": sum(p["c"] for p in pts),
               "n7": 0, "n30": 0, "n90": 0}
    row.update(index=S, index_src=src)
    n = recorded.get("n", 0)
    row["rec_n"] = n
    for m in METRICS:
        row[f"rec_{m}"] = recorded.get(m) if n >= FULL_DAY_SNAPSHOTS else None
    return row


# ---------- the CSV (append-only) ----------

def _cell(v):
    if v is None:
        return ""
    if isinstance(v, float):
        return round(v, 6)
    return v


def format_row(row: dict) -> list:
    return [_cell(row.get(k)) for k in FIELDS]


def parse_row(raw: dict) -> dict:
    return {k: (raw.get(k) or None) if k in TEXT_FIELDS else _f(raw.get(k)) for k in FIELDS}


def read_rows(path: Path) -> list[dict]:
    """The CSV's rows, numbers as floats and blanks as None; [] when there is no file."""
    if not path.exists():
        return []
    with path.open() as fh:
        return [parse_row(r) for r in csv.DictReader(fh)]


def append_rows(path: Path, rows: list[dict]) -> None:
    """Appends rows, written atomically (the file is replaced whole, never left half-written)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    old = path.read_text() if path.exists() else ""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if not old:
        w.writerow(FIELDS)
    w.writerows(format_row(r) for r in rows)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(old + buf.getvalue())
    os.replace(tmp, path)


def carry_tail(rows: list[dict]) -> list:
    """carry_day of the last 14 rows that were fitted (traded options and an index; carry set)."""
    return [r["carry_day"] for r in rows if r.get("carry") is not None][-CARRY_ROWS:]


def extend(data: Path, out_dir: Path, days: list[str], keep_going=lambda: True, source: str = "v2_mainnet") -> int:
    """Appends the rows of `days` (in order) to out_dir/{UND}.csv; returns how many days were done.

    Stops when keep_going() turns false (after at least one day). A coin's day already in its file
    is skipped, so a run cut short between writing and saving its progress repeats nothing.
    """
    data = Path(data)
    rec_root = data / source
    recorded_coins = sorted(p.name for p in rec_root.iterdir() if p.is_dir()) if rec_root.exists() else []
    tails: dict[str, list] = {}
    last: dict[str, str | None] = {}
    candles: dict[str, dict] = {}
    new: dict[str, list] = defaultdict(list)
    done = 0
    for day in days:
        if done and not keep_going():
            break
        p = data / "history" / "days" / f"{day}.csv.gz"
        points = day_points(read_day(p)) if p.exists() else {}
        coins = {u for u, e in points.items() if e["opt"]} | \
                {u for u in recorded_coins if (rec_root / u / "features" / f"{day}.csv").exists()}
        for und in sorted(coins):
            if und not in tails:
                old = read_rows(out_dir / f"{und}.csv")
                tails[und] = carry_tail(old)
                last[und] = old[-1]["day"] if old else None
            if last[und] and last[und] >= day:
                continue
            entry = points.get(und)
            fallback = None
            if not entry or entry["perp"][1] <= 0:
                if und not in candles:
                    candles[und] = candle_index(data, und)
                fallback = candles[und].get(day)
            row = surface_row(day, entry, fallback, tails[und], recorded_daily(data, und, day, source))
            if row is None:
                continue
            new[und].append(row)
            if row.get("carry") is not None:
                # read back as written, so a resumed rebuild gives the same rows
                tails[und] = (tails[und] + [_f(_cell(row.get("carry_day")))])[-CARRY_ROWS:]
            last[und] = day
        done += 1
    for und, rows in new.items():
        append_rows(out_dir / f"{und}.csv", rows)
    return done


# ---------- publication helpers (publish_site.surface_block) ----------

def smooth(values: list, n: int = SMOOTH_DAYS, need: int = SMOOTH_MIN) -> list:
    """Median of the n-day window centred on each day (shorter at the newest end); None with fewer
    than `need` values."""
    h = n // 2
    out = []
    for i in range(len(values)):
        w = [v for v in values[max(0, i - h): i + h + 1] if v is not None]
        out.append(float(np.median(w)) if len(w) >= need else None)
    return out


def start_day(values: list, span: int = START_SPAN, share: float = START_SHARE) -> int | None:
    """First index where the trailing `span` days hold values on at least `share` of the days."""
    ok = [v is not None for v in values]
    run = sum(ok[:span - 1])
    for i in range(span - 1, len(values)):
        run += ok[i]
        if run / span >= share:
            return i
        run -= ok[i - span + 1]
    return None


def _spearman(x, y) -> float:
    rx, ry = np.argsort(np.argsort(x)), np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def reliability(a: list, b: list, start: int, min_pairs: int = 30) -> float | None:
    """Spearman-Brown corrected split-half rank correlation of the two halves' 5-day medians from `start`."""
    sa, sb = smooth(a)[start:], smooth(b)[start:]
    pairs = [(x, y) for x, y in zip(sa, sb) if x is not None and y is not None]
    if len(pairs) < min_pairs:
        return None
    r = _spearman(*map(np.array, zip(*pairs)))
    if not math.isfinite(r) or r <= -1:
        return None
    return round(2 * r / (1 + r), 3)

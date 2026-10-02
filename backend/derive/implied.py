"""The price distribution option prices imply for each expiry (market pricing, not a forecast).

For one expiry: implied volatility is interpolated across strikes in log-moneyness (puts below
the forward, calls above, as quoted), undiscounted call prices are computed on a fine strike
grid (Black-76), and the cumulative distribution is read from their slope
(Breeden-Litzenberger: F(K) = 1 + dC/dK). Outside the quoted strikes volatility is held flat.
With too few quotes, a lognormal at the expiry's ATM volatility stands in.

Quantiles are reported as price levels: the middle of the priced outcomes and the bands that
hold half and eight in ten of them. Option prices are known to over-price large moves; this
shows what traders pay for, not what happens.
"""
from __future__ import annotations

import math

YEAR = 365 * 86400
QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9)
GRID = 600


def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def black76_call(f: float, k: float, t: float, iv: float) -> float:
    if iv <= 0 or t <= 0:
        return max(f - k, 0.0)
    s = iv * math.sqrt(t)
    d1 = (math.log(f / k) + 0.5 * s * s) / s
    return f * _ncdf(d1) - k * _ncdf(d1 - s)


def _interp(xs: list[float], ys: list[float], x: float) -> float:
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xs[mid] <= x:
            lo = mid
        else:
            hi = mid
    w = (x - xs[lo]) / (xs[hi] - xs[lo])
    return ys[lo] + w * (ys[hi] - ys[lo])


def lognormal_quantiles(f: float, t: float, iv: float, qs=QUANTILES) -> list[float]:
    s = iv * math.sqrt(t)
    out = []
    for q in qs:  # inverse normal by bisection (no scipy)
        lo, hi = -8.0, 8.0
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if _ncdf(mid) < q else (lo, mid)
        out.append(f * math.exp(-0.5 * s * s + s * (lo + hi) / 2))
    return out


def smile_quantiles(rows: list[list], f: float, t: float, qs=QUANTILES) -> list[float] | None:
    """rows: [strike, call_oi, put_oi, call_iv, put_iv, ...]. None when the quotes are too thin."""
    pts = []
    for r in rows:
        k, civ, piv = r[0], r[3], r[4]
        iv = civ if k >= f else piv
        if iv and iv > 0 and k > 0:
            pts.append((math.log(k / f), iv))
    pts.sort()
    if len(pts) < 4 or pts[0][0] > -0.02 or pts[-1][0] < 0.02:
        return None
    xs, ivs = [p[0] for p in pts], [p[1] for p in pts]
    atm = _interp(xs, ivs, 0.0)
    width = 5 * atm * math.sqrt(t)
    grid = [f * math.exp(-width + 2 * width * i / (GRID - 1)) for i in range(GRID)]
    calls = [black76_call(f, k, t, _interp(xs, ivs, math.log(k / f))) for k in grid]
    cdf = []
    for i in range(1, GRID - 1):
        slope = (calls[i + 1] - calls[i - 1]) / (grid[i + 1] - grid[i - 1])
        cdf.append(min(1.0, max(0.0, 1 + slope)))
    for i in range(1, len(cdf)):  # a distribution never decreases
        cdf[i] = max(cdf[i], cdf[i - 1])
    ks = grid[1:-1]
    out = []
    for q in qs:
        j = next((i for i, c in enumerate(cdf) if c >= q), None)
        if j is None or j == 0:
            return None
        c0, c1 = cdf[j - 1], cdf[j]
        w = 0.0 if c1 == c0 else (q - c0) / (c1 - c0)
        out.append(ks[j - 1] + w * (ks[j] - ks[j - 1]))
    return out


def implied_by_expiry(strikes: dict | None, expiries: list[dict], ts: int, max_days: float = 120) -> list[dict]:
    """[{expiry, days, forward, q: [p10, p25, p50, p75, p90], method}] for expiries 1 to max_days days out."""
    by_exp = {str(e["expiry"]): e for e in expiries}
    rows_by_exp = (strikes or {}).get("expiries", {})
    out = []
    for key, e in sorted(by_exp.items(), key=lambda kv: int(kv[0])):
        days = (int(key) - ts) / 86400
        f, atm = e.get("forward"), e.get("atm_iv")
        if days < 1 or days > max_days or not f:
            continue
        t = days * 86400 / YEAR
        q = smile_quantiles(rows_by_exp.get(key) or [], f, t)
        method = "smile"
        if q is None:
            if not atm:
                continue
            q, method = lognormal_quantiles(f, t, atm), "atm"
        out.append({"expiry": int(key), "days": round(days, 2), "forward": f, "q": [round(v, 8) for v in q], "method": method})
    return out

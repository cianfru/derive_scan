"""The price distribution option prices imply for each expiry (market pricing, not a forecast).

For one expiry: implied volatility is interpolated across strikes in log-moneyness (puts below
the forward, calls above, as quoted), undiscounted call prices are computed on a fine strike
grid (Black-76), and the cumulative distribution is read from their slope
(Breeden-Litzenberger: F(K) = 1 + dC/dK). Outside the quoted strikes volatility is held flat.
With too few quotes, a lognormal at the expiry's ATM volatility stands in.

Quantiles are reported as price levels: the middle of the priced outcomes and the bands that
hold half and eight in ten of them. These are risk-neutral model ranges, not calibrated realised-return frequencies.
"""
from __future__ import annotations

import math

YEAR = 365 * 86400
QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9)
GRID = 600
NUMERICAL_TOLERANCE = 1e-7


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


def checked_smile(rows, f, t, qs=QUANTILES):
    """Reject invalid price curves instead of concealing them with a cumulative maximum."""
    pts = []
    for r in rows:
        k, civ, piv = r[0], r[3], r[4]
        iv = civ if k >= f else piv
        if iv and math.isfinite(iv) and iv > 0 and k > 0 and math.isfinite(k):
            pts.append((math.log(k / f), iv))
    pts.sort()
    quality = {"status": "thin_quotes", "quote_count": len(pts)}
    if len(pts) < 4 or pts[0][0] > -0.02 or pts[-1][0] < 0.02:
        return None, quality
    xs, ivs = [p[0] for p in pts], [p[1] for p in pts]
    if len(set(xs)) != len(xs):
        return None, dict(quality, status="duplicate_strikes")
    atm = _interp(xs, ivs, 0.0)
    width = 5 * atm * math.sqrt(t)
    grid = [f * math.exp(-width + 2 * width * i / (GRID - 1)) for i in range(GRID)]
    calls = [black76_call(f, k, t, _interp(xs, ivs, math.log(k / f))) for k in grid]
    slopes = [(b - a) / (kb - ka) for a, b, ka, kb in zip(calls, calls[1:], grid, grid[1:])]
    tol = NUMERICAL_TOLERANCE
    slope_error = max(max(slopes), -1 - min(slopes), 0)
    convexity_error = max([a - b for a, b in zip(slopes, slopes[1:])] + [0])
    quality.update(max_slope_violation=round(slope_error, 8), max_convexity_violation=round(convexity_error, 8),
                   lowest_strike=round(f * math.exp(xs[0]), 8), highest_strike=round(f * math.exp(xs[-1]), 8))
    if slope_error > tol or convexity_error > tol:
        return None, dict(quality, status="invalid_curve")
    cdf = [1 + (calls[i + 1] - calls[i - 1]) / (grid[i + 1] - grid[i - 1]) for i in range(1, GRID - 1)]
    ks = grid[1:-1]
    out = []
    for q in qs:
        j = next((i for i, c in enumerate(cdf) if c >= q), None)
        if j is None or j == 0:
            return None, dict(quality, status="insufficient_range")
        c0, c1 = cdf[j - 1], cdf[j]
        w = 0.0 if c1 == c0 else (q - c0) / (c1 - c0)
        out.append(ks[j - 1] + w * (ks[j] - ks[j - 1]))
    if out[0] < quality["lowest_strike"] or out[-1] > quality["highest_strike"]:
        return None, dict(quality, status="outside_quoted_strikes")
    return out, dict(quality, status="ready")


def smile_quantiles(rows: list[list], f: float, t: float, qs=QUANTILES) -> list[float] | None:
    return checked_smile(rows, f, t, qs)[0]


def implied_by_expiry(strikes: dict | None, expiries: list[dict], ts: int, max_days: float = 120) -> list[dict]:
    """[{expiry, days, forward, q: [p10, p25, p50, p75, p90], method}] for expiries 1 to max_days days out."""
    by_exp = {str(e["expiry"]): e for e in expiries}
    rows_by_exp = (strikes or {}).get("expiries", {})
    out = []
    for key, e in sorted(by_exp.items(), key=lambda kv: int(kv[0])):
        days = (int(key) - ts) / 86400
        f, atm = e.get("forward"), e.get("atm_iv")
        if days < 1 or days > max_days or not f or not math.isfinite(f) or f <= 0:
            continue
        t = days * 86400 / YEAR
        q, quality = checked_smile(rows_by_exp.get(key) or [], f, t)
        method = "smile"
        if q is None:
            if not atm or not math.isfinite(atm) or atm <= 0:
                continue
            q, method = lognormal_quantiles(f, t, atm), "atm"
        out.append({"expiry": int(key), "days": round(days, 2), "forward": f, "q": [round(v, 8) for v in q], "method": method, "quality": quality, "observed_at": ts})
    return out


def option_levels(strikes: dict | None, index: float | None, ts: int, max_days: float = 30) -> dict | None:
    """Where open interest sits across expiries up to max_days out (positions, not a forecast).

    call_wall: the strike at or above the index with the most call contracts open; put_wall: the
    strike at or below with the most puts; max_pain: the minimum aggregate intrinsic payout for the nearest nonempty expiry,
    explicitly identified by max_pain_expiry; by_expiry carries the separate calculations.
    """
    if not strikes or not index:
        return None
    by_expiry = []
    calls: dict[float, float] = {}
    puts: dict[float, float] = {}
    for key, rows in (strikes.get("expiries") or {}).items():
        days = (int(key) - ts) / 86400
        if days <= 0 or days > max_days:
            continue
        strikes_at_expiry = [float(r[0]) for r in rows]
        if strikes_at_expiry and any(r[1] or r[2] for r in rows):
            pain = min(strikes_at_expiry, key=lambda spot: sum(float(r[1] or 0) * max(spot - r[0], 0) +
                                                             float(r[2] or 0) * max(r[0] - spot, 0) for r in rows))
            by_expiry.append({"expiry": int(key), "max_pain": pain})
        for r in rows:
            k = float(r[0])
            calls[k] = calls.get(k, 0.0) + float(r[1] or 0)
            puts[k] = puts.get(k, 0.0) + float(r[2] or 0)
    ks = sorted(set(calls) | set(puts))
    if not ks or not (sum(calls.values()) + sum(puts.values())):
        return None
    above = [k for k in ks if k >= index and calls.get(k)]
    below = [k for k in ks if k <= index and puts.get(k)]
    by_expiry.sort(key=lambda e: e["expiry"])
    return {"days": max_days,
            "call_wall": max(above, key=lambda k: calls[k]) if above else None,
            "call_wall_oi": round(max(calls[k] for k in above), 4) if above else None,
            "put_wall": max(below, key=lambda k: puts[k]) if below else None,
            "put_wall_oi": round(max(puts[k] for k in below), 4) if below else None,
            "max_pain": by_expiry[0]["max_pain"] if by_expiry else None,
            "max_pain_expiry": by_expiry[0]["expiry"] if by_expiry else None, "by_expiry": by_expiry}

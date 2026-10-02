"""Volatility-surface features from one option chain snapshot.

Definitions (fixed before any data was looked at):
- Forward per expiry: median of the per-option forward Derive reports.
- ATM IV per expiry: out-of-the-money mark IVs (calls with K >= F, puts with K < F),
  linear in log-moneyness ln(K/F), read at 0. No extrapolation.
- 25-delta call / put IV: linear in delta over calls (0.25) and puts (-0.25). No extrapolation.
- RR25 = call25 - put25; BF25 = (call25 + put25) / 2 - ATM.
- Constant-maturity ATM IV (7/30/90 days): linear in total variance iv^2 * T between the
  two expiries that bracket the tenor. RR25/BF25 at 30 days: linear in T. No extrapolation.
  RR25 at 7 days, same method (added 2 October 2026 for the 7-day options reading).
- Put/call OI ratio: put contracts / call contracts across all live expiries.
- Funding: Derive quotes a per-hour rate; annualised = rate * 24 * 365.
- Perp basis: (mark - index) / index.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import median

YEAR_SEC = 365 * 24 * 3600
TENORS_DAYS = (7, 30, 90)


@dataclass
class OptionQuote:
    name: str
    strike: float
    kind: str  # "C" | "P"
    iv: float | None
    delta: float | None
    forward: float | None
    oi: float
    index: float | None


@dataclass
class ExpirySlice:
    expiry: int
    tenor_days: float
    forward: float | None
    atm_iv: float | None
    iv_c25: float | None
    iv_p25: float | None
    rr25: float | None
    bf25: float | None
    call_oi: float
    put_oi: float
    n_options: int


def _f(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def quote_from_ticker(name: str, strike: float, kind: str, t: dict) -> OptionQuote:
    """Parse Derive's compact ticker (same shape in V2 and V3)."""
    p = t.get("option_pricing") or {}
    iv = _f(p.get("i"))
    stats = t.get("stats") or {}
    return OptionQuote(
        name=name, strike=strike, kind=kind,
        iv=iv if iv and iv > 0 else None,
        delta=_f(p.get("d")), forward=_f(p.get("f")),
        oi=_f(stats.get("oi")) or 0.0, index=_f(t.get("I")),
    )


def interp(points: list[tuple[float, float]], x: float) -> float | None:
    """Linear interpolation at x; None if x is outside the points' range."""
    pts = sorted(points)
    if len(pts) == 1:
        return pts[0][1] if pts[0][0] == x else None
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            if x1 == x0:
                return (y0 + y1) / 2
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return None


def expiry_slice(expiry: int, now: float, quotes: list[OptionQuote]) -> ExpirySlice:
    fwds = [q.forward for q in quotes if q.forward and q.forward > 0]
    fwd = median(fwds) if fwds else None
    atm = c25 = p25 = None
    if fwd:
        otm = [(math.log(q.strike / fwd), q.iv) for q in quotes if q.iv is not None
               and ((q.kind == "C" and q.strike >= fwd) or (q.kind == "P" and q.strike < fwd))]
        atm = interp(otm, 0.0)
    c25 = interp([(q.delta, q.iv) for q in quotes if q.kind == "C" and q.iv is not None and q.delta is not None], 0.25)
    p25 = interp([(q.delta, q.iv) for q in quotes if q.kind == "P" and q.iv is not None and q.delta is not None], -0.25)
    rr = c25 - p25 if c25 is not None and p25 is not None else None
    bf = (c25 + p25) / 2 - atm if c25 is not None and p25 is not None and atm is not None else None
    return ExpirySlice(
        expiry=expiry, tenor_days=(expiry - now) / 86400, forward=fwd, atm_iv=atm,
        iv_c25=c25, iv_p25=p25, rr25=rr, bf25=bf,
        call_oi=sum(q.oi for q in quotes if q.kind == "C"),
        put_oi=sum(q.oi for q in quotes if q.kind == "P"),
        n_options=len(quotes),
    )


def constant_maturity_iv(slices: list[ExpirySlice], days: float) -> float | None:
    pts = [(s.tenor_days, s.atm_iv ** 2 * s.tenor_days) for s in slices if s.atm_iv is not None and s.tenor_days > 0]
    w = interp(pts, days)
    return math.sqrt(w / days) if w is not None and w > 0 else None


def constant_maturity(slices: list[ExpirySlice], attr: str, days: float) -> float | None:
    return interp([(s.tenor_days, getattr(s, attr)) for s in slices if getattr(s, attr) is not None and s.tenor_days > 0], days)


def surface_features(slices: list[ExpirySlice], index: float | None, perp: dict | None) -> dict[str, float]:
    out: dict[str, float | None] = {"index_price": index}
    for d in TENORS_DAYS:
        out[f"atm_iv_{d}d"] = constant_maturity_iv(slices, d)
    out["rr25_7d"] = constant_maturity(slices, "rr25", 7)
    out["rr25_30d"] = constant_maturity(slices, "rr25", 30)
    out["bf25_30d"] = constant_maturity(slices, "bf25", 30)
    calls = sum(s.call_oi for s in slices)
    puts = sum(s.put_oi for s in slices)
    out["pc_oi_ratio"] = puts / calls if calls > 0 else None
    out["option_oi_contracts"] = calls + puts
    if perp:
        f = _f(perp.get("f"))
        mark, idx = _f(perp.get("M")), _f(perp.get("I"))
        out["funding_1h"] = f
        out["funding_ann"] = f * 24 * 365 if f is not None else None
        out["perp_basis"] = (mark - idx) / idx if mark and idx else None
        out["perp_oi_contracts"] = _f((perp.get("stats") or {}).get("oi"))
    return {k: v for k, v in out.items() if v is not None}

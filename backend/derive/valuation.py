"""Live display valuation only; historical wallet classification is unchanged."""
from .quality import number, snapshot_status


def delta_at(strikes, expiry, strike, cp, index, now):
    """Return unit delta and provenance. Never invent an IV for an unquoted position."""
    if snapshot_status((strikes or {}).get("ts"), now) != "ready":
        return None, "unavailable"
    from .history import option_delta
    for row in ((strikes or {}).get("expiries") or {}).get(str(expiry), []):
        if abs(float(row[0]) - strike) > 1e-9:
            continue
        call_delta = number(row[5]) if len(row) > 5 else None
        if call_delta is not None and 0 <= call_delta <= 1:
            return (call_delta if cp == "C" else call_delta - 1), "quoted"
        iv = number(row[3] if cp == "C" else row[4])
        if iv and iv > 0 and index and index > 0:
            return option_delta(index, strike, max(expiry - now, 0) / (365 * 86400), iv, cp), "model_iv"
    return None, "unavailable"

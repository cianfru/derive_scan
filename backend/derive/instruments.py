"""Instrument discovery and name parsing.

Names (docs: /trading/instrument-names.md): options `ETH-20261030-1500-C`,
perps `ETH-PERP`. Strikes can be decimal (`HYPE-20261030-42.5-P`).
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone

from .client import DeriveClient


@dataclass(frozen=True)
class OptionName:
    underlying: str
    expiry_date: str  # YYYYMMDD
    strike: float
    kind: str  # "C" or "P"


def parse_option_name(name: str) -> OptionName | None:
    parts = name.split("-")
    if len(parts) != 4:
        return None
    und, date, strike, kind = parts
    if len(date) != 8 or not date.isdigit() or kind not in ("C", "P"):
        return None
    try:
        # Derive writes fractional strikes with an underscore ("1_35" is 1.35); Python's float()
        # would silently read "1_35" as 135, so the underscore is turned into a decimal point.
        k = float(strike.replace("_", "."))
    except ValueError:
        return None
    if k <= 0:
        return None
    return OptionName(und, date, k, kind)


def perp_name(underlying: str) -> str:
    return f"{underlying}-PERP"


def expiry_date(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y%m%d")


async def fetch_options(client: DeriveClient, api: int, currency: str) -> list[dict]:
    """Full definitions of unexpired option instruments for one currency."""
    params = {"currency": currency, "instrument_type": "option", "expired": False}
    if api == 2:
        res = await client.public("get_instruments", params)
        return list(res)
    out: list[dict] = []
    page = 1
    while True:
        res = await client.public("get_all_instruments", {**params, "page": page, "page_size": 1000})
        out.extend(res.get("instruments", []))
        pages = (res.get("pagination") or {}).get("num_pages", 1)
        if page >= pages:
            return out
        page += 1


def live_expiries(instruments: list[dict], now: float | None = None) -> list[int]:
    """Expiry timestamps of active options that have not yet expired, ascending."""
    now = time.time() if now is None else now
    exps = set()
    for i in instruments:
        od = i.get("option_details") or {}
        exp = od.get("expiry")
        if i.get("is_active") and exp and exp > now:
            exps.add(int(exp))
    return sorted(exps)

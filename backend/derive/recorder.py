"""Scheduled recorder: every interval, for each source and underlying, read the
option chain and perp ticker, compute features, store them.

Derive does not serve past IV surfaces, so this is the only way to build the dataset.
"""
from __future__ import annotations

import asyncio
import fcntl
import logging
import time
from pathlib import Path

from .client import DeriveClient, DeriveRPCError
from .config import SOURCES, Settings
from .features import OptionQuote, expiry_slice, quote_from_ticker, surface_features
from .instruments import expiry_date, fetch_options, live_expiries, parse_option_name, perp_name
from .store import Store

log = logging.getLogger(__name__)

INSTRUMENTS_TTL = 3600


def strike_rows(quotes: list[OptionQuote]) -> list[list]:
    """[strike, call_oi, put_oi, call_iv, put_iv, call_delta] per strike, ascending."""
    by: dict[float, list] = {}
    for q in quotes:
        row = by.setdefault(q.strike, [q.strike, 0.0, 0.0, None, None, None])
        if q.kind == "C":
            row[1], row[3], row[5] = q.oi, q.iv, q.delta
        else:
            row[2], row[4] = q.oi, q.iv
    return [by[k] for k in sorted(by)]


class Recorder:
    def __init__(self, settings: Settings, store: Store, clients: dict[str, DeriveClient] | None = None):
        self.s = settings
        self.store = store
        self.clients = clients or {src: DeriveClient(SOURCES[src]["base"]) for src in settings.sources}
        self._instruments: dict[tuple[str, str], tuple[float, list[dict]]] = {}
        self.status: dict[str, dict] = {}
        # Per-strike view of the newest chain, per source:underlying (published for the app, not stored).
        self.strikes: dict[str, dict] = {}
        self._lock_file = None

    # -- one snapshot -------------------------------------------------------
    async def _instruments_for(self, source: str, currency: str) -> list[dict]:
        key = (source, currency)
        cached = self._instruments.get(key)
        if cached and time.time() - cached[0] < INSTRUMENTS_TTL:
            return cached[1]
        inst = await fetch_options(self.clients[source], SOURCES[source]["api"], currency)
        self._instruments[key] = (time.time(), inst)
        return inst

    async def snapshot(self, source: str, underlying: str, ts: int, keep_chain: bool, keep_slices: bool = True) -> dict:
        client = self.clients[source]
        try:
            inst = await self._instruments_for(source, underlying)
        except DeriveRPCError as e:
            if e.code != 12001:  # "Instrument not found": listed for options, none issued
                raise
            inst = []
        expiries = live_expiries(inst, now=ts)
        if not expiries:  # listed for options but none live: nothing to record
            return {"expiries": 0, "options": 0, "features": 0}
        chain: dict[str, dict] = {}
        slices = []
        strikes: dict[str, list] = {}
        index = None
        for exp in expiries:
            res = await client.public("get_tickers", {"instrument_type": "option", "currency": underlying,
                                                      "expiry_date": expiry_date(exp)})
            tickers = res.get("tickers", {})
            quotes: list[OptionQuote] = []
            for name, t in tickers.items():
                on = parse_option_name(name)
                if on is None:
                    continue
                q = quote_from_ticker(name, on.strike, on.kind, t)
                quotes.append(q)
                index = index or q.index
            chain.update(tickers)
            if quotes:
                slices.append(expiry_slice(exp, ts, quotes))
                strikes[str(exp)] = strike_rows(quotes)
        perp_res = await client.public("get_tickers", {"instrument_type": "perp", "currency": underlying})
        perp = (perp_res.get("tickers") or {}).get(perp_name(underlying))
        if perp and perp.get("I"):
            index = float(perp["I"])
        feats = surface_features(slices, index, perp)
        self.strikes[f"{source}:{underlying}"] = {"ts": ts, "index": index, "expiries": strikes}
        chain_doc = {"options": chain, "perp": perp} if keep_chain else None
        if keep_slices:
            self.store.write_snapshot(ts, source, underlying, feats, slices, chain=chain_doc)
        else:  # FileStore only: latest.json keeps every slot's term structure, the CSV only some
            self.store.write_snapshot(ts, source, underlying, feats, slices, chain=chain_doc, keep_slices=False)
        return {"expiries": len(slices), "options": len(chain), "features": len(feats)}

    async def run_once(self, ts: int | None = None, only: set[str] | None = None) -> None:
        """Record every source:underlying, or only the keys in `only`."""
        ts = int(ts or time.time())
        any_chain = False
        for source in self.s.sources:
            for und in self.s.underlyings:
                key = f"{source}:{und}"
                if only is not None and key not in only:
                    continue
                t0 = time.monotonic()
                keep_chain = ts % self.s.chain_every(und) < self.s.interval_sec
                keep_slices = ts % self.s.slice_every(und) < self.s.interval_sec
                any_chain = any_chain or keep_chain
                try:
                    info = await self.snapshot(source, und, ts, keep_chain, keep_slices)
                    self.status[key] = {"ok": True, "ts": ts, "secs": round(time.monotonic() - t0, 2), **info}
                except Exception as e:  # one bad source must not stop the others
                    log.exception("snapshot %s failed", key)
                    self.status[key] = {"ok": False, "ts": ts, "error": str(e)[:300]}
        if any_chain and self.s.chain_retention_days > 0:
            self.store.prune_chains(ts - self.s.chain_retention_days * 86400)

    # -- loop ---------------------------------------------------------------
    def acquire_lock(self) -> bool:
        """One recorder per data directory, even with several web workers."""
        path = Path(self.s.data_dir) / "recorder.lock"
        path.parent.mkdir(parents=True, exist_ok=True)
        f = open(path, "w")
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.close()
            return False
        self._lock_file = f
        return True

    async def run_forever(self) -> None:
        if not self.acquire_lock():
            log.info("recorder already running in another process")
            return
        iv = self.s.interval_sec
        while True:
            # Align to wall-clock multiples of the interval so snapshots line up across days.
            now = time.time()
            ts = int(now // iv * iv)
            await self.run_once(ts)
            await asyncio.sleep(max(1.0, ts + iv - time.time()))

    async def close(self) -> None:
        for c in self.clients.values():
            await c.close()

"""One name per trader across the V2 -> V3 move.

V2's public trades name each leg by the Derive Wallet (a smart-contract wallet) that holds the
subaccount; V3 names the owner's own address instead. Derive moved every subaccount to V3 with
its id unchanged, and the same trades read from both carry the same subaccount id (checked
5 October 2026: 235 of 238 wallets trading on 4 October changed address, one to one per
subaccount). The traders' history, the market-maker list and the app's trader pages are keyed by
the V2 name, so every leg read from V3 mainnet is given the V2 wallet of its subaccount.

history/wallet_aliases.json   {"version": 1, "subaccounts": {"182": "0x856A..." | null}, "last_run": {...}}

A subaccount is looked up once on V2 (`public/get_trade_history` filtered by subaccount, one leg):
its V2 wallet, or null when V2 never saw it trade (opened on V3: its V3 name stands). A lookup
that fails is not saved and is tried again on the next read; meanwhile that leg keeps its V3
name, and `last_run.unresolved_legs` counts such legs.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

log = logging.getLogger(__name__)

VERSION = 1
CONCURRENCY = 8
BUDGET_SECONDS = 60.0  # lookups per read; the rest wait for the next read


def alias_path(root: Path | str) -> Path:
    return Path(root) / "history" / "wallet_aliases.json"


class WalletAlias:
    def __init__(self, root: Path | str, v2_base: str | None = None, *, client=None,
                 budget: float = BUDGET_SECONDS, clock=time.monotonic):
        self.path = alias_path(root)
        doc = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.map: dict[str, str | None] = dict(doc.get("subaccounts") or {})
        self._base, self._client, self._own = v2_base, client, client is None
        self.budget, self.clock = budget, clock
        self.stats = {"legs": 0, "renamed_legs": 0, "unresolved_legs": 0, "lookups": 0, "lookup_errors": 0}

    def _v2(self):
        if self._client is None:
            from .client import DeriveClient
            self._client = DeriveClient(self._base, retries=1, timeout=10.0)
        return self._client

    async def _lookup(self, sub: int) -> str | None:
        res = await self._v2().public("get_trade_history", {"subaccount_id": sub, "page_size": 1, "page": 1})
        for t in res.get("trades") or []:
            if t.get("subaccount_id") == sub and t.get("wallet"):
                return t["wallet"]
        return None

    async def resolve(self, subs: set[int]) -> None:
        todo = sorted(s for s in subs if str(s) not in self.map)
        if not todo:
            return
        deadline = self.clock() + self.budget
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(sub: int) -> None:
            async with sem:
                if self.clock() > deadline:
                    return
                self.stats["lookups"] += 1
                try:
                    self.map[str(sub)] = await self._lookup(sub)
                except Exception as e:  # not saved: tried again on the next read
                    self.stats["lookup_errors"] += 1
                    log.warning("V2 wallet of subaccount %s: %s", sub, e)

        await asyncio.gather(*(one(s) for s in todo))

    async def apply(self, legs: list[dict]) -> list[dict]:
        """Renames each leg's `wallet` to its subaccount's V2 wallet (in place; the V3 name is kept
        as `wallet_v3`). Returns the legs."""
        subs = {t["subaccount_id"] for t in legs if isinstance(t.get("subaccount_id"), int)}
        await self.resolve(subs)
        for t in legs:
            self.stats["legs"] += 1
            sub = t.get("subaccount_id")
            if not isinstance(sub, int):
                continue
            key = str(sub)
            if key not in self.map:
                self.stats["unresolved_legs"] += 1
                continue
            v2 = self.map[key]
            if v2 and v2 != t.get("wallet"):
                t["wallet_v3"], t["wallet"] = t.get("wallet"), v2
                self.stats["renamed_legs"] += 1
        self.save()
        return legs

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": VERSION, "subaccounts": dict(sorted(self.map.items(), key=lambda kv: int(kv[0]))),
                                   "last_run": {"at": int(time.time()), **self.stats}}, separators=(",", ":")))
        tmp.replace(self.path)

    async def close(self) -> None:
        if self._own and self._client is not None:
            await self._client.close()


def attach(client, source: str, root: Path | str) -> WalletAlias | None:
    """Gives `client` a WalletAlias when `source` takes its wallet names from another source
    (config.SOURCES "wallets_from"); flow.read_exact applies it to every leg it returns."""
    from .config import SOURCES
    origin = SOURCES.get(source, {}).get("wallets_from")
    if not origin:
        return None
    client.wallet_alias = WalletAlias(root, SOURCES[origin]["base"])
    return client.wallet_alias


async def detach(client) -> None:
    alias = getattr(client, "wallet_alias", None)
    if alias is not None:
        await alias.close()

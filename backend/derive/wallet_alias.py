"""One name per trader: the owner's own wallet (owner's decision, 5 October 2026).

V2's public trades name each leg by the Derive Wallet (a smart-contract wallet, "SCW") that holds
the subaccount; V3 names the owner's own address (an EOA), the address a user sees in their wallet
and in Derive's app. Derive moved every subaccount to V3 with its id unchanged (checked 5 October
2026: 235 of 238 wallets trading on 4 October changed address, one to one per subaccount). The
EOA is the canonical name: every aggregate (traders' history, flow, cohorts, tiers, leaderboard,
radar balance, trader pages, market-maker list) is keyed by it once it is known, and by the SCW
until then.

history/wallet_aliases.json, version 2:
    {"version": 2,
     "subaccounts": {"182": "0xSCW..." | null},   V2 wallet of each subaccount (null: V2 never saw it)
     "owners":      {"182": "0xEOA..."},          V3 owner of each subaccount, from V3 trades
     "owner_days":  ["2026-10-04", ...],          finished days whose V3 trades were read (wallet_alias_once.py)
     "last_run": {...}}
Version 1 held only "subaccounts"; it is read as version 2 with no owners.

SCW -> EOA (`canonical`): an SCW whose subaccounts with a known owner all name the same EOA. An SCW
whose subaccounts name different EOAs is never translated (two different wallets are never merged);
it is listed in `conflicts`. Several SCWs (or an SCW and the EOA's own V3 legs) owned by one EOA are
merged under it, which is the same trader.

Where names are learned, all from public trades:
- V2 legs (source v2_mainnet) carry subaccount and SCW: recorded as they pass, no extra call; the
  leg's wallet is then given its EOA when known (the SCW is kept as `wallet_raw`).
- V3 legs (source v3_mainnet, and wallet_alias_once.py) carry subaccount and EOA: recorded as
  owners; the leg keeps its wallet as given. A subaccount seen on V3 whose SCW is not known is
  looked up once on V2 (`public/get_trade_history` filtered by subaccount, one leg), and only while
  its owner has no SCW known yet: the lookup exists to find the SCW name of history already held.
  A lookup that fails is not saved and is tried again on the next read.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from pathlib import Path

log = logging.getLogger(__name__)

VERSION = 2
CONCURRENCY = 8
BUDGET_SECONDS = 60.0  # lookups per read; the rest wait for the next read
OWNER_DAYS_KEEP = 45


def alias_path(root: Path | str) -> Path:
    return Path(root) / "history" / "wallet_aliases.json"


def load(root: Path | str) -> dict:
    """The alias file as version 2 (a version 1 file has no owners); empty when missing or unreadable."""
    p = alias_path(root)
    try:
        doc = json.loads(p.read_text()) if p.exists() else {}
    except ValueError:
        doc = {}
    return {"version": VERSION, "subaccounts": dict(doc.get("subaccounts") or {}),
            "owners": dict(doc.get("owners") or {}) if doc.get("version", 1) >= 2 else {},
            "owner_days": list(doc.get("owner_days") or []) if doc.get("version", 1) >= 2 else [],
            "last_run": doc.get("last_run") or {}}


def scw_to_eoa(subaccounts: dict, owners: dict) -> tuple[dict[str, str], list[str]]:
    """({scw lowercased: EOA as V3 writes it}, [conflicting SCWs lowercased]). An SCW is translated only
    when every subaccount of it with a known owner names one EOA (compared case-insensitively)."""
    seen: dict[str, dict[str, str]] = {}
    for sub, scw in subaccounts.items():
        eoa = owners.get(sub)
        if scw and eoa:
            seen.setdefault(scw.lower(), {})[eoa.lower()] = eoa
    out, conflicts = {}, []
    for scw, eoas in seen.items():
        if len(eoas) == 1:
            eoa = next(iter(eoas.values()))
            if eoa.lower() != scw:
                out[scw] = eoa
        else:
            conflicts.append(scw)
    return out, sorted(conflicts)


class Canon:
    """Translates a wallet to its canonical name: the EOA for a known SCW, otherwise unchanged.
    `targets`: the EOAs some SCW translates to (lowercased); `digest`: changes with the map."""

    def __init__(self, mapping: dict[str, str] | None = None, conflicts: list[str] | None = None):
        self.map = dict(mapping or {})
        self.conflicts = list(conflicts or [])
        self.targets = {e.lower() for e in self.map.values()}
        self.digest = hashlib.sha1(json.dumps(sorted(self.map.items())).encode()).hexdigest()[:12] if self.map else ""

    def __call__(self, wallet):
        return self.map.get(wallet.lower(), wallet) if wallet else wallet

    def __bool__(self) -> bool:
        return bool(self.map)

    def __len__(self) -> int:
        return len(self.map)

    def merged(self, wallet: str) -> bool:
        """True when this name is an SCW that translates, or an EOA some SCW translates to."""
        low = wallet.lower()
        return low in self.map or low in self.targets


def canonical(root: Path | str) -> Canon:
    """The SCW -> EOA translation from the alias file under root (identity when there is none)."""
    doc = load(root)
    return Canon(*scw_to_eoa(doc["subaccounts"], doc["owners"]))


def translate_keys(d: dict, canon: Canon, prefer=None) -> dict:
    """{canon(key): value}. When two keys meet under one name, `prefer(a, b)` picks the value
    (default: keep the one already there)."""
    if not canon:
        return d
    out: dict = {}
    for k, v in d.items():
        c = canon(k)
        out[c] = prefer(out[c], v) if c in out and prefer else out.get(c, v)
    return out


class WalletAlias:
    """Learns names from the legs it is given (`apply`) and keeps history/wallet_aliases.json.

    mode "v2": legs carry SCWs; each leg's wallet becomes its EOA when known.
    mode "v3": legs carry EOAs (kept); unknown SCWs are looked up on V2 at `v2_base`."""

    def __init__(self, root: Path | str, v2_base: str | None = None, *, mode: str = "v3", client=None,
                 budget: float = BUDGET_SECONDS, clock=time.monotonic):
        self.root = Path(root)
        self.path = alias_path(root)
        doc = load(root)
        self.map: dict[str, str | None] = doc["subaccounts"]
        self.owners: dict[str, str] = doc["owners"]
        self.owner_days: list[str] = doc["owner_days"]
        self.mode = mode
        self._base, self._client, self._own = v2_base, client, client is None
        self.budget, self.clock = budget, clock
        self._saved = self._content()
        self.stats = {"mode": mode, "legs": 0, "renamed_legs": 0, "lookups": 0, "lookup_errors": 0,
                      "new_owners": 0, "new_subaccounts": 0}

    def canon(self) -> Canon:
        return Canon(*scw_to_eoa(self.map, self.owners))

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

    def observe(self, legs: list[dict]) -> None:
        """Records each leg's subaccount -> wallet: the SCW in mode v2, the owner in mode v3."""
        for t in legs:
            sub, wallet = t.get("subaccount_id"), t.get("wallet_raw") or t.get("wallet")
            if not isinstance(sub, int) or not wallet:
                continue
            key = str(sub)
            if self.mode == "v2":
                if self.map.get(key) != wallet:
                    self.stats["new_subaccounts"] += 1
                    self.map[key] = wallet
            elif self.owners.get(key) != wallet:
                self.stats["new_owners"] += 1
                self.owners[key] = wallet

    async def resolve(self, subs: set[int]) -> None:
        """V2 lookups for subaccounts seen on V3 whose SCW is unknown and whose owner has no SCW yet."""
        with_scw = {self.owners[s].lower() for s, scw in self.map.items() if scw and s in self.owners}
        todo = sorted(s for s in subs if str(s) not in self.map
                      and (self.owners.get(str(s)) or "").lower() not in with_scw)
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
        """Learns from the legs, then (mode v2) gives each leg its canonical wallet in place, the
        name as read kept as `wallet_raw`. Returns the legs."""
        self.observe(legs)
        self.stats["legs"] += len(legs)
        if self.mode == "v3":
            await self.resolve({t["subaccount_id"] for t in legs if isinstance(t.get("subaccount_id"), int)})
        else:
            canon = self.canon()
            for t in legs:
                wallet = t.get("wallet")
                name = canon(wallet)
                if name != wallet:
                    t["wallet_raw"], t["wallet"] = wallet, name
                    self.stats["renamed_legs"] += 1
        self.save()
        return legs

    def mark_day(self, day: str) -> None:
        if day not in self.owner_days:
            self.owner_days = sorted(self.owner_days + [day])[-OWNER_DAYS_KEEP:]

    def _content(self) -> dict:
        return {"version": VERSION,
                "subaccounts": dict(sorted(self.map.items(), key=lambda kv: int(kv[0]))),
                "owners": dict(sorted(self.owners.items(), key=lambda kv: int(kv[0]))),
                "owner_days": self.owner_days}

    def save(self) -> None:
        """Writes the file when a name or a read day was added (the data branch keeps every version,
        so an unchanged file is not rewritten)."""
        content = self._content()
        if content == self._saved and self.path.exists():
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        canon = self.canon()
        tmp.write_text(json.dumps({**content, "last_run": {"at": int(time.time()), **self.stats,
                                                           "translated_scws": len(canon),
                                                           "conflicts": len(canon.conflicts)}},
                                  separators=(",", ":")))
        tmp.replace(self.path)
        self._saved = content

    async def close(self) -> None:
        if self._own and self._client is not None:
            await self._client.close()


def attach(client, source: str, root: Path | str) -> WalletAlias | None:
    """Gives `client` a WalletAlias for a mainnet source (config.SOURCES "wallets"): "scw" sources
    have their legs renamed to the owner's wallet, "eoa" sources teach the owners. flow.read_exact
    applies it to every leg it returns."""
    from .config import SOURCES
    cfg = SOURCES.get(source, {})
    kind = cfg.get("wallets")
    if kind not in ("scw", "eoa"):
        return None
    origin = cfg.get("wallets_from")
    client.wallet_alias = WalletAlias(root, SOURCES[origin]["base"] if origin else None,
                                      mode="v2" if kind == "scw" else "v3")
    return client.wallet_alias


async def detach(client) -> None:
    alias = getattr(client, "wallet_alias", None)
    if alias is not None:
        await alias.close()

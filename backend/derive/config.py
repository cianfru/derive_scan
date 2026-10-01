"""Settings from the environment. Nothing here is secret: the recorder reads public data only."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Public JSON-RPC bases. Methods are POSTed to base + "public/<method>".
SOURCES = {
    "v2_mainnet": {"base": "https://api.lyra.finance/", "api": 2},
    "v3_testnet": {"base": "https://testnet.api.derive.xyz/v3/", "api": 3},
    "v3_mainnet": {"base": "https://api.derive.xyz/v3/", "api": 3},
}


def _csv(name: str, default: str) -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


@dataclass
class Settings:
    sources: list[str] = field(default_factory=lambda: _csv("DERIVE_SNAPSHOT_SOURCES", "v2_mainnet"))
    underlyings: list[str] = field(default_factory=lambda: [u.upper() for u in _csv("DERIVE_UNDERLYINGS", "BTC,ETH")])
    interval_sec: int = field(default_factory=lambda: int(os.getenv("DERIVE_SNAPSHOT_INTERVAL_SEC", "900")))
    # Raw option chains (gzip) are kept once an hour so features can be recomputed later.
    chain_every_sec: int = field(default_factory=lambda: int(os.getenv("DERIVE_CHAIN_EVERY_SEC", "3600")))
    chain_retention_days: int = field(default_factory=lambda: int(os.getenv("DERIVE_CHAIN_RETENTION_DAYS", "365")))
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", "data")))
    recorder_enabled: bool = field(default_factory=lambda: os.getenv("DERIVE_RECORDER", "on").lower() != "off")

    def __post_init__(self) -> None:
        self.data_dir = Path(self.data_dir)
        unknown = [s for s in self.sources if s not in SOURCES]
        if unknown:
            raise ValueError(f"unknown DERIVE_SNAPSHOT_SOURCES: {unknown}; known: {list(SOURCES)}")
        if self.interval_sec < 60:
            raise ValueError("DERIVE_SNAPSHOT_INTERVAL_SEC must be at least 60")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "derive.db"

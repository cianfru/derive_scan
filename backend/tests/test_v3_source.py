"""The V3 mainnet source: shape differences found against api.derive.xyz/v3 on 5 October 2026."""
import asyncio
import json

import httpx
import pytest

import record_once
from derive import flow, history
from derive.client import DeriveClient
from derive.config import SOURCES, Settings, store_dir
from derive.filestore import FileStore
from derive.question_job import kept_chains
from derive.wallet_alias import WalletAlias, attach, detach


def test_v2_stays_the_default(monkeypatch):
    monkeypatch.delenv("DERIVE_SNAPSHOT_SOURCES", raising=False)
    assert Settings().sources == ["v2_mainnet"]


def test_option_currencies_reads_both_shapes():
    v2 = [{"currency": "BTC", "instrument_types": ["option", "perp"]},
          {"currency": "DOGE", "instrument_types": ["perp"]},
          {"currency": "USDC", "instrument_types": ["erc20"], "protocol_asset_addresses": {"option": None}}]
    # V3: no instrument_types; an `option` object marks a coin with options
    v3 = [{"currency": "ETH", "option": {"name": "ETH-OPTION"}, "perp": {"name": "ETH-PERP"}, "spot": []},
          {"currency": "DOGE", "perp": {"name": "DOGE-PERP"}, "spot": []},
          {"currency": "BTC", "option": {"name": "BTC-OPTION"}, "perp": None, "spot": []}]
    assert record_once.option_currencies(v2) == ["BTC"]
    assert record_once.option_currencies(v3) == ["BTC", "ETH"]


def test_discovery_never_saves_an_empty_universe(tmp_path, monkeypatch):
    def handler(request):
        return httpx.Response(200, json={"result": [{"currency": "DOGE", "perp": {}, "spot": []}]})

    real = DeriveClient
    monkeypatch.setattr("derive.client.DeriveClient",
                        lambda base, **kw: real(base, transport=httpx.MockTransport(handler), retries=0))
    (tmp_path / "universe.json").write_text(json.dumps({"at": 0, "underlyings": ["BTC"]}))
    with pytest.raises(ValueError):
        asyncio.run(record_once.discover(Settings(sources=["v3_mainnet"]), tmp_path, 10_000))
    assert json.loads((tmp_path / "universe.json").read_text())["underlyings"] == ["BTC"]


def test_v3_mainnet_continues_the_mainnet_directory(tmp_path):
    assert store_dir("v2_mainnet") == store_dir("v3_mainnet") == "v2_mainnet"
    assert store_dir("v3_testnet") == "v3_testnet"
    store = FileStore(tmp_path)
    store.write_snapshot(1_791_000_000, "v3_mainnet", "BTC", {"atm_iv_30d": 0.34}, [], chain={"options": {}, "perp": None})
    latest = json.loads((tmp_path / "v2_mainnet" / "BTC" / "latest.json").read_text())
    assert latest["source"] == "v3_mainnet"  # provenance kept
    assert not (tmp_path / "v3_mainnet").exists()
    assert [p.parent.parent.parent.parent.name for _, p in kept_chains(tmp_path, "v3_mainnet", "BTC", 0)] == ["v2_mainnet"]


def test_two_mainnet_sources_are_refused():
    with pytest.raises(ValueError, match="same directory"):
        Settings(sources=["v2_mainnet", "v3_mainnet"])
    assert Settings(sources=["v2_mainnet", "v3_testnet"]).sources == ["v2_mainnet", "v3_testnet"]


def test_reverted_reads_both_status_fields():
    assert flow.reverted({"tx_status": "reverted"})
    assert flow.reverted({"batch_status": "SettlingError"})
    assert not flow.reverted({"batch_status": "Settled"})
    assert not flow.reverted({"batch_status": None})
    assert not flow.reverted({"tx_status": "settled"})
    leg = {"trade_id": "t", "instrument_name": "BTC-PERP", "timestamp": 1_791_000_000_000, "trade_amount": "1",
           "trade_price": "100", "index_price": "100", "direction": "buy", "wallet": "w", "liquidity_role": "taker"}
    assert history.day_rows([leg]) and not history.day_rows([{**leg, "batch_status": "ExecutingError"}])


def v2_lookup(owners, calls, fail=()):
    """V2's get_trade_history filtered by subaccount: one leg naming its wallet."""
    def handler(request):
        sub = json.loads(request.content)["subaccount_id"]
        calls.append(sub)
        if sub in fail:
            return httpx.Response(400, json={"error": {"code": 10000, "message": "down"}})
        trades = [{"subaccount_id": sub, "wallet": owners[sub]}] if sub in owners else []
        return httpx.Response(200, json={"result": {"trades": trades, "pagination": {"num_pages": 1, "count": len(trades)}}})
    return DeriveClient("https://v2/", transport=httpx.MockTransport(handler), retries=0)


def test_wallet_alias_learns_owners_and_keeps_v3_names(tmp_path):
    calls = []
    alias = WalletAlias(tmp_path, client=v2_lookup({1: "0xSCW1", 2: "0xSAME"}, calls, fail={4}))
    legs = [{"subaccount_id": 1, "wallet": "0xEOA1"}, {"subaccount_id": 1, "wallet": "0xEOA1"},
            {"subaccount_id": 2, "wallet": "0xSAME"}, {"subaccount_id": 3, "wallet": "0xNEW"},
            {"subaccount_id": 4, "wallet": "0xEOA4"}]
    asyncio.run(alias.apply(legs))
    # V3 legs keep the owner's wallet as given: it is the canonical name
    assert [t["wallet"] for t in legs] == ["0xEOA1", "0xEOA1", "0xSAME", "0xNEW", "0xEOA4"]
    saved = json.loads((tmp_path / "history" / "wallet_aliases.json").read_text())
    assert saved["version"] == 2
    assert saved["subaccounts"] == {"1": "0xSCW1", "2": "0xSAME", "3": None}  # the failed lookup is not saved
    assert saved["owners"] == {"1": "0xEOA1", "2": "0xSAME", "3": "0xNEW", "4": "0xEOA4"}
    assert sorted(calls) == [1, 2, 3, 4]
    calls.clear()
    again = WalletAlias(tmp_path, client=v2_lookup({4: "0xSCW4"}, calls))
    asyncio.run(again.apply([{"subaccount_id": 1, "wallet": "0xEOA1"}, {"subaccount_id": 4, "wallet": "0xEOA4"},
                             {"subaccount_id": 5, "wallet": "0xEOA1"}]))
    assert calls == [4]  # only what was not known; subaccount 5's owner already has a Derive Wallet


def test_read_exact_applies_the_alias(tmp_path):
    legs = [{"trade_id": "t", "direction": d, "wallet": w, "subaccount_id": s, "timestamp": 5}
            for d, w, s in (("buy", "0xEOA1", 1), ("sell", "0xEOA2", 2))]

    def handler(request):
        return httpx.Response(200, json={"result": {"trades": legs, "pagination": {"num_pages": 1, "count": 2}}})

    async def go():
        client = DeriveClient("https://v3/", transport=httpx.MockTransport(handler), retries=0)
        assert attach(client, "v3_testnet", tmp_path) is None  # testnet names nobody
        assert attach(client, "v3_mainnet", tmp_path) is not None
        client.wallet_alias._client, client.wallet_alias._own = v2_lookup({1: "0xSCW1", 2: "0xSCW2"}, []), True
        try:
            got, exact = await flow.read_exact(client, {}, 0, 10)
        finally:
            await detach(client)
            await client.close()
        return got, exact

    got, exact = asyncio.run(go())
    assert exact and sorted(t["wallet"] for t in got) == ["0xEOA1", "0xEOA2"]
    saved = json.loads((tmp_path / "history" / "wallet_aliases.json").read_text())
    assert saved["subaccounts"] == {"1": "0xSCW1", "2": "0xSCW2"} and saved["owners"] == {"1": "0xEOA1", "2": "0xEOA2"}


def test_settlement_prices_are_merged_not_replaced(tmp_path):
    p = tmp_path / "history" / "settlements" / "BTC.json"
    p.parent.mkdir(parents=True)
    p.write_text(json.dumps({"20260801": 62988.8}))

    def handler(request):  # V3 mainnet lists only its own expiries
        return httpx.Response(200, json={"result": {"expiries": [{"expiry_date": "20261009", "price": "86000"}]}})

    async def go():
        client = DeriveClient("https://v3/", transport=httpx.MockTransport(handler), retries=0)
        try:
            return await history.update_settlements(client, tmp_path, ["BTC"])
        finally:
            await client.close()

    out = asyncio.run(go())
    assert out["BTC"] == {"20260801": 62988.8, "20261009": 86000.0}
    assert json.loads(p.read_text()) == out["BTC"]


def test_every_source_has_a_directory():
    assert all("dir" in v and "base" in v for v in SOURCES.values())


def test_an_empty_variable_means_the_default(monkeypatch):
    monkeypatch.setenv("DERIVE_SNAPSHOT_SOURCES", "")
    assert Settings().sources == ["v2_mainnet"]
    monkeypatch.setenv("DERIVE_SNAPSHOT_SOURCES", "v3_mainnet")
    assert Settings().sources == ["v3_mainnet"]

"""flow.json rules: spot legs out, per-kind caps, and (until perp-only wallets are classed) no perp
activity of wallets without an options class. Market makers never appear."""
import json
from datetime import datetime, timezone

from derive import flow
import publish_site

NOW = int(datetime(2026, 10, 3, 12, tzinfo=timezone.utc).timestamp())
DAY = "2026-10-03"
CLASSES = {"0xMM": {"class": "market_maker"}, "0xDIR": {"class": "directional", "tier": "top"},
           "0xOCC": {"class": "occasional"}}


def _large(ts, name, kind, notional, wallet):
    return [ts * 1000, name, kind, name.split("-")[0], "buy", 1, 1, 1, notional, 0, wallet, 1, 0, 0]


def _data(tmp_path, large, wallets):
    (tmp_path / "history").mkdir()
    (tmp_path / "history" / "wallets.json").write_text(json.dumps({"wallets": CLASSES}))
    for directory, fields, rows in (("large", flow.LARGE_FIELDS, large),
                                    ("wallets_v2", ("bucket_ts", *flow.WALLET_FIELDS[1:]), wallets)):
        p = tmp_path / "flow" / directory / f"{DAY}.csv"
        p.parent.mkdir(parents=True)
        p.write_text(flow._csv_text(fields, rows))
    return tmp_path


def test_spot_legs_add_nothing_to_wallets_or_large():
    leg = {"trade_id": "s", "timestamp": NOW * 1000, "instrument_name": "LBTC-USDC", "direction": "buy",
           "trade_amount": "100", "trade_price": "90000", "index_price": "90000", "wallet": "0xA",
           "subaccount_id": 1, "liquidity_role": "taker", "realized_pnl": "500", "trade_fee": "3"}
    assert flow.kind_of(leg["instrument_name"]) == "other"
    assert flow.summarise([leg], NOW) == ([], [])


def test_perps_keep_their_own_cap_beside_larger_options(tmp_path):
    t = NOW - 7200
    # Separate option trades a minute apart, each with its premium; options are kept by money, perps by notional.
    large = [_large(t + 60 * i, "BTC-20261030-90000-C", "option", 1_000_000 + i, "0xDIR") for i in range(100)]
    for i, row in enumerate(large):
        row[9] = 100 * (i % 50) + i  # premium: not in notional order
    large += [_large(t + i, "BTC-PERP", "perp", 30_000 + i, "0xDIR") for i in range(50)]
    doc = publish_site.flow_block(_data(tmp_path, large, []), NOW, sides={"_coverage": {}})
    kinds = [r["kind"] for r in doc["large"]]
    assert kinds.count("option") == 80 and kinds.count("perp") == 40
    assert min(r["notional_usd"] for r in doc["large"] if r["kind"] == "perp") == 30_010
    kept = sorted(r["premium_usd"] for r in doc["large"] if r["kind"] == "option")
    assert kept == sorted(row[9] for row in large if row[2] == "option")[-80:]


def test_a_kept_option_leg_brings_its_package(tmp_path):
    t = NOW - 7200
    large = [_large(t + 60 * i, "BTC-20261030-90000-C", "option", 1_000_000, "0xDIR") for i in range(85)]
    for i, row in enumerate(large):
        row[9] = 5_000 + i
    cheap = _large(t + 84 * 60, "BTC-20261030-95000-C", "option", 50_000, "0xDIR")  # the sold leg of the top spread
    cheap[4], cheap[9] = "sell", 10
    doc = publish_site.flow_block(_data(tmp_path, large + [cheap], []), NOW, sides={"_coverage": {}})
    names = [r["instrument"] for r in doc["large"] if r["kind"] == "option"]
    assert len(names) == 81 and "BTC-20261030-95000-C" in names


def test_unclassed_wallets_show_no_perp_activity_and_market_makers_never_appear(tmp_path):
    t = NOW - 3600
    bucket = t // 900 * 900
    large = [_large(t, "ETH-PERP", "perp", 5_000_000, "0xPERPONLY"),
             _large(t, "ETH-20261030-3000-C", "option", 400_000, "0xNEW"),
             _large(t, "ETH-PERP", "perp", 900_000, "0xMM"),
             _large(t, "ETH-20261030-3000-C", "option", 900_000, "0xMM"),
             _large(t, "ETH-PERP", "perp", 60_000, "0xOCC")]
    wallets = [[bucket, "0xPERPONLY", 40, 30_000_000, 0, 0, 0, -900, 50],
               [bucket, "0xNEW", 2, 0, 400_000, 8_000, 0, 0, 3],
               [bucket, "0xMIX", 5, 2_000_000, 100_000, 2_000, 0, 700, 9],
               [bucket, "0xMM", 900, 50_000_000, 9_000_000, 1, 1, 1, 1],
               [bucket, "0xOCC", 3, 60_000, 0, 0, 0, 12, 1]]
    doc = publish_site.flow_block(_data(tmp_path, large, wallets), NOW, sides={"_coverage": {}})
    text = json.dumps(doc)
    assert "0xMM" not in text  # options market makers: never shown
    assert "0xPERPONLY" not in text  # no options class: its perp rows and notional stay out
    by = {w["wallet"]: w for w in doc["wallets"]}
    assert all(w["perp_notional_usd"] == 0 for a, w in by.items() if a not in CLASSES)
    assert by["0xNEW"]["option_notional_usd"] == 400_000 and by["0xNEW"]["realized_pnl_usd"] == 0
    # A bucket that mixed perp and option trades keeps only its option figures.
    assert by["0xMIX"]["option_notional_usd"] == 100_000 and by["0xMIX"]["realized_pnl_usd"] is None
    assert by["0xOCC"]["perp_notional_usd"] == 60_000  # classed wallets keep their perps
    rows = {(r["wallet"], r["kind"]) for r in doc["large"]}
    assert rows == {("0xNEW", "option"), ("0xOCC", "perp")}

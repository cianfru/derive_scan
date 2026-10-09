"""The live service re-prices published Saloon boards with the feed's own pricing."""
import gzip
import json
from pathlib import Path

from derive import questions as Q
from live.reprice import board_names, index_doc, index_of, level_names, reprice

FIX = Path(__file__).parent / "fixtures" / "chain_btc_eth_20261003_14.json.gz"
BTC_SPEC = {"tick": 1.0, "min": 0.01, "step": 0.00001, "taker": 0.0003, "base": 0.5, "cap": 0.125}


def snaps():
    return {int(k): v for k, v in json.load(gzip.open(FIX, "rt"))["snapshots"].items()}


def published(chain, ts):
    """A board as the feed publishes it, with the dates forced onto the board."""
    state = {}
    Q.step("BTC", chain["BTC"], ts, BTC_SPEC, state)
    for ds in state["dates"].values():
        ds["shown"] = True
    b = Q.step("BTC", chain["BTC"], ts, BTC_SPEC, state)
    return {"und": "BTC", "prices_ts": ts, "index": b["index"], "thin": False, "spec": BTC_SPEC, "dates": b["dates"]}


def test_level_names_are_the_four_legs():
    assert level_names("XRP", "20261030", "XRP-20261030-A-1_3-1_45") == [
        "XRP-20261030-1_3-C", "XRP-20261030-1_3-P", "XRP-20261030-1_45-C", "XRP-20261030-1_45-P"]
    assert level_names("BTC", "20261030", "nonsense") == []


def test_same_tickers_give_the_published_prices():
    s = snaps()
    t0 = min(s)
    board = published(s[t0], t0)
    assert board["dates"] and board_names(board)
    live = reprice(board, s[t0]["BTC"]["options"], float(s[t0]["BTC"]["perp"]["I"]), t0 + 5)
    for d0, d1 in zip(board["dates"], live["dates"]):
        for a, b in zip(d0["levels"], d1["levels"]):
            assert a["id"] == b["id"] and a["fair"] == b["fair"] and a["state"] == b["state"]
            for side in ("yes", "no"):
                assert (a[side] or {}).get("buy") == (b[side] or {}).get("buy")
    assert live["prices_ts"] == t0 + 5 and live["live"] is True


def test_later_tickers_give_the_later_prices():
    s = snaps()
    t0, t1 = sorted(s)[0], sorted(s)[-1]
    board = published(s[t0], t0)
    later = s[t1]["BTC"]
    idx = float(later["perp"]["I"])
    live = reprice(board, later["options"], idx, t1)
    exs = Q.expiries(later["options"])
    checked = 0
    for d in live["dates"]:
        for lv in d["levels"]:
            if lv["state"] not in ("open", "tail") or d["expiry"] not in exs:
                continue
            p = Q.price_level(exs[d["expiry"]], lv["lo"], lv["hi"], idx, BTC_SPEC)
            if p is None:
                continue
            assert lv["fair"] == (None if p["fair"] is None else round(p["fair"], 4))
            if p["yes"]:
                assert lv["yes"]["buy"] == round(p["yes"]["buy"], 4)
            checked += 1
    assert checked > 5


def test_missing_quotes_and_kept_states():
    s = snaps()
    t0 = min(s)
    board = published(s[t0], t0)
    lv = board["dates"][0]["levels"][0]
    lv["state"] = "settling"
    lv["yes"] = {"state": "settling", "smart": {"long": 2}}
    live = reprice(board, {}, 80000.0, t0 + 5)  # no tickers: every level kept as published
    assert live["dates"][0]["levels"][0] == lv
    assert reprice(board, s[t0]["BTC"]["options"], None, t0) is not board  # no index: published copy


def test_smart_annotation_survives_repricing():
    s = snaps()
    t0 = min(s)
    board = published(s[t0], t0)
    target = next(l for d in board["dates"] for l in d["levels"] if l["state"] == "open" and l["yes"].get("buy"))
    target["yes"]["smart"] = {"long": 3, "short": 1}
    live = reprice(board, s[t0]["BTC"]["options"], float(s[t0]["BTC"]["perp"]["I"]), t0)
    again = next(l for d in live["dates"] for l in d["levels"] if l["id"] == target["id"])
    assert again["yes"]["smart"] == {"long": 3, "short": 1}


def test_index_and_lease_kept():
    pub = {"prices_ts": 100, "trading": "on", "trading_mainnet": "on", "trading_issued_at": 90, "trading_valid_until": 990,
           "coins": [{"und": "BTC", "index": 1.0}, {"und": "ETH", "index": 2.0}]}
    out = index_doc(pub, {"BTC": {"index": 5.0, "live": True}}, 200)
    assert out["prices_ts"] == 200 and out["coins"][0]["index"] == 5.0 and out["coins"][1]["index"] == 2.0
    assert out["trading_valid_until"] == 990 and out["trading_mainnet"] == "on"
    assert index_doc(pub, {}, 200)["prices_ts"] == 100
    assert index_of("BTC", {"BTC-1-2-C": {"I": "10", "t": 1}, "BTC-1-3-C": {"I": "11", "t": 2}, "ETH-1-2-C": {"I": "9", "t": 3}}) == 11.0

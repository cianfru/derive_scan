import json

import publish_site as P

T = 1_790_000_000


def _level(lo, hi):
    return {"lo": lo, "hi": hi, "yes": {"state": "open", "buy": 0.5}, "no": {"state": "open", "buy": 0.5}}


def test_marks_need_two_wallets_and_the_floor():
    lv = _level(84_000, 86_000)
    one = [("0xa", "BTC", T, 85_000, 30_000)]
    assert P.smart_marks(lv, T, one, "BTC") == {}
    small = [("0xa", "BTC", T, 85_000, 3_000), ("0xb", "BTC", T, 84_000, 3_000)]
    assert P.smart_marks(lv, T, small, "BTC") == {}
    assert P.smart_marks(lv, T, small, "HYPE") == {}  # other coin: legs are BTC's
    legs = [("0xa", "BTC", T, 85_000, 8_000), ("0xb", "BTC", T, 86_000, 4_000),
            ("0xc", "BTC", T, 90_000, -50_000),  # outside the zone
            ("0xd", "BTC", T + 86400, 85_000, -50_000)]  # another date
    assert P.smart_marks(lv, T, legs, "BTC") == {"yes": {"delta_usd": 12_000, "wallets": 2}}
    short = [("0xa", "ETH", T, 2_500, -1_500), ("0xb", "ETH", T, 2_550, -9_000)]
    assert P.smart_marks(_level(2_450, 2_550), T, short, "ETH") == {"no": {"delta_usd": -10_500, "wallets": 2}}
    # Wallets count, not money: one large short does not outweigh two longs, and a tie marks nothing.
    tie = [("0xa", "BTC", T, 85_000, 6_000), ("0xb", "BTC", T, 85_000, 6_000), ("0xc", "BTC", T, 85_000, -900_000), ("0xd", "BTC", T, 85_000, -2_000)]
    assert P.smart_marks(lv, T, tie, "BTC") == {} and {k: v for k, v in P.level_smart_wallets(lv, T, tie, "BTC").items() if k != "wallets"} == {"long": 2, "short": 2}
    assert P.smart_marks(lv, T, tie[:3], "BTC") == {"yes": {"delta_usd": 12_000, "wallets": 2}}


def test_annotate_writes_answers_and_counts(tmp_path):
    q = tmp_path / "questions"
    q.mkdir()
    board = {"und": "BTC", "dates": [{"settle_ts": T, "board": True, "levels": [_level(84_000, 86_000), _level(90_000, 92_000)]},
                                     {"settle_ts": T + 86400, "levels": [_level(84_000, 86_000)]}]}  # not on the board: marked, not counted
    for d in board["dates"]:
        for lv in d["levels"]:
            lv["ladder"] = 7
    board["dates"][0]["levels"][1]["no"]["smart"] = {"delta_usd": -1, "wallets": 9}  # stale mark is cleared
    (q / "BTC.json").write_text(json.dumps(board))
    (q / "index.json").write_text(json.dumps({"coins": [{"und": "BTC"}]}))
    P.annotate_smart(tmp_path, [("0xa", "BTC", T, 85_000, 8_000), ("0xb", "BTC", T, 85_000, 4_000),
                                ("0xa", "BTC", T + 86400, 85_000, 8_000), ("0xb", "BTC", T + 86400, 85_000, 4_000)])
    out = json.loads((q / "BTC.json").read_text())
    a, b = out["dates"][0]["levels"]
    assert out["dates"][1]["levels"][0]["yes"]["smart"]["wallets"] == 2
    assert a["yes"]["smart"] == {"delta_usd": 12_000, "wallets": 2} and "smart" not in a["no"]
    assert "smart" not in b["no"]
    assert json.loads((q / "index.json").read_text())["coins"][0]["smart"] == 1


def test_date_traders_counts_wallets_long_and_short_on_one_settlement():
    exp = 1_791_532_800  # 9 Oct 2026, 08:00 UTC
    now = exp - 2 * 86400
    strikes = {"ts": now, "expiries": {str(exp): [[86000, 0, 0, 0.5, 0.5, 0.4]], str(exp + 7 * 86400): [[86000, 0, 0, 0.5, 0.5, 0.4]]}}
    name, other = "BTC-20261009-86000-C", "BTC-20261016-86000-C"
    # Delta 0.4 on an index of 84,000: one contract is $33,600 of delta.
    book = {name: [[0, 1.0], [1, 0.5], [2, -0.2], [3, 0.01]], other: [[4, -9.0]]}  # wallet 3 is dust; 4 is another date
    r = P.date_traders(book, (strikes, 84000, now), exp, now)
    assert (r["long"], r["short"]) == (2, 1) and r["status"] == "ready"
    assert r["score"] == round((1.5 - 0.2) / 1.7, 3) and r["state"] == "up"
    # One trader alone never paints a date.
    one = P.date_traders({name: [[0, 5.0]]}, (strikes, 84000, now), exp, now)
    assert (one["long"], one["short"], one["state"], one["status"]) == (1, 0, None, "too_few_wallets")
    assert P.date_traders(None, (strikes, 84000, now), exp, now) is None
    assert P.date_traders(book, None, exp, now) is None


def test_level_counts_smart_wallets_in_the_zone():
    lv = _level(84_000, 86_000)
    legs = [("0xa", "BTC", T, 85_000, 8_000), ("0xa", "BTC", T, 84_000, -2_000), ("0xb", "BTC", T, 86_000, -4_000),
            ("0xc", "BTC", T, 85_000, 500), ("0xd", "BTC", T, 90_000, 9_000), ("0xe", "BTC", T + 86400, 85_000, 9_000)]
    who = {"0xa": {"option_pnl": 84_210.5, "rank": 12}}
    assert P.level_smart_wallets(lv, T, legs, "BTC", who) == {"long": 1, "short": 1, "wallets": [
        {"address": "0xa", "side": "long", "delta_usd": 6_000, "option_pnl": 84_210.5, "rank": 12},
        {"address": "0xb", "side": "short", "delta_usd": -4_000, "option_pnl": None, "rank": None}]}
    assert P.level_smart_wallets(lv, T, legs[3:], "BTC") is None

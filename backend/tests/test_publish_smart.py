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


def test_date_traders_reads_one_settlement_of_directional_wallets():
    exp = 1_791_532_800  # 9 Oct 2026, 08:00 UTC
    now = exp - 2 * 86400
    later = exp + 7 * 86400
    strikes = {"ts": now, "expiries": {str(exp): [[86000, 0, 0, 0.5, 0.5, 0.4]], str(later): [[86000, 0, 0, 0.5, 0.5, 0.4]]}}
    name, other = "BTC-20261009-86000-C", "BTC-20261016-86000-C"
    # Net long 2 calls (delta 0.4) over 4 positions; the next week's date is left out of this one.
    positions = {name: {"top": [1.0, 1, 1.0], P.DIRECTIONAL: [2.0, 4, 4.0]}, other: {P.DIRECTIONAL: [-9.0, 3, 9.0]}}
    r = P.date_traders(positions, (strikes, 84000, now), exp, now)
    assert r["positions"] == 4 and r["state"] == "up" and r["score"] == 0.5
    assert r["net_delta_usd"] == round(2 * 0.4 * 84000, 2) and r["gross_delta_usd"] == round(4 * 0.4 * 84000, 2)
    # Before the history has the directional bucket, nothing is published.
    assert P.date_traders({name: {"top": [1.0, 1, 1.0]}}, (strikes, 84000, now), exp, now) is None
    assert P.date_traders(positions, None, exp, now) is None

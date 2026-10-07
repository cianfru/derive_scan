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

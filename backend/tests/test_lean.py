from derive.lean import options_lean

HIST = [[i * 900, 0.5, 0.45, 0.5, -0.02 + 0.0001 * i, 0, 0.4] for i in range(800)]


def test_defensive_when_puts_are_rich_and_bought():
    out = options_lean({"rr25_30d": -0.03, "pc_oi_ratio": 0.5, "atm_iv_7d": 0.55, "atm_iv_30d": 0.45}, HIST,
                       {"call": {"buy_premium_usd": 1000}, "put": {"buy_premium_usd": 9000}})
    assert out["state"] == "defensive" and all(v < 0 for v in out["parts"].values())


def test_leaning_up_and_needs_two_readings():
    up = options_lean({"rr25_30d": 0.1, "pc_oi_ratio": 0.3, "atm_iv_7d": 0.4, "atm_iv_30d": 0.45}, HIST,
                      {"call": {"buy_premium_usd": 9000}, "put": {"sell_premium_usd": 1000}})
    assert up["state"] == "up" and up["parts"]["term"] == 0
    thin = options_lean({"atm_iv_7d": 0.4, "atm_iv_30d": 0.45}, [], None)
    assert thin["state"] is None and thin["parts"]["skew"] is None

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


def test_alignment_by_horizon():
    from datetime import datetime, timezone

    from derive.history import parse_option
    from derive.lean import alignment

    now = 1_900_000_000

    def name(e, k, cp):
        return f"BTC-{datetime.fromtimestamp(e, timezone.utc).strftime('%Y%m%d')}-{k}-{cp}"

    exp7, exp30 = now + 5 * 86400, now + 20 * 86400
    e7, e30 = parse_option(name(exp7, 90000, "C"))[1], parse_option(name(exp30, 80000, "P"))[1]  # 08:00 UTC
    positions = {name(exp7, 90000, "C"): {"smart": [5.0, 4]}, name(exp30, 80000, "P"): {"smart": [20.0, 6]}}
    strikes = {"expiries": {str(e7): [[90000, 0, 0, 0.5, 0.5, 0.4]], str(e30): [[80000, 0, 0, 0.5, 0.5, 0.8]]}}
    feats = {"rr25_7d": 0.02, "rr25_30d": -0.03, "atm_iv_7d": 0.4, "atm_iv_30d": 0.45, "pc_oi_ratio": 0.5}
    flows = {"24h": {"call": {"buy_premium_usd": 9000}}, "7d": {"put": {"buy_premium_usd": 9000}}}
    out = alignment("LIGHT_LONG", "RISK_OFF", feats, [], flows, positions, strikes, 85000, now)
    h7, h30 = out["horizons"]["7d"], out["horizons"]["30d"]
    assert h7["engine"]["state"] == "up" and h7["options"]["state"] == "up" and h7["wallets"]["state"] == "up"
    assert h7["aligned"] == "up"
    # 30 days: the 7-day calls count too; puts held are short delta, so wallets lean defensive
    assert h30["engine"]["state"] == "defensive" and h30["wallets"]["state"] == "defensive"
    assert out["score"] >= 3

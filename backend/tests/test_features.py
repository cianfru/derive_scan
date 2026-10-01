import math

import pytest

from derive.features import (ExpirySlice, OptionQuote, constant_maturity, constant_maturity_iv, expiry_slice,
                             interp, quote_from_ticker, surface_features)


def q(strike, kind, iv, delta, fwd=100.0, oi=1.0):
    return OptionQuote(f"X-{strike}-{kind}", strike, kind, iv, delta, fwd, oi, 99.0)


def test_interp_no_extrapolation():
    pts = [(0.0, 1.0), (1.0, 3.0)]
    assert interp(pts, 0.5) == 2.0
    assert interp(pts, 1.5) is None
    assert interp([(0.2, 5.0)], 0.2) == 5.0
    assert interp([(0.2, 5.0)], 0.3) is None
    assert interp([], 0.0) is None


def test_atm_uses_otm_options_in_log_moneyness():
    # Forward 100. OTM put at 90 (iv .60) and OTM call at 110 (iv .50). ITM ones carry junk IVs.
    quotes = [q(90, "P", 0.60, -0.3), q(110, "C", 0.50, 0.3), q(90, "C", 9.9, 0.7), q(110, "P", 9.9, -0.7)]
    s = expiry_slice(expiry=86400 * 30, now=0, quotes=quotes)
    x0, x1 = math.log(0.9), math.log(1.1)
    expected = 0.60 + (0.50 - 0.60) * (0 - x0) / (x1 - x0)
    assert s.atm_iv == pytest.approx(expected)
    assert s.tenor_days == pytest.approx(30)


def test_rr_and_bf():
    quotes = [q(100, "C", 0.50, 0.5), q(100, "P", 0.50, -0.5),
              q(120, "C", 0.48, 0.30), q(130, "C", 0.52, 0.20),
              q(80, "P", 0.66, -0.30), q(70, "P", 0.70, -0.20)]
    s = expiry_slice(86400 * 30, 0, quotes)
    assert s.iv_c25 == pytest.approx(0.50)
    assert s.iv_p25 == pytest.approx(0.68)
    assert s.rr25 == pytest.approx(-0.18)
    assert s.bf25 == pytest.approx(0.59 - s.atm_iv)
    assert s.atm_iv == pytest.approx(0.50)
    assert (s.call_oi, s.put_oi, s.n_options) == (3, 3, 6)


def test_missing_wings_give_none():
    s = expiry_slice(86400, 0, [q(100, "C", 0.5, 0.5), q(100, "P", 0.5, -0.5)])
    assert s.rr25 is None and s.bf25 is None


def _slice(days, atm, rr=None):
    return ExpirySlice(int(days * 86400), days, 100, atm, None, None, rr, None, 1, 1, 2)


def test_constant_maturity_total_variance():
    slices = [_slice(10, 0.40), _slice(40, 0.60)]
    w = 0.40 ** 2 * 10 + (0.60 ** 2 * 40 - 0.40 ** 2 * 10) * (30 - 10) / 30
    assert constant_maturity_iv(slices, 30) == pytest.approx(math.sqrt(w / 30))
    assert constant_maturity_iv(slices, 7) is None
    assert constant_maturity_iv(slices, 90) is None


def test_constant_maturity_linear_rr():
    assert constant_maturity([_slice(10, 0.4, -0.02), _slice(40, 0.6, 0.04)], "rr25", 30) == pytest.approx(0.02)


def test_quote_from_compact_ticker():
    t = {"I": "2685.4", "stats": {"oi": "12.5"},
         "option_pricing": {"d": "-0.46742", "i": "0.54088", "f": "2805.9"}}
    o = quote_from_ticker("ETH-20261030-1500-P", 1500, "P", t)
    assert (o.iv, o.delta, o.forward, o.oi, o.index) == (0.54088, -0.46742, 2805.9, 12.5, 2685.4)
    assert quote_from_ticker("x", 1, "C", {"option_pricing": {"i": "0"}}).iv is None
    assert quote_from_ticker("x", 1, "C", {}).iv is None


def test_surface_features_with_perp():
    slices = [_slice(5, 0.5), _slice(35, 0.5), _slice(100, 0.5)]
    slices[0].put_oi = 3
    perp = {"f": "0.00001", "M": "101", "I": "100", "stats": {"oi": "7"}}
    f = surface_features(slices, 100.0, perp)
    assert f["atm_iv_30d"] == pytest.approx(0.5)
    assert f["pc_oi_ratio"] == pytest.approx(5 / 3)
    assert f["funding_ann"] == pytest.approx(0.00001 * 8760)
    assert f["perp_basis"] == pytest.approx(0.01)
    assert "rr25_30d" not in f

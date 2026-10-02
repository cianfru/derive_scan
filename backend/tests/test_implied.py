import math

from derive.implied import implied_by_expiry, lognormal_quantiles, smile_quantiles

F, T = 100.0, 30 / 365


def test_flat_smile_matches_lognormal():
    rows = [[k, 0, 0, 0.5, 0.5] for k in range(50, 201, 5)]
    q = smile_quantiles(rows, F, T)
    ln = lognormal_quantiles(F, T, 0.5)
    assert all(math.isclose(a, b, rel_tol=0.01) for a, b in zip(q, ln))
    assert q == sorted(q) and q[0] < F < q[4]


def test_put_skew_widens_the_downside():
    rows = [[k, 0, 0, 0.5, 0.5 + max(0, (100 - k) / 100)] for k in range(50, 201, 5)]
    q, ln = smile_quantiles(rows, F, T), lognormal_quantiles(F, T, 0.5)
    assert F - q[0] > F - ln[0]


def test_thin_quotes_fall_back_to_atm():
    out = implied_by_expiry({"expiries": {"1000000": [[100, 0, 0, 0.5, 0.5]]}},
                            [{"expiry": 1_000_000, "forward": 100, "atm_iv": 0.5}], ts=1_000_000 - 10 * 86400)
    assert out[0]["method"] == "atm" and out[0]["days"] == 10

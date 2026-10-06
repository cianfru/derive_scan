import numpy as np

from derive.band import band_since

DAY, WEEK = 86_400_000, 604_800_000
START = 1_704_067_200_000  # Mon 1 Jan 2024 00:00 UTC


def bars(ts, close):
    close = np.asarray(close, dtype=np.float64)
    return {"timestamp": np.asarray(ts, dtype=np.float64), "open": close, "high": close * 1.01,
            "low": close * 0.99, "close": close, "volume": np.ones(len(close))}


def test_band_since_finds_the_day_price_crossed_the_weekly_band():
    days = 30 * 7
    daily_close = [100.0] * (days - 80) + [90.0] * 60 + [130.0] * 20  # below the band, then above for 20 days
    daily = bars([START + i * DAY for i in range(days)], daily_close)
    weekly = bars([START + w * WEEK for w in range(30)], [daily_close[w * 7 + 6] for w in range(30)])
    band = band_since(daily, weekly, START + days * DAY)
    assert band["side"] == "above" and band["days"] == 20 and not band["open"]
    assert band["since"] == (START + (days - 20) * DAY) // 1000


def test_band_since_needs_enough_weeks():
    daily = bars([START + i * DAY for i in range(70)], [100.0] * 70)
    weekly = bars([START + w * WEEK for w in range(10)], [100.0] * 10)
    assert band_since(daily, weekly) is None

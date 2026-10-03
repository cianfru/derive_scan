"""Daily option readings rebuilt from traded options (derive/surface_history.py, history_once.py)."""
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

import history_once
from derive import history
from derive import surface_history as sh
from derive.implied import black76_call

FIX = Path(__file__).parent / "fixtures"
DAY = "2024-06-03"
S, CARRY = 50_000.0, 0.08
ATM, SKEW, CURV = 0.55, -0.02, 0.008      # Derive's convention: flat in tenor
T0 = datetime.fromisoformat(DAY).replace(tzinfo=timezone.utc).timestamp() + 43200
EXPIRY_DAYS = (4, 6, 9, 12, 16, 22, 30, 37, 45, 60, 75, 95, 120, 150)


def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def true_iv(K, T):
    F = S * math.exp(CARRY * T)
    m = math.log(K / F) / (ATM * math.sqrt(T))
    return ATM + SKEW * m + CURV * m * m


def true_rr25(tenor):
    """25-delta call minus put IV of the true smile (forward delta, solved by bisection)."""
    T = tenor / 365
    F = S * math.exp(CARRY * T)

    def strike(target):
        lo, hi = F * 0.3, F * 3.0
        for _ in range(100):
            K = (lo + hi) / 2
            s = true_iv(K, T) * math.sqrt(T)
            d = _ncdf((math.log(F / K) + 0.5 * s * s) / s)
            lo, hi = (K, hi) if d > target else (lo, K)
        return (lo + hi) / 2

    return true_iv(strike(0.25), T) - true_iv(strike(0.75), T)


def chain(expiry_days=EXPIRY_DAYS, keep=lambda K, F, cp: True):
    """History rows for one day: every strike's call and put priced by Derive's convention
    (discounted Black-76 on the forward) and stored as the history does (Black-76 on the index)."""
    rows = [{"instrument": "BTC-PERP", "buy_contracts": 2, "sell_contracts": 0, "delta_usd": 2 * S}]
    truth = {}
    for n in expiry_days:
        exp = datetime.fromisoformat(DAY).replace(tzinfo=timezone.utc) + timedelta(days=n)
        T = (exp.replace(hour=8).timestamp() - T0) / sh.YEAR
        F = S * math.exp(CARRY * T)
        for z in np.arange(-2.0, 2.01, 0.25):
            K = float(round(F * math.exp(z * ATM * math.sqrt(T)) / 100) * 100)
            for cp in ("C", "P"):
                if not keep(K, F, cp):
                    continue
                iv = true_iv(K, T)
                price = math.exp(-CARRY * T) * (black76_call(F, K, T, iv) - (0 if cp == "C" else F - K))
                iv_h = history.implied_vol(price, S, K, T, cp)
                if not iv_h:
                    continue
                name = f"BTC-{exp:%Y%m%d}-{int(K)}-{cp}"
                rows.append({"instrument": name, "buy_contracts": 1 + abs(z), "sell_contracts": 0, "iv": iv_h})
                truth[name] = (K, T, cp, iv, iv_h)
    return rows, truth


def test_carry_is_recovered_from_call_put_pairs():
    rows, _ = chain()
    e = sh.instrument_points(rows, "BTC")
    assert e["perp"] == [2 * S, 2.0]
    cd, pairs = sh.carry_pairs(sh.option_points(DAY, S, e["opt"]))
    assert pairs >= 20
    assert abs(cd - CARRY) < 0.005


def test_history_ivs_convert_back_to_derive_marks():
    rows, truth = chain()
    K, T, cp, iv, iv_h = map(np.array, zip(*truth.values()))
    call = cp == "C"
    # the history's convention is off by about K*c*T/vega: calls read high, puts low
    at30 = np.abs(T * 365 - 30) < 1
    assert (iv_h[at30 & call] - iv[at30 & call]).max() > 0.005 and (iv_h[at30 & ~call] - iv[at30 & ~call]).min() < -0.005
    back = sh.to_derive(S, K.astype(float), T.astype(float), iv_h.astype(float), call, CARRY)
    ok = np.isfinite(back)
    assert ok.mean() > 0.95
    assert np.abs(back[ok] - iv[ok]).max() < 1e-4


def test_atm_and_rr25_are_recovered_within_a_third_of_a_vol_point():
    rows, _ = chain()
    e = sh.instrument_points(rows, "BTC")
    row = sh.day_values(DAY, S, e["opt"], [CARRY, CARRY])
    assert abs(row["carry"] - CARRY) < 0.005
    for t in (7, 30, 90):
        assert abs(row[f"atm{t}"] - ATM) < 0.003, t
        assert row[f"n{t}"] >= 10
    for t in (7, 30):
        assert abs(row[f"rr{t}"] - true_rr25(t)) < 0.003, t
    assert true_rr25(30) < -0.02  # the test smile has a real skew
    # both instrument halves give a reading too
    assert abs(row["atm30_a"] - ATM) < 0.005 and abs(row["atm30_b"] - ATM) < 0.005


def test_no_reading_when_trades_sit_on_one_side_of_the_money_or_the_tenor():
    rows, _ = chain(keep=lambda K, F, cp: K >= F)  # calls out of the money, puts in it: one side only
    e = sh.instrument_points(rows, "BTC")
    row = sh.day_values(DAY, S, e["opt"], [CARRY] * 3)
    assert row["atm7"] is None and row["atm30"] is None and row["atm90"] is None and row["rr30"] is None
    rows, _ = chain(expiry_days=(45, 52, 60))  # all beyond 30 days, none within 25% of it
    e = sh.instrument_points(rows, "BTC")
    row = sh.day_values(DAY, S, e["opt"], [CARRY] * 3)
    assert row["atm30"] is None and row["rr30"] is None and row["atm7"] is None


def test_btc_2_october_regression():
    fx = json.loads((FIX / "surface_btc_2026-10-02.json").read_text())
    rows = [dict(zip(("instrument", "buy_contracts", "sell_contracts", "delta_usd", "iv"), r)) for r in fx["rows"]]
    e = sh.instrument_points(rows, "BTC")
    index = e["perp"][0] / e["perp"][1]
    assert abs(index - 86008) < 1
    row = sh.day_values(fx["day"], index, e["opt"], fx["carry_hist"])
    assert abs(row["carry"] - 0.0529) < 0.0005
    assert abs(row["atm30"] - 0.339) < 0.0005
    assert abs(row["rr30"] - (-0.0036)) < 0.0005
    assert abs(row["atm7"] - 0.3066) < 0.0005 and abs(row["atm90"] - 0.3701) < 0.0005


# ---------- the CSV and the job ----------

def _features(data, und, day, snapshots, atm30=0.5):
    p = data / "v2_mainnet" / und / "features" / f"{day}.csv"
    p.parent.mkdir(parents=True, exist_ok=True)
    start = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
    lines = ["ts,feature,value"]
    for i in range(snapshots):
        lines += [f"{start + 900 * i},atm_iv_30d,{atm30 + i * 1e-4}", f"{start + 900 * i},rr25_30d,-0.01"]
    p.write_text("\n".join(lines) + "\n")


def _days(tmp_path, n=4):
    """n history days of the synthetic chain (as day files), recorded features on the last two."""
    days = []
    for i in range(n):
        day = date(2024, 6, 3) + timedelta(days=i)
        rows, _ = chain()
        cols = history.FIELDS
        history.write_day(tmp_path, day, [[r.get("wallet", "0xA"), r["instrument"],
                                           *(r.get(c, 0) if c != "iv" else r.get("iv", "") for c in cols[2:])] for r in rows])
        days.append(day.isoformat())
    _features(tmp_path, "BTC", days[-2], 50)
    _features(tmp_path, "BTC", days[-1], 96)
    return days


def test_rows_are_appended_once_and_a_resumed_build_is_identical(tmp_path):
    days = _days(tmp_path)
    assert sh.extend(tmp_path, tmp_path / "all", days) == len(days)
    for d in days:
        assert sh.extend(tmp_path, tmp_path / "one", [d]) == 1
    text = (tmp_path / "all" / "BTC.csv").read_text()
    assert (tmp_path / "one" / "BTC.csv").read_text() == text
    assert sh.extend(tmp_path, tmp_path / "all", days) == len(days)  # nothing written twice
    assert (tmp_path / "all" / "BTC.csv").read_text() == text
    rows = sh.read_rows(tmp_path / "all" / "BTC.csv")
    assert [r["day"] for r in rows] == days and rows[0]["index_src"] == "perp" and abs(rows[0]["index"] - S) < 1e-6
    assert rows[-2]["rec_n"] == 50 and rows[-2]["rec_atm30"] is None          # fewer than 72 snapshots
    assert rows[-1]["rec_n"] == 96 and abs(rows[-1]["rec_atm30"] - 0.50475) < 1e-6 and rows[-1]["rec_rr30"] == -0.01
    assert rows[-1]["rec_atm7"] is None
    # stops when told to, after one day
    assert sh.extend(tmp_path, tmp_path / "stop", days, keep_going=lambda: False) == 1


def test_history_job_rebuilds_within_its_budget_then_appends(tmp_path, monkeypatch):
    days = _days(tmp_path)
    state = {"done_through": days[-2], "repaired": history_once.REPAIR}
    history.save_state(tmp_path, state)
    assert history_once.is_due(tmp_path, datetime(2024, 6, 5, 2, tzinfo=timezone.utc).timestamp())
    stop = lambda: False  # noqa: E731  (an exhausted budget: one day per run)
    history_once.surface_step(tmp_path, state, stop)
    assert state["surface_pending"] == days[1:3] and not (tmp_path / "history" / "surface").exists()
    history_once.surface_step(tmp_path, state, stop)
    history_once.surface_step(tmp_path, state, stop)
    saved = history.load_state(tmp_path)
    assert saved["surface"] == history_once.SURFACE_VERSION and saved["surface_through"] == days[2]
    assert "surface_pending" not in saved and not (tmp_path / "history" / "surface_rebuild").exists()
    first = (tmp_path / "history" / "surface" / "BTC.csv").read_text()
    assert [r["day"] for r in sh.read_rows(tmp_path / "history" / "surface" / "BTC.csv")] == days[:3]
    assert not history_once.is_due(tmp_path, datetime(2024, 6, 6, 2, tzinfo=timezone.utc).timestamp())
    # a new day: one row appended, earlier rows unchanged
    state["done_through"] = days[3]
    history.save_state(tmp_path, state)
    assert history_once.is_due(tmp_path, datetime(2024, 6, 7, 2, tzinfo=timezone.utc).timestamp())
    history_once.surface_step(tmp_path, state, stop)
    after = (tmp_path / "history" / "surface" / "BTC.csv").read_text()
    assert after.startswith(first) and after.count("\n") == first.count("\n") + 1
    assert history.load_state(tmp_path)["surface_through"] == days[3]
    sh.extend(tmp_path, tmp_path / "direct", days)
    assert (tmp_path / "direct" / "BTC.csv").read_text() == after
    # a new definition version rebuilds aside and swaps in only when complete
    monkeypatch.setattr(history_once, "SURFACE_VERSION", 2)
    history_once.surface_step(tmp_path, state, stop)
    assert (tmp_path / "history" / "surface_rebuild").exists()
    assert (tmp_path / "history" / "surface" / "BTC.csv").read_text() == after
    for _ in range(3):
        history_once.surface_step(tmp_path, state, stop)
    assert history.load_state(tmp_path)["surface"] == 2
    assert (tmp_path / "history" / "surface" / "BTC.csv").read_text() == after
    assert not (tmp_path / "history" / "surface_rebuild").exists()

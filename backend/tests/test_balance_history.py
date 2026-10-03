"""Smart-wallet delta balance per daily close (derive/balance_history.py, history_once.py, publish_site.radar_block)."""
import asyncio
import gzip
import json
from datetime import date, datetime, timedelta, timezone

import httpx

import history_once
import publish_site
from derive import balance_history as B
from derive import history, lean
from derive.candles import CandleCache
from derive.client import DeriveClient
from derive.config import Settings
from derive.recorder import Recorder, strikes_from_chain
from derive.store import Store

START = date(2024, 1, 1)
E1, E2, E3 = "20240412", "20240531", "20240726"
SETTLE = {"ETH": {E1: 4300.0, E2: 4500.0, E3: 3000.0}}


def _ts(d: date, hour: int = 0) -> int:
    return int(datetime(d.year, d.month, d.day, hour, tzinfo=timezone.utc).timestamp())


def _row(wallet, name, buy=0.0, sell=0.0, bv=0.0, sv=0.0, maker=0, taker=1, delta=0.0, iv="", otm=0.0):
    return [wallet, name, buy, sell, bv, sv, maker, taker, delta, iv, otm, 0, 0]


def _history(root, days=200):
    """Day files with a market maker, an income seller, a hedger and directional wallets; 0xLate
    starts on day 60, so it is directional (90 active days) only from day 149, and profits on E2."""
    for i in range(days):
        d = START + timedelta(days=i)
        rows = []
        if d < date(2024, 7, 26):
            rows.append(_row("0xM", f"ETH-{E3}-3500-C", buy=1, sell=1, bv=40, sv=41, maker=2, taker=0))
        if i % 4 == 0 and d < date(2024, 4, 12):
            rows += [_row("0xA", f"ETH-{E1}-4000-C", buy=1, bv=50, delta=400, iv=0.6),        # wins at E1
                     _row("0xB", f"ETH-{E1}-3000-P", buy=1, bv=40, delta=-300, iv=0.62),      # loses at E1
                     _row("0xS", f"ETH-{E1}-4600-C", sell=1, sv=20, delta=-100, otm=20, iv=0.7),
                     _row("0xH", f"ETH-{E1}-4000-C", buy=1, bv=50, delta=400, iv=0.6),
                     _row("0xH", "ETH-PERP", sell=0.1, delta=-380)]
        if i >= 60 and i % 3 == 0 and d < date(2024, 5, 31):
            rows.append(_row("0xLate", f"ETH-{E2}-4000-C", buy=1, bv=60, delta=450, iv=0.58))
        if i % 10 == 0 and date(2024, 2, 1) <= d < date(2024, 5, 31):
            rows.append(_row("0xA", f"ETH-{E2}-4500-C", buy=1, bv=30, delta=200, iv=0.6))
        if i % 5 == 0 and date(2024, 2, 1) <= d < date(2024, 7, 26):
            rows += [_row("0xA", f"ETH-{E3}-3500-C", buy=2, bv=150, delta=900, iv=0.55),
                     _row("0xLate", f"ETH-{E3}-3200-P", sell=1, sv=90, delta=300, iv=0.57)]
        history.write_day(root, d, rows)


def _candles(root, days=200, price=3500.0):
    CandleCache(root).append("ETH", "1d", [[_ts(START + timedelta(days=i)) * 1000, price, price, price, price, 1]
                                           for i in range(days)])


def _replay_to(root, cutoffs):
    rp, out = B.Replay(SETTLE), {}
    for p in sorted((root / "history" / "days").glob("*.csv.gz")):
        day = p.name[:10]
        rp.add_day(day, history.read_day(p), {})
        if day in cutoffs:
            as_of = B.close_ts(day)
            rp.settle_through(as_of)
            tiers = rp.tiers()
            out[day] = (tiers, rp.open_cells(tiers, as_of))
    return out


def test_replay_tiers_equal_classify_point_in_time(tmp_path):
    _history(tmp_path)
    early, late = (START + timedelta(days=120)).isoformat(), (START + timedelta(days=190)).isoformat()
    got = _replay_to(tmp_path, {early, late})
    for day in (early, late):
        held = {}
        classes = history.classify(tmp_path, SETTLE, B.close_ts(day), held)
        assert got[day][0] == {k: v["tier"] for k, v in classes.items() if v.get("tier")}
        assert got[day][1] == history.tier_positions(held, classes)
    early_tiers, late_tiers = got[early][0], got[late][0]
    assert "0xA" in early_tiers and "0xB" not in early_tiers and "0xLate" not in early_tiers
    assert late_tiers.get("0xLate") in ("top", "smart")  # qualified after the early cutoff, never before
    assert not {"0xM", "0xS", "0xH"} & set(late_tiers)


def test_the_split_classify_keeps_its_rules():
    stats = {"legs": 25, "maker_share": 0.1, "both_sides_share": 0.0, "sold_share": 0.0, "otm_sold_share": 0.0,
             "hedged_days_share": 0.0, "active_days": 100}
    assert history.classify_stats(stats) == "directional"
    assert history.classify_stats(stats | {"active_days": 89}) == "occasional"
    assert history.classify_stats(stats | {"maker_share": 0.61}) == "market_maker"
    assert history.classify_stats(stats | {"sold_share": 0.9, "otm_sold_share": 0.5}) == "income"
    assert history.classify_stats(stats | {"hedged_days_share": 0.51}) == "hedger"
    out = {f"w{i}": {"class": "directional", "option_pnl": 100 - i * 10} for i in range(12)}
    tiers = {k: v["tier"] for k, v in history.rank_tiers(out).items()}
    assert tiers["w0"] == tiers["w1"] == "top" and tiers["w2"] == "smart" and tiers["w10"] is None


def _ticker(iv, delta, index="3000", oi="1"):
    return {"I": index, "stats": {"oi": oi}, "option_pricing": {"i": str(iv), "d": str(delta), "f": index}}


def _chain_file(root, und, ts, options, index="3000"):
    at = datetime.fromtimestamp(ts, timezone.utc)
    p = root / "v2_mainnet" / und / "chains" / at.date().isoformat() / f"{at.hour:02d}.json.gz"
    p.parent.mkdir(parents=True, exist_ok=True)
    doc = {"options": options, "perp": {"I": index}}
    p.write_bytes(gzip.compress(json.dumps(doc).encode()))
    return doc


def test_strikes_from_a_kept_chain_equal_the_live_view(tmp_path):
    exp = 1_000_000 // 3600 * 3600 + 30 * 86400
    exp_date = datetime.fromtimestamp(exp, timezone.utc).strftime("%Y%m%d")
    tickers = {f"ETH-{exp_date}-90-P": _ticker(0.6, -0.2, "100"), f"ETH-{exp_date}-100-P": _ticker(0.5, -0.5, "100"),
               f"ETH-{exp_date}-100-C": _ticker(0.5, 0.5, "100"), f"ETH-{exp_date}-110-C": _ticker(0.45, 0.2, "100"),
               f"ETH-{exp_date}-1_5-C": _ticker(0.45, 0.99, "100")}
    expiry = history.parse_option(f"ETH-{exp_date}-100-C")[1]

    def handler(request):
        method = request.url.path.rsplit("/", 1)[-1]
        p = json.loads(request.content)
        if method == "get_instruments":
            return httpx.Response(200, json={"result": [{"instrument_name": f"ETH-{exp_date}-100-C", "is_active": True,
                                                         "option_details": {"expiry": expiry}}]})
        if p["instrument_type"] == "option":
            return httpx.Response(200, json={"result": {"tickers": tickers}})
        return httpx.Response(200, json={"result": {"tickers": {"ETH-PERP": {"f": "0.00001", "M": "100.5", "I": "100.2"}}}})

    async def go():
        s = Settings(sources=["v2_mainnet"], underlyings=["ETH"], data_dir=tmp_path)
        client = DeriveClient("https://x/", transport=httpx.MockTransport(handler), backoff=0, retries=0)
        rec = Recorder(s, Store(s.db_path), clients={"v2_mainnet": client})
        ts = 1_000_000 // 3600 * 3600
        await rec.snapshot("v2_mainnet", "ETH", ts, keep_chain=True)
        await client.close()
        return ts, rec.strikes["v2_mainnet:ETH"]

    ts, live = asyncio.run(go())
    kept = strikes_from_chain({"options": tickers, "perp": {"I": "100.2"}}, ts)
    assert kept == live and kept["index"] == 100.2
    assert kept["expiries"][str(expiry)][0][0] == 1.5  # fractional strike read as 1.5
    assert strikes_from_chain({"options": tickers, "perp": None}, expiry)["expiries"] == {}  # expired at ts


def _positions(cells):
    """{UND: {instrument: {tier: cell}}} with the smart cell given (top and profitable around it)."""
    out = {}
    for name, cell in cells.items():
        out.setdefault(name.split("-")[0], {})[name] = {"top": cell, "smart": cell, "profitable": cell}
    return out


def test_appended_close_valued_with_its_chain_is_the_live_reading(tmp_path):
    day = "2024-06-03"
    ts = B.close_ts(day)
    names = ["ETH-20240607-3000-C", "ETH-20240628-3200-C", "ETH-20240628-2800-P", "ETH-20240927-4000-C"]
    raw = _chain_file(tmp_path, "ETH", ts, {  # the call carries the strike's delta, as on Derive
        names[0]: _ticker(0.6, 0.52), names[1]: _ticker(0.62, 0.35), "ETH-20240628-2800-C": _ticker(0.66, 0.7),
        names[2]: _ticker(0.66, -0.3), names[3]: _ticker(0.7, 0.1)})
    positions = _positions({names[0]: [3.0, 2, 3.0], names[1]: [-1.5, 3, 4.5], names[2]: [2.0, 1, 2.0],
                            names[3]: [10.0, 4, 10.0]})
    assert B.append(tmp_path, day, positions) is False
    doc = json.loads((tmp_path / "history" / "balance.json").read_text())
    assert doc["schema"] == B.SCHEMA and doc["through"] == day
    strikes = strikes_from_chain(raw, ts)
    for h, days in lean.HORIZONS.items():
        live = lean.wallets_reading(positions["ETH"], strikes, strikes["index"], ts, days)
        got = doc["closes"][str(ts)]["ETH"][h]
        assert got[:4] == [live["score"], round(live["net_delta_usd"]), round(live["gross_delta_usd"]), live["positions"]]
        assert got[4] & B.FLAG_MODELLED == 0
    assert doc["closes"][str(ts)]["ETH"]["30d"][0] is not None


def test_a_coin_without_a_chain_is_modelled(tmp_path):
    day = "2024-06-03"
    history.write_day(tmp_path, date(2024, 6, 3), [_row("0xA", "ETH-20240628-3500-C", buy=1, bv=50, iv=0.5)])
    _candles(tmp_path, days=200, price=3500.0)
    positions = _positions({"ETH-20240628-3500-C": [20.0, 4, 20.0]})
    B.append(tmp_path, day, positions)
    got = B.read(tmp_path)["closes"][str(B.close_ts(day))]["ETH"]["30d"]
    t = (history.parse_option("ETH-20240628-3500-C")[1] - B.close_ts(day)) / B.YEAR
    delta = history.option_delta(3500.0, 3500.0, t, 0.5, "C")  # the instrument's own traded IV
    assert got == [1.0, round(20 * delta * 3500), round(20 * delta * 3500), 4, B.FLAG_MODELLED]


def test_an_expiry_leaving_the_window_flags_a_roll(tmp_path):
    d1, d2 = "2024-06-06", "2024-06-07"
    near, far = "ETH-20240607-3000-C", "ETH-20240612-3000-C"   # near expires 7 June 08:00
    for day in (d1, d2):
        _chain_file(tmp_path, "ETH", B.close_ts(day), {near: _ticker(0.6, 0.5), far: _ticker(0.6, 0.5)})
    B.append(tmp_path, d1, _positions({near: [10.0, 3, 10.0], far: [2.0, 3, 2.0]}))
    B.append(tmp_path, d2, _positions({far: [2.0, 3, 2.0]}))
    doc = B.read(tmp_path)
    first, second = doc["closes"][str(B.close_ts(d1))]["ETH"], doc["closes"][str(B.close_ts(d2))]["ETH"]
    assert first["7d"][4] & B.FLAG_ROLL == 0          # no previous close to compare
    assert second["7d"][4] & B.FLAG_ROLL and second["30d"][4] & B.FLAG_ROLL
    assert B.roll_share(0, {"200000": 10.0}, B.DAY, {"200000": 10.0}, 30) == 0.0      # held both days
    assert B.roll_share(0, {"200000": 10.0}, 2 * B.DAY, {"200000": 10.0}, 30) is None  # not consecutive
    # the same book a day later is not a roll
    d3 = "2024-06-08"
    _chain_file(tmp_path, "ETH", B.close_ts(d3), {far: _ticker(0.6, 0.5)})
    B.append(tmp_path, d3, _positions({far: [2.0, 3, 2.0]}))
    assert B.read(tmp_path)["closes"][str(B.close_ts(d3))]["ETH"]["30d"][4] & B.FLAG_ROLL == 0
    assert sorted(B.read(tmp_path)["expiry_gross"]) == [str(B.close_ts(d2)), str(B.close_ts(d3))]


def test_a_skipped_close_asks_for_the_backfill(tmp_path):
    name = "ETH-20240628-3000-C"
    for day in ("2024-06-03", "2024-06-05"):
        _chain_file(tmp_path, "ETH", B.close_ts(day), {name: _ticker(0.6, 0.5)})
    assert B.append(tmp_path, "2024-06-03", _positions({name: [5.0, 3, 5.0]})) is False
    assert B.append(tmp_path, "2024-06-05", _positions({name: [5.0, 3, 5.0]})) is True


def test_backfill_rebuilds_closes_point_in_time(tmp_path):
    _history(tmp_path)
    _candles(tmp_path)
    (tmp_path / "universe.json").write_text(json.dumps({"underlyings": ["ETH"]}))
    (tmp_path / "history" / "settlements").mkdir(parents=True)
    (tmp_path / "history" / "settlements" / "ETH.json").write_text(json.dumps(SETTLE["ETH"]))
    assert B.backfill(tmp_path, n=90) == 90
    doc = B.read(tmp_path)
    keys = sorted(doc["closes"], key=int)
    assert len(keys) == 90 and doc["through"] == (START + timedelta(days=199)).isoformat()
    # the close on day 140 holds only what was known then: 0xLate (not yet directional) and its
    # E2 calls are outside the cohort; by day 190 it is in, with its E3 puts
    early, late = (START + timedelta(days=140)).isoformat(), (START + timedelta(days=190)).isoformat()
    got = _replay_to(tmp_path, {early, late})
    tiers, cells = got[early]
    assert "0xLate" not in tiers and f"ETH-{E2}-4000-C" not in cells["ETH"]
    row = doc["closes"][str(B.close_ts(early))]["ETH"]["30d"]
    assert row[3] == cells["ETH"][f"ETH-{E2}-4500-C"]["smart"][1] == 1
    assert row[4] & B.FLAG_MODELLED  # no chain recorded then
    tiers, cells = got[late]
    assert "0xLate" in tiers and cells["ETH"][f"ETH-{E3}-3200-P"]["smart"][1] == 1
    assert doc["closes"][str(B.close_ts(late))]["ETH"]["30d"][3] == 2  # 0xA's E3 calls and 0xLate's E3 puts


def test_radar_applies_the_live_gates_and_keeps_gaps(tmp_path):
    t = B.close_ts("2024-06-03")
    closes = {str(t - 2 * 86400): {"BTC": {"30d": [0.5, 50000, 100000, 5, 0], "7d": [None, 10, 20000, 4, 0]}},
              str(t - 86400): {},  # recorded, nothing held
              str(t): {"BTC": {"30d": [0.2, 1000, 5000, 5, 2], "7d": [0.9, 9000, 20000, 2, 0]},
                       "ETH": {"30d": [-0.4, -8000, 20000, 6, 3], "7d": [0.1, None, None, 6, 0]}}}
    del closes[str(t - 86400)]  # a gap
    B.write(tmp_path, closes, {})
    engine = {"BTC": [{"ts": t, "zscore": 1.23456, "metric_status": {"zscore": "ready"}},
                      {"ts": t - 2 * 86400, "zscore": 0.5, "metric_status": {"zscore": "warming up"}}]}
    doc = publish_site.radar_block(tmp_path, engine, ["BTC", "ETH", "SOL"], now=t + 3600)
    assert doc["version"] == 1 and doc["cohort"] == "smart" and doc["through"] == "2024-06-03"
    assert len(doc["closes"]) == 30 and doc["closes"][-1] == t and doc["closes"][-2] == t - 86400
    btc, eth, sol = (doc["coins"][u] for u in ("BTC", "ETH", "SOL"))
    assert btc["z"][-3:] == [None, None, 1.23]
    assert btc["w"]["30d"][-3:] == [[0.5, 100000, 0], None, None]    # gross below $10k at the last close
    assert btc["w"]["7d"][-3:] == [None, None, None]                  # no score; fewer than 3 positions
    assert eth["w"]["30d"][-1] == [-0.4, 20000, 3] and eth["w"]["7d"][-1] is None  # incomplete quotes
    assert all(v is None for v in sol["z"] + sol["w"]["30d"] + sol["w"]["7d"])
    assert publish_site.radar_block(tmp_path / "empty", engine, ["BTC"], now=t) is None


def test_history_job_backfills_once_after_the_surface_rebuild(tmp_path, monkeypatch):
    _history(tmp_path, days=120)
    _candles(tmp_path, days=120)
    last = START + timedelta(days=119)
    now = _ts(last + timedelta(days=1), 2)
    history.save_state(tmp_path, {"done_through": last.isoformat(), "repaired": history_once.REPAIR})

    async def settlements(client, root, unds):
        return SETTLE
    monkeypatch.setattr(history, "update_settlements", settlements)
    run = lambda budget=200: asyncio.run(history_once.run(tmp_path, budget=budget, now=now, client=object()))  # noqa: E731
    first = run()   # classes the wallets, appends the close and rebuilds the surface rows: no backfill
    assert "balance_closes" not in first and history.load_state(tmp_path)["surface"] == history_once.SURFACE_VERSION
    assert list(B.read(tmp_path)["closes"]) == [str(B.close_ts(last.isoformat()))]
    assert history_once.is_due(tmp_path, now)
    assert "balance_closes" not in run(budget=60)   # too little budget left: waits
    assert run()["balance_closes"] == 90
    state = history.load_state(tmp_path)
    assert state["balance"] == history_once.BALANCE_VERSION and not history_once.is_due(tmp_path, now)
    saved = (tmp_path / "history" / "balance.json").read_bytes()
    assert len(B.read(tmp_path)["closes"]) == 90
    assert run() == {"added": 0, "through": last.isoformat()}
    assert run() == {"added": 0, "through": last.isoformat()}
    assert (tmp_path / "history" / "balance.json").read_bytes() == saved


def test_the_job_and_the_module_share_one_version():
    assert history_once.BALANCE_VERSION == B.SCHEMA

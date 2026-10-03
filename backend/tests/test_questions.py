"""Questions stage 1: the worked examples of docs/questions-design.md, the zone rule, the gates, the
job's files and the off switch."""
import gzip
import json
import math
from pathlib import Path

import httpx
import pytest

from derive import question_job as qj
from derive import questions as Q

FIX = Path(__file__).parent / "fixtures" / "chain_btc_eth_20261003_14.json.gz"
T14 = 1791036000  # 3 Oct 2026 14:00 UTC
BTC_SPEC = {"tick": 1.0, "min": 0.01, "step": 0.00001, "taker": 0.0003, "base": 0.5, "cap": 0.125}
ETH_SPEC = {"tick": 0.1, "min": 0.1, "step": 0.01, "taker": 0.0003, "base": 0.5, "cap": 0.125}
SPECS = {"BTC": BTC_SPEC, "ETH": ETH_SPEC}


@pytest.fixture(scope="module")
def snaps():
    return {int(k): v for k, v in json.load(gzip.open(FIX, "rt"))["snapshots"].items()}


@pytest.fixture(scope="module")
def chain14(snaps):
    return snaps[T14]


def level(chain, und, e, lo, hi):
    ex = Q.expiries(chain[und]["options"])[e]
    return Q.price_level(ex, lo, hi, float(chain[und]["perp"]["I"]), SPECS[und]), float(chain[und]["perp"]["I"])


def cents_up(x):
    return math.ceil(round(x * 100, 6))


def cents_down(x):
    return math.floor(round(x * 100, 6))


def test_btc_above_86000_worked_example(chain14):
    p, idx = level(chain14, "BTC", "20261009", 83000, 89000)
    assert round(p["fair"], 4) == 0.3502
    y, n = p["yes"], p["no"]
    assert y["form"] == "debit" and round(y["buy"], 4) == 0.3782 and cents_up(y["buy"]) == 38
    assert round(y["sell"], 4) == 0.3463 and cents_down(y["sell"]) == 34
    assert n["form"] == "credit" and round(n["buy"], 4) == 0.6537 and cents_up(n["buy"]) == 66
    assert cents_up(y["buy"]) - cents_down(y["sell"]) == 4 and round(y["buy"] - y["sell"], 4) == 0.0318
    assert round(y["size"]) == 26496 and round(n["size"]) == 720
    assert y["legs"] == [["BTC-20261009-83000-C", "buy", 2431.0], ["BTC-20261009-89000-C", "sell", 162.0]]
    t = Q.ticket(y, 6000, idx, BTC_SPEC, dollars=100)
    assert t["contracts"] == 0.04407 and f"{t['premium']:.2f}" == "99.99" and f"{t['fees']:.2f}" == "3.01"
    assert f"{t['payout']:.2f}" == "264.42" and f"{t['at_k']:.2f}" == "132.21" and t["net"] == 2269
    m = Q.ticket(y, 6000, idx, BTC_SPEC, contracts=0.01)
    assert f"{m['payout']:.0f}" == "60" and f"{m['premium']:.2f}" == "22.69" and f"{m['fees']:.2f}" == "1.46"
    assert round(y["over"] * 100, 2) == 3.66 and round(n["over"] * 100, 2) == 1.30
    assert Q.passes(p, "BTC")


def test_eth_above_2700_fails_on_size(chain14):
    p, idx = level(chain14, "ETH", "20261009", 2600, 2800)
    t = Q.ticket(p["yes"], 200, idx, ETH_SPEC, dollars=100)
    assert t["contracts"] == 1.08 and f"{t['premium']:.2f}" == "99.47" and t["payout"] == pytest.approx(216)
    assert f"{t['fees']:.2f}" == "2.74"
    assert round(p["yes"]["size"]) == 40 and Q.side_state(p["yes"], "ETH") == "no_quote"
    assert not Q.passes(p, "ETH")


def test_clip_and_order_on_every_level(chain14):
    p, _ = level(chain14, "BTC", "20261009", 84000, 88000)
    assert round(p["fair"], 4) == 0.3262  # the 84,000 call's mark sat under its own bid
    for und in ("BTC", "ETH"):
        idx = float(chain14[und]["perp"]["I"])
        for e, ex in Q.expiries(chain14[und]["options"]).items():
            if not Q.offered(e, T14):
                continue
            w = Q.choose_zone(ex, idx, und)
            for k in Q.valid_levels(Q.listed(ex), w):
                p = Q.price_level(ex, k - w / 2, k + w / 2, idx, SPECS[und])
                y = p and p["yes"]
                if y and y["sell"] is not None and p["fair"] is not None:
                    assert y["sell"] - 1e-12 <= p["fair"] <= y["buy"] + 1e-12


def test_payout_identities():
    for s in (80000, 83000, 85870.84, 86000, 89000, 95000):
        y = Q.payout_yes(s, 83000, 89000)
        assert 0 <= y <= 1 and y + (1 - y) == 1
        legs = (max(s - 83000, 0) - max(s - 89000, 0)) / 6000  # long call 83k, short call 89k
        assert y == pytest.approx(legs)
    assert round(Q.payout_yes(85870.84, 85500, 86000), 4) == 0.7417  # BTC, 2 Oct


def test_fractional_strike_and_ids():
    assert Q.parse_qid("XRP-20260828-A-1_3-1_4") == {"und": "XRP", "expiry": "20260828", "lo": 1.3, "hi": 1.4}
    ex = Q.expiries({"XRP-20260828-1_35-C": {"M": "0.1"}, "XRP-20260828-1_35-P": {"M": "0.1"}})
    assert list(ex["20260828"]["strikes"]) == [1.35]
    assert Q.qid("BTC", "20261009", "BTC-20261009-83000-C", "BTC-20261009-89000-C") == "BTC-20261009-A-83000-89000"


def test_unusable_prices_are_no_quote():
    q = lambda b, a, M: {"b": str(b), "a": str(a), "B": "1", "A": "1", "M": str(M)}  # noqa: E731
    ex = Q.expiries({"BTC-20261009-1000-C": q(10, 900, 50), "BTC-20261009-2000-C": q(5, 6, 5),
                     "BTC-20261009-1000-P": q(0, 0, 0), "BTC-20261009-2000-P": q(0, 0, 0)})["20261009"]
    p = Q.price_level(ex, 1000, 2000, 1500, Q.DEFAULT_SPEC)
    assert p["yes"]["buy"] <= 1  # 900 - 5 over a 1,000 zone
    ex2 = Q.expiries({"BTC-20261009-1000-C": q(10, 1900, 50), "BTC-20261009-2000-C": q(5, 6, 5),
                      "BTC-20261009-1000-P": q(0, 0, 0), "BTC-20261009-2000-P": q(0, 0, 0)})["20261009"]
    p2 = Q.price_level(ex2, 1000, 2000, 1500, Q.DEFAULT_SPEC)
    assert p2["yes"] is None and Q.side_state(p2["yes"], "BTC") == "no_quote"


def test_date_list_and_labels(chain14):
    exs = Q.expiries(chain14["BTC"]["options"])
    dates = [e for e in sorted(exs) if Q.offered(e, T14)]
    assert dates == ["20261005", "20261006", "20261007", "20261009", "20261016", "20261023", "20261030"]
    assert [Q.date_label(e, T14) for e in dates] == ["Mon 5 Oct", "Tue 6 Oct", "Wed 7 Oct", "This Friday · 9 Oct",
                                                    "Fri 16 Oct", "Fri 23 Oct", "End of Oct · Fri 30 Oct"]
    assert "20261004" in exs and "20261127" in exs  # in the chain, off the board
    two_am = 1791072000 + 7200  # 4 Oct 02:00 -> 5 Oct 08:00 is 30 hours
    assert Q.offered("20261005", two_am) and not Q.offered("20261005", 1791072000 + 9 * 3600 + 86400 - 3600 * 10)


def test_zone_rule_headline_and_gates(chain14):
    zones = {}
    for und in ("BTC", "ETH"):
        coin = {"dates": {}}
        board = Q.step(und, chain14[und], T14, SPECS[und], coin)
        zones[und] = {e: d["zone"] for e, d in coin["dates"].items() if d["zone"]}
        passing = sorted(e for e, d in coin["dates"].items() if d["checks"] and d["checks"][-1])
        if und == "BTC":
            assert passing == ["20261005", "20261006", "20261007", "20261009", "20261016", "20261023", "20261030"]
            d9 = next(d for d in board["dates"] if d["expiry"] == "20261009")
            assert d9["headline"] == "BTC-20261009-A-82000-88000"
        else:
            # S = $50 per side (owner, 3 October 2026): 5, 6, 7 Oct pass, 9 Oct still fails on size ($40).
            assert {"20261005", "20261006", "20261007"} <= set(passing) and "20261009" not in passing
    assert zones["BTC"] == {"20261005": 6000, "20261006": 6000, "20261007": 6000, "20261009": 6000,
                            "20261016": 8000, "20261023": 8000, "20261030": 8000}
    assert set(zones["ETH"].values()) == {200}


def test_zone_is_stable_over_the_snapshots(snaps):
    for und in ("BTC", "ETH"):
        coin = {"dates": {}}
        seen = {}
        for ts in sorted(snaps):
            board = Q.step(und, snaps[ts][und], ts, SPECS[und], coin)
            for e, d in coin["dates"].items():
                if d["zone"] is None:
                    continue
                seen.setdefault(e, []).append(d["zone"])
                assert d["zone_changes"] <= 1
            for d in board["dates"]:
                for lv in d["levels"]:  # retired ids stay priced
                    if lv["state"] == "retired":
                        assert lv["yes"]["state"] in ("open", "screen_wide", "no_quote")
        for e, zs in seen.items():
            assert len(set(zs)) <= 2, (und, e, zs)


def test_ladder_and_sticky_ids(chain14):
    coin = {"dates": {}}
    board = Q.step("BTC", chain14["BTC"], T14, BTC_SPEC, coin)
    for d in board["dates"]:
        seven = [lv for lv in d["levels"] if lv["ladder"] == 7]
        assert 0 < len(seven) <= 7
        for lv in seven:
            assert 0.03 <= lv["yes"].get("buy", lv["fair"]) <= 0.97
    ids = {e: set(d["ids"]) for e, d in coin["dates"].items()}
    # A later snapshot never drops a published id while its date is live.
    Q.step("BTC", chain14["BTC"], T14 + 900, BTC_SPEC, coin)
    for e, before in ids.items():
        assert before <= set(coin["dates"][e]["ids"])


def test_settling_window(chain14):
    coin = {"dates": {}}
    Q.step("BTC", chain14["BTC"], T14, BTC_SPEC, coin)
    late = Q.expiry_ts("20261005") - 1200  # 07:40 UTC on 5 Oct
    board = Q.step("BTC", chain14["BTC"], late, BTC_SPEC, coin)
    d5 = next(d for d in board["dates"] if d["expiry"] == "20261005")
    assert d5["levels"] and all(lv["state"] in ("settling", "retired") for lv in d5["levels"])
    assert not d5["board"]


def test_thin_coins_use_the_looser_gates():
    assert Q.gate("BTC", "cost") == 0.05 and Q.gate("ETH", "size") == 50
    assert Q.gate("HYPE", "cost") == 0.08 and Q.gate("HYPE", "size") == 25 and Q.tier("HYPE") == "thin"


# -- the job ----------------------------------------------------------------------------------
def _job(tmp_path, chain14, publish, now=T14 + 300):
    root, site = tmp_path / "data", tmp_path / "site"
    root.mkdir(exist_ok=True)
    site.mkdir(exist_ok=True)
    chains = {u: chain14[u] for u in ("BTC", "ETH")}
    boards = qj.run(root, "v2_mainnet", chains, SPECS, T14, site=site, publish=publish, now=now)
    return root, site, boards


def test_job_writes_files_only_when_publishing(tmp_path, chain14):
    root, site, _ = _job(tmp_path, chain14, publish=False)
    assert (root / "questions" / "state.json").exists()
    assert list((root / "questions" / "history" / "BTC").glob("*.csv"))
    assert not (site / "questions").exists()
    root, site, _ = _job(tmp_path, chain14, publish=True)
    idx = json.loads((site / "questions" / "index.json").read_text())
    assert [c["und"] for c in idx["coins"]] == ["BTC", "ETH"] and idx["prices_ts"] == T14
    btc = json.loads((site / "questions" / "BTC.json").read_text())
    assert btc["spec"]["step"] == 0.00001 and len((site / "questions" / "BTC.json").read_bytes()) < 60_000
    h = json.loads((site / "questions" / "history" / "BTC-20261009.json").read_text())
    assert h["ts"] == [T14] and "BTC-20261009-A-83000-89000" in h["rows"]
    # Switched off again: nothing Questions-related stays in the app data.
    _job(tmp_path, chain14, publish=False)
    assert not (site / "questions").exists()


def test_off_switch_defaults_off(monkeypatch):
    monkeypatch.delenv("QUESTIONS_PUBLISH", raising=False)
    assert not qj.publishing()
    monkeypatch.setenv("QUESTIONS_PUBLISH", "on")
    assert qj.publishing()


def test_state_keeps_the_zone_between_runs(tmp_path, snaps):
    root = tmp_path / "data"
    root.mkdir()
    zones = []
    for ts in sorted(snaps):
        qj.run(root, "v2_mainnet", {"BTC": snaps[ts]["BTC"]}, SPECS, ts, publish=False, now=ts)
        zones.append(json.loads((root / "questions" / "state.json").read_text())["coins"]["BTC"]["dates"]["20261016"]["zone"])
    assert len(set(zones)) == 1


def test_history_appends_once_an_hour(tmp_path, chain14):
    root, _, _ = _job(tmp_path, chain14, publish=False)
    p = root / "questions" / "history" / "BTC" / "20261009.csv"
    n = len(p.read_text().splitlines())
    qj.run(root, "v2_mainnet", {"BTC": chain14["BTC"]}, SPECS, T14 + 900, publish=False, now=T14 + 1200)
    assert len(p.read_text().splitlines()) == n


def test_settled_dates_show_what_was_paid(tmp_path, chain14):
    root, site, _ = _job(tmp_path, chain14, publish=True)
    (root / "history" / "settlements").mkdir(parents=True)
    (root / "history" / "settlements" / "BTC.json").write_text(json.dumps({"20261005": 85870.84}))
    after = Q.expiry_ts("20261005") + 600
    qj.run(root, "v2_mainnet", {"BTC": chain14["BTC"]}, SPECS, after // 900 * 900, site=site, publish=True, now=after)
    btc = json.loads((site / "questions" / "BTC.json").read_text())
    s = next(s for s in btc["settled"] if s["expiry"] == "20261005")
    lv = next(lv for lv in s["levels"] if lv["id"] == "BTC-20261005-A-83000-89000")
    assert s["settle_price"] == 85870.84 and lv["paid"] == round((85870.84 - 83000) / 6000, 4)
    h = json.loads((site / "questions" / "history" / "BTC-20261005.json").read_text())
    assert h["paid"]["BTC-20261005-A-83000-89000"] == lv["paid"]


def test_pending_settlements_and_merge(tmp_path, chain14):
    root, _, _ = _job(tmp_path, chain14, publish=False)
    state = qj.load_state(root)
    after = Q.expiry_ts("20261005") + 600
    assert "BTC" in qj.pending_settlements(state, root, after)
    qj.save_settlements(root, "BTC", {"expiries": [{"expiry_date": "20261005", "price": "85870.84"}]})
    state["settle_try"]["BTC"] = 0
    assert "BTC" not in qj.pending_settlements(state, root, after) or Q.expiry_ts("20261006") <= after


def test_paused_at_publish_time(tmp_path, chain14):
    _, site, _ = _job(tmp_path, chain14, publish=True)
    assert not qj.mark_paused(site, T14 + 60 * 60)
    assert qj.mark_paused(site, T14 + 91 * 60)
    assert json.loads((site / "questions" / "BTC.json").read_text())["paused"] is True


def test_recorder_makes_the_same_calls(tmp_path):
    """Questions read the tickers already in memory: the recorder's exchange calls are unchanged."""
    from derive.client import DeriveClient
    from derive.config import Settings
    from derive.recorder import Recorder
    from derive.store import Store
    from tests.test_recorder import handler

    calls = []

    def counting(request):
        calls.append(json.loads(request.content) | {"m": request.url.path.rsplit("/", 1)[-1]})
        return handler(request)

    s = Settings(sources=["v2_mainnet"], underlyings=["ETH"], data_dir=tmp_path)
    client = DeriveClient("https://x/", transport=httpx.MockTransport(counting), backoff=0, retries=0)
    rec = Recorder(s, Store(s.db_path), clients={"v2_mainnet": client})
    import asyncio
    asyncio.run(rec.run_once(ts=1_000_000 // 3600 * 3600))
    before = list(calls)
    qj.run(tmp_path, "v2_mainnet", {"ETH": rec.chains["v2_mainnet:ETH"]}, {"ETH": rec.specs["v2_mainnet:ETH"]},
           1_000_000 // 3600 * 3600, publish=False, now=1_000_000)
    assert calls == before and "v2_mainnet:ETH" in rec.chains


def test_publish_site_removes_questions_while_off(tmp_path, chain14, monkeypatch):
    import publish_site
    _, site, _ = _job(tmp_path, chain14, publish=True)
    monkeypatch.setenv("QUESTIONS_PUBLISH", "on")
    assert publish_site.question_coins(site, T14 + 600) == {"BTC", "ETH"}
    assert publish_site.question_coins(site, T14 + 100 * 60) == set()  # paused: no coin link
    monkeypatch.setenv("QUESTIONS_PUBLISH", "off")
    assert publish_site.question_coins(site, T14 + 600) is None
    assert not (site / "questions").exists()

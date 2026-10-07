"""Study Addendum A (docs/options-traders-study.md): did directional traders' side settle their way?

Rules approved by the owner on 7 October 2026 before any result. One reading per coin and settlement date,
taken at 00:00 UTC 7 days before the settlement day (main test; dates whose options had traded by then) and
1 day before (reported). Wallets are classed with the information of the day files up to the reading only
(balance_history.Replay, history.classify's rules); delta is Black-76 on the index with the traded volatility
of the time (Replay's TradeIVs). The reading is the line's measure as written in the rules: net over gross
delta of every directional wallet's open options of that date, Long at +0.25, Short at -0.25, else Balanced,
needing $10,000 and 3 positions (a position is one wallet's holding in one option). Outcome: Derive's
settlement price against the index close at the reading. Chance: p_up x share Long + (1 - p_up) x share Short;
permutation: Long/Short labels shuffled across the same dates 10,000 times. Reported alongside, not deciding:
the app's current form (each wallet counted from $1,000 of delta, 3 wallets needed).

usage: python research/settlement_record/run.py DATA_DIR [OUT_JSON]
DATA_DIR holds history/ (days, settlements), universe.json and candles/{UND}/1d.csv from the data branch.
"""
import json
import random
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from derive import history as H  # noqa: E402
from derive.balance_history import Replay, close_ts, day_ts, index_closes, load_settlements  # noqa: E402
from derive.wallet_alias import canonical  # noqa: E402

UP, DOWN, MIN_USD, MIN_POSITIONS = 0.25, -0.25, 10_000, 3
WALLET_MIN_USD, MIN_WALLETS = 1_000, 3
LEADS = (7, 1)
DECIDE = ("BTC", "ETH")
SHUFFLES = 10_000


def reading(held, cls, ivs, day, as_of, und, expiry, index):
    """The line's reading for one coin and settlement at a close, as the rules state it, plus the wallet count."""
    pos = defaultdict(dict)  # instrument -> wallet -> net
    for (w, name), net in held.items():
        if cls.get(w) != "directional":
            continue
        o = ivs.opt(name)
        if o and o[0] == und and o[1] == expiry:
            pos[name][w] = net
    net = gross = 0.0
    positions = 0
    per_wallet = defaultdict(float)
    missing = 0
    for name, holders in pos.items():
        o = ivs.opt(name)
        iv = ivs.iv_for(name, und, day)
        if iv is None:
            missing += len(holders)
            continue
        d = H.option_delta(index, o[2], max(expiry - as_of, 0) / (365 * 86400), iv, o[3])
        unit = d * index
        positions += len(holders)
        net += sum(holders.values()) * unit
        gross += sum(abs(v) for v in holders.values()) * abs(unit)
        for w, v in holders.items():
            per_wallet[w] += v * unit
    held_n = positions + missing
    ok = not missing and gross >= MIN_USD and held_n >= MIN_POSITIONS
    score = net / gross if ok and gross else None
    state = None if score is None else "long" if score >= UP else "short" if score <= DOWN else "balanced"
    counted = [v for v in per_wallet.values() if abs(v) >= WALLET_MIN_USD]
    wnet, wgross = sum(counted), sum(abs(v) for v in counted)
    wok = not missing and len(counted) >= MIN_WALLETS and wgross >= MIN_USD
    wscore = wnet / wgross if wok else None
    wstate = None if wscore is None else "long" if wscore >= UP else "short" if wscore <= DOWN else "balanced"
    return {"state": state, "score": None if score is None else round(score, 3), "positions": held_n,
            "missing": missing, "gross": round(gross), "wallet_state": wstate, "long": sum(v > 0 for v in counted),
            "short": sum(v < 0 for v in counted)}


def run(root: Path) -> list[dict]:
    files = sorted((root / "history" / "days").glob("*.csv.gz"))
    days = [p.name[:10] for p in files]
    sett = load_settlements(root)
    candles = index_closes(root)
    canon = canonical(root)
    # Readings wanted: for every settled date of every coin, the day files up to the reading day.
    wanted = defaultdict(list)  # reading day -> [(und, expiry_ts, yyyymmdd, lead)]
    for und, prices in sett.items():
        for ymd in prices:
            d = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:]))
            for lead in LEADS:
                rd = (d - timedelta(days=lead + 1)).isoformat()  # its close is 00:00 UTC `lead` days before
                if days and days[0] <= rd <= days[-1]:
                    wanted[rd].append((und, int(H.parse_option(f"{und}-{ymd}-1-C")[1]), ymd, lead))
    rp = Replay(sett)
    first_trade: dict = {}
    out = []
    for p, day in zip(files, days):
        rows = H.canonical_rows(H.read_day(p), canon, rp.members)
        for r in rows:
            o = rp.opt(r["instrument"]) if not r["instrument"].endswith("-PERP") else None
            if o:
                first_trade.setdefault((o[0], o[1]), day)
        rp.add_day(day, rows, candles)
        if day not in wanted:
            continue
        as_of = close_ts(day)
        rp.settle_through(as_of)
        rp.tiers()  # refreshes rp.cls, the point-in-time classes
        held = rp.held(as_of)
        for und, expiry, ymd, lead in wanted[day]:
            index = candles.get(und, {}).get(day_ts(day))
            s = sett[und].get(ymd)
            if not index or s is None:
                continue
            listed = first_trade.get((und, expiry), "9999") <= day
            r = reading(held, rp.cls, rp.ivs, day, as_of, und, expiry, index)
            out.append({"und": und, "expiry": ymd, "lead": lead, "reading_day": day, "listed": listed,
                        "index": index, "settle": s, "up": s > index, **r})
    return out


def score(rows, key="state"):
    scored = [r for r in rows if r[key] in ("long", "short")]
    if not scored:
        return None
    hits = [(r[key] == "long") == r["up"] for r in scored]
    n, k = len(scored), sum(hits)
    p_up = sum(r["up"] for r in scored) / n
    share_long = sum(r[key] == "long" for r in scored) / n
    chance = p_up * share_long + (1 - p_up) * (1 - share_long)
    labels = [r[key] for r in scored]
    ups = [r["up"] for r in scored]
    rng = random.Random(7)
    beat = 0
    for _ in range(SHUFFLES):
        rng.shuffle(labels)
        if sum((lab == "long") == u for lab, u in zip(labels, ups)) >= k:
            beat += 1
    half = n // 2
    by_time = sorted(scored, key=lambda r: r["expiry"])

    def edge(part):
        if not part:
            return None
        pu = sum(r["up"] for r in part) / len(part)
        sl = sum(r[key] == "long" for r in part) / len(part)
        return sum((r[key] == "long") == r["up"] for r in part) / len(part) - (pu * sl + (1 - pu) * (1 - sl))

    return {"dates": len(rows), "scored": n, "their_way": k, "hit": round(k / n, 3), "chance": round(chance, 3),
            "p_up": round(p_up, 3), "share_long": round(share_long, 3), "perm_p": round(beat / SHUFFLES, 4),
            "balanced": sum(r[key] == "balanced" for r in rows), "unreadable": sum(r[key] is None for r in rows),
            "edge_first_half": None if half == 0 else round(edge(by_time[:half]), 3),
            "edge_second_half": None if half == 0 else round(edge(by_time[half:]), 3)}


def main():
    root = Path(sys.argv[1])
    rows = run(root)
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(rows))
    report = {}
    for lead in LEADS:
        for und in sorted({r["und"] for r in rows}):
            part = [r for r in rows if r["und"] == und and r["lead"] == lead and (lead != 7 or r["listed"])]
            report[f"{und} {lead}d"] = {"rules": score(part), "wallet_count": score(part, "wallet_state")}
    btc, eth = report.get("BTC 7d", {}).get("rules"), report.get("ETH 7d", {}).get("rules")
    bar = bool(btc and eth and btc["scored"] >= 60 and btc["perm_p"] <= 0.01
               and btc["edge_first_half"] > 0 and btc["edge_second_half"] > 0 and eth["hit"] > eth["chance"])
    print(json.dumps({"bar_met": bar, "report": report}, indent=1))


if __name__ == "__main__":
    main()

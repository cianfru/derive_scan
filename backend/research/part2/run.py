"""Part 2 of the declared study (docs/options-traders-study.md): do skilled directional options wallets lead price?

Rules approved by the owner on 2 October 2026 (Amendment B on 9 October); operational details fixed on 29 October
2026, before this code first read the data. Walk-forward: at the close of 30 June 2025 the wallets classed
directional are ranked by realised option PnL on the options that expired from 1 June 2024 to 30 June 2025 (tiers
Top, Smart, Profitable as history.rank_tiers sets them), then fixed. From 7 July 2025 to the newest data, each day's
positioning per underlying is a tier's net option delta added over the last 7 days as a share of every directional
wallet's absolute net (classes at the time, balance_history.Replay), scored against the underlying's next 3, 7 and
14-day change on Derive's daily index closes. Main statistic: Spearman, BTC, 7 days, Top, with a weekly block
bootstrap; controls: all directional wallets and 1,000 random sets of directional wallets as large as Top.

usage: python research/part2/run.py DATA_DIR [OUT_JSON]
DATA_DIR holds history/ (days, settlements, wallet_aliases.json), universe.json and candles/{UND}/1d.csv from the
data branch.
"""
import json
import random
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from derive import history as H  # noqa: E402
from derive.balance_history import Replay, close_ts, day_ts, index_closes, load_settlements  # noqa: E402
from derive.wallet_alias import canonical  # noqa: E402

TRAIN_FROM, TRAIN_TO = "2024-06-01", "2025-06-30"
SCORE_FROM = "2025-07-07"
WINDOW = 7
HORIZONS = (3, 7, 14)
UNDS = ("BTC", "ETH")
BOOT = 10_000
RANDOM_SETS = 1_000
SEED = 20251029


# ---------------------------------------------------------------- statistics (pure)

def rankdata(x: np.ndarray) -> np.ndarray:
    """Ranks from 1, ties sharing their average rank."""
    x = np.asarray(x, dtype=float)
    order = np.argsort(x, kind="mergesort")
    xs = x[order]
    first = np.flatnonzero(np.r_[True, xs[1:] != xs[:-1]])
    counts = np.diff(np.r_[first, len(x)])
    ranks = np.empty(len(x), dtype=float)
    ranks[order] = np.repeat(first + (counts - 1) / 2 + 1, counts)
    return ranks


def spearman(a, b) -> float | None:
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if len(a) < 3:
        return None
    ra, rb = rankdata(a), rankdata(b)
    sa, sb = ra.std(), rb.std()
    if sa == 0 or sb == 0:
        return None
    return float(((ra - ra.mean()) * (rb - rb.mean())).mean() / (sa * sb))


def week_blocks(days: list[str]) -> list[list[int]]:
    """Indices of `days` (ISO dates, in order) grouped by calendar week, Monday to Sunday."""
    blocks, key = [], None
    for i, d in enumerate(days):
        dd = date.fromisoformat(d)
        k = dd - timedelta(days=dd.weekday())
        if k != key:
            blocks.append([])
            key = k
        blocks[-1].append(i)
    return blocks


def bootstrap(a, b, days: list[str], n: int = BOOT, seed: int = SEED) -> tuple | None:
    """The 0.5th and 99.5th percentiles of Spearman over weekly block resamples of as many days."""
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    blocks = week_blocks(days)
    if len(blocks) < 2:
        return None
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        idx: list[int] = []
        while len(idx) < len(a):
            idx += rng.choice(blocks)
        idx = idx[:len(a)]
        s = spearman(a[idx], b[idx])
        if s is not None:
            out.append(s)
    out.sort()
    return (round(out[int(0.005 * len(out))], 4), round(out[min(len(out) - 1, int(0.995 * len(out)))], 4))


def rolling(mat: np.ndarray, w: int = WINDOW) -> np.ndarray:
    """Each column the sum of the last w columns up to it (fewer at the start)."""
    c = np.cumsum(mat, axis=1)
    out = c.copy()
    out[:, w:] = c[:, w:] - c[:, :-w]
    return out


def shares(R: np.ndarray, rows) -> np.ndarray:
    """Per column: the rows' summed net over every row's absolute net (NaN where nothing was added)."""
    den = np.abs(R).sum(axis=0)
    num = R[list(rows)].sum(axis=0) if len(rows) else np.zeros(R.shape[1])
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)


# ---------------------------------------------------------------- data pass

def window_pnl(rp: Replay, sett: dict, lo: int, hi: int) -> dict:
    """{wallet: realised option PnL on the options that expired in [lo, hi]} from the replay's pairs."""
    out: dict = defaultdict(float)
    for (wallet, name), p in rp.pairs.items():
        o = rp.opt(name)
        if not o or not (lo <= o[1] <= hi):
            continue
        s = sett.get(o[0], {}).get(name.split("-")[1])
        if s is None:
            continue
        payoff = max(s - o[2], 0.0) if o[3] == "C" else max(o[2] - s, 0.0)
        out[wallet] += p[1] + p[0] * payoff
    return out


def collect(root: Path) -> dict:
    """One pass over the day files: the training tiers, the directional wallets at the training close, and every
    directional-at-the-time wallet's daily option delta added per underlying from SCORE_FROM - 6 days."""
    t0 = time.time()
    files = sorted((root / "history" / "days").glob("*.csv.gz"))
    canon = canonical(root)
    sett = load_settlements(root)
    closes = index_closes(root)
    rp = Replay(sett)
    first_trade_day = (date.fromisoformat(SCORE_FROM) - timedelta(days=WINDOW - 1)).isoformat()
    delta: dict = defaultdict(dict)          # (day, und) -> {wallet: delta added}
    dir_prev: set = set()
    train = None
    lo = int(datetime.fromisoformat(TRAIN_FROM).replace(tzinfo=timezone.utc).timestamp())
    hi = close_ts(TRAIN_TO)
    days = []
    for p in files:
        day = p.name[:10]
        days.append(day)
        rows = H.canonical_rows(H.read_day(p), canon, rp.members)
        if day >= first_trade_day:
            for r in rows:
                name, w = r["instrument"], r["wallet"]
                und = name.split("-")[0]
                if und not in UNDS or name.endswith("-PERP") or w not in dir_prev:
                    continue
                d = H._f(r["delta_usd"])
                if d:
                    cell = delta[(day, und)]
                    cell[w] = cell.get(w, 0.0) + d
        rp.add_day(day, rows, closes)
        rp.settle_through(close_ts(day))
        for wallet in rp._dirty:
            rp.cls[wallet] = rp._class(wallet)
        rp._dirty.clear()
        dir_prev = {w for w, c in rp.cls.items() if c == "directional"}
        if day == TRAIN_TO:
            pnl = window_pnl(rp, sett, lo, hi)
            out = {w: {"class": "directional", "option_pnl": round(pnl.get(w, 0.0), 2)} for w in dir_prev}
            tiers = H.rank_tiers(out)
            train = {"directional": sorted(dir_prev), "pnl": {w: v["option_pnl"] for w, v in out.items()},
                     "tiers": {w: v.get("tier") for w, v in tiers.items() if v.get("tier")}}
    print(f"pass: {len(files)} day files, {days[0]} to {days[-1]}, {time.time() - t0:.0f}s", file=sys.stderr)
    return {"days": days, "delta": delta, "train": train, "closes": closes}


# ---------------------------------------------------------------- the test

def test(data: dict) -> dict:
    train = data["train"]
    tiers = train["tiers"]
    top = sorted(w for w, t in tiers.items() if t == "top")
    smart = sorted(w for w, t in tiers.items() if t in ("top", "smart"))
    profitable = sorted(w for w, t in tiers.items() if t in ("top", "smart", "profitable"))
    days = [d for d in data["days"] if d >= (date.fromisoformat(SCORE_FROM) - timedelta(days=WINDOW - 1)).isoformat()]
    assert all((date.fromisoformat(b) - date.fromisoformat(a)).days == 1 for a, b in zip(days, days[1:])), "a day is missing"
    newest = data["days"][-1]
    out = {"train": {"window": [TRAIN_FROM, TRAIN_TO], "directional": len(train["directional"]), "top": len(top),
                     "smart": len(smart), "profitable": len(profitable),
                     "top_pnl_min": min(train["pnl"][w] for w in top) if top else None},
           "newest_day": newest, "unds": {}}
    rng = random.Random(SEED)
    pool = train["directional"]
    random_sets = [rng.sample(pool, len(top)) for _ in range(RANDOM_SETS)] if len(pool) >= len(top) else []
    for und in UNDS:
        wallets = sorted({w for d in days for w in data["delta"].get((d, und), {})})
        ix = {w: i for i, w in enumerate(wallets)}
        M = np.zeros((len(wallets), len(days)))
        for j, d in enumerate(days):
            for w, v in data["delta"].get((d, und), {}).items():
                M[ix[w], j] = v
        R = rolling(M)
        closes = data["closes"].get(und, {})
        price = [closes.get(day_ts(d)) for d in days]
        scored = [j for j, d in enumerate(days) if d >= SCORE_FROM]

        def ret(j, h):
            k = j + h
            if k >= len(days) or not price[j] or not price[k]:
                return None
            return price[k] / price[j] - 1

        groups = {"top": top, "smart": smart, "profitable": profitable, "directional": wallets}
        u = {"wallets_trading": len(wallets), "groups": {}}
        for g, members in groups.items():
            rows = [ix[w] for w in members if w in ix]
            sh = shares(R, rows)
            per_h = {}
            for h in HORIZONS:
                pts = [(days[j], sh[j], ret(j, h)) for j in scored if not np.isnan(sh[j]) and ret(j, h) is not None]
                s = spearman([p[1] for p in pts], [p[2] for p in pts])
                cell = {"n": len(pts), "spearman": None if s is None else round(s, 4),
                        "first": pts[0][0] if pts else None, "last": pts[-1][0] if pts else None}
                if g == "top" or (g in ("smart", "profitable", "directional") and h == 7):
                    cell["ci99"] = bootstrap([p[1] for p in pts], [p[2] for p in pts], [p[0] for p in pts])
                if h == 7 and len(pts) >= 6:
                    k = len(pts) // 2
                    a, b = pts[:k], pts[k:]
                    cell["halves"] = [round(spearman([p[1] for p in a], [p[2] for p in a]) or 0, 4),
                                      round(spearman([p[1] for p in b], [p[2] for p in b]) or 0, 4)]
                    cell["halves_split"] = b[0][0]
                per_h[f"{h}d"] = cell
            per_h["rows"] = len(rows)
            per_h["mean_share"] = None if np.all(np.isnan(sh[scored])) else round(float(np.nanmean(sh[scored])), 4)
            u["groups"][g] = per_h
        if und == "BTC" and random_sets:
            stats = []
            for members in random_sets:
                rows = [ix[w] for w in members if w in ix]
                sh = shares(R, rows)
                pts = [(sh[j], ret(j, 7)) for j in scored if not np.isnan(sh[j]) and ret(j, 7) is not None]
                s = spearman([p[0] for p in pts], [p[1] for p in pts])
                if s is not None:
                    stats.append(s)
            stats.sort()
            obs = u["groups"]["top"]["7d"]["spearman"]
            u["random_sets"] = {"n": len(stats), "p95": round(stats[int(0.95 * len(stats))], 4) if stats else None,
                                "median": round(stats[len(stats) // 2], 4) if stats else None,
                                "share_below_top": round(sum(s < obs for s in stats) / len(stats), 4) if stats and obs is not None else None}
        out["unds"][und] = u
    btc = out["unds"]["BTC"]["groups"]["top"]["7d"]
    eth = out["unds"]["ETH"]["groups"]["top"]["7d"]
    rs = out["unds"]["BTC"].get("random_sets") or {}
    bar = {
        "1_btc_spearman_at_least_0.10_and_ci99_above_zero": bool(btc["spearman"] is not None and btc["spearman"] >= 0.10
                                                                 and btc.get("ci99") and btc["ci99"][0] > 0),
        "2_positive_in_both_halves": bool(btc.get("halves") and min(btc["halves"]) > 0),
        "3_above_p95_of_random_sets": bool(rs.get("p95") is not None and btc["spearman"] is not None and btc["spearman"] > rs["p95"]),
        "4_same_sign_on_eth": bool(eth["spearman"] is not None and btc["spearman"] is not None
                                   and (eth["spearman"] > 0) == (btc["spearman"] > 0) and eth["spearman"] != 0),
    }
    out["bar"] = bar
    out["verdict"] = "signal" if all(bar.values()) else "context, not a signal"
    return out


def main() -> None:
    root = Path(sys.argv[1])
    res = test(collect(root))
    text = json.dumps(res, indent=1)
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(text)
    print(text)


if __name__ == "__main__":
    main()

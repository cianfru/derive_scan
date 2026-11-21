"""Part 2 of the declared study (research/part2/run.py): the statistics and the share, on known numbers."""
import numpy as np
import pytest

from research.part2 import run as P2


def test_ranks_share_ties_and_spearman_reads_order():
    assert P2.rankdata(np.array([10.0, 20.0, 20.0, 5.0])).tolist() == [2.0, 3.5, 3.5, 1.0]
    assert P2.spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)
    assert P2.spearman([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1.0)
    assert P2.spearman([1, 2], [1, 2]) is None, "too few points"
    assert P2.spearman([1, 1, 1], [1, 2, 3]) is None, "no spread"


def test_the_share_is_the_tiers_net_over_every_wallets_absolute_net():
    # Three wallets over 3 days; the window is 2 days here.
    M = np.array([[100.0, 0.0, 50.0],      # a (in the tier)
                  [-40.0, 10.0, 0.0],      # b
                  [0.0, 0.0, 0.0]])        # c (added nothing)
    R = P2.rolling(M, w=2)
    assert R.tolist() == [[100.0, 100.0, 50.0], [-40.0, -30.0, 10.0], [0.0, 0.0, 0.0]]
    sh = P2.shares(R, [0])
    assert np.allclose(sh, [100 / 140, 100 / 130, 50 / 60])
    assert np.isnan(P2.shares(np.zeros((2, 1)), [0])[0]), "no reading when nothing was added"
    assert np.allclose(P2.shares(R, []), [0, 0, 0])


def test_week_blocks_and_the_bootstrap_interval():
    days = ["2025-07-07", "2025-07-08", "2025-07-13", "2025-07-14", "2025-07-20", "2025-07-21"]
    assert P2.week_blocks(days) == [[0, 1, 2], [3, 4], [5]]
    a = list(range(40))
    b = [x + (3 if x % 2 else -3) for x in a]
    days = [(np.datetime64("2025-07-07") + i).astype(str) for i in range(40)]
    lo, hi = P2.bootstrap(a, b, days, n=300)
    assert 0.7 < lo <= hi <= 1.0 + 1e-9
    assert P2.bootstrap(a, b, days, n=300) == (lo, hi), "seeded"

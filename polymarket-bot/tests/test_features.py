import math

from polymarket_bot.features import DAY, FEATURE_ORDER, compute_features, to_vector


def make_history(days: int, price: float, start_ts: float = 0.0):
    return [(start_ts + i * DAY / 4, price) for i in range(days * 4)]


def test_insufficient_history_returns_none():
    assert compute_features([(0, 0.5)] * 3, snapshot_ts=DAY, end_ts=2 * DAY, volume=1000) is None


def test_no_lookahead():
    """Points after the snapshot must not influence features."""
    base = make_history(10, 0.4)
    future_spike = base + [(11 * DAY, 0.99)]
    snapshot = 10 * DAY
    f1 = compute_features(base, snapshot, 20 * DAY, 5000)
    f2 = compute_features(future_spike, snapshot, 20 * DAY, 5000)
    assert f1 == f2


def test_feature_values():
    points = make_history(10, 0.4)
    snapshot = 9 * DAY
    feats = compute_features(points, snapshot, snapshot + 7 * DAY, volume=1000)
    assert feats is not None
    assert feats["price"] == 0.4
    assert abs(feats["extremity"] - 0.1) < 1e-12
    assert feats["mom_1d"] == 0.0  # flat history
    assert abs(feats["vol_7d"]) < 1e-9
    assert abs(feats["log_days_left"] - math.log1p(7)) < 1e-9


def test_snapshot_after_end_returns_none():
    points = make_history(10, 0.4)
    assert compute_features(points, snapshot_ts=10 * DAY, end_ts=5 * DAY, volume=1000) is None


def test_vector_matches_order():
    points = make_history(10, 0.4)
    feats = compute_features(points, 9 * DAY, 16 * DAY, 1000)
    vec = to_vector(feats)
    assert len(vec) == len(FEATURE_ORDER)
    assert vec[0] == feats["price"]

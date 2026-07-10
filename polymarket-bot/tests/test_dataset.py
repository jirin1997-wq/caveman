from polymarket_bot.dataset import build_samples
from polymarket_bot.features import DAY


def make_market(end_days: float = 60, winner_index: int = 0):
    return {
        "id": "m1",
        "end_ts": end_days * DAY,
        "volume": 50_000,
        "winner_index": winner_index,
        "token_ids": ["tok-yes", "tok-no"],
    }


def test_build_samples_labels_and_horizons():
    market = make_market(winner_index=0)
    points = [(i * DAY / 4, 0.6) for i in range(240)]  # 60 days of data
    samples = build_samples(market, points, horizons_days=[1, 7, 30])
    assert len(samples) == 3
    assert all(s["label"] == 1 for s in samples)
    assert {s["horizon_days"] for s in samples} == {1, 7, 30}
    for s in samples:
        assert s["snapshot_ts"] == market["end_ts"] - s["horizon_days"] * DAY


def test_build_samples_no_winner_loses_label():
    market = make_market(winner_index=1)
    points = [(i * DAY / 4, 0.6) for i in range(240)]
    samples = build_samples(market, points, horizons_days=[7])
    assert samples[0]["label"] == 0


def test_horizon_beyond_history_skipped():
    market = make_market(end_days=10)
    points = [(i * DAY / 4, 0.5) for i in range(8 * 4)]  # only first 8 days
    # 30-day horizon → snapshot before history starts → too few visible points
    samples = build_samples(market, points, horizons_days=[30])
    assert samples == []

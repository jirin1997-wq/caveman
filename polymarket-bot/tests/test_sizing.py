from polymarket_bot.sizing import kelly_fraction, position_size


def test_kelly_zero_when_no_edge():
    assert kelly_fraction(0.5, 0.5) == 0.0
    assert kelly_fraction(0.4, 0.5) == 0.0


def test_kelly_known_value():
    # p=0.6, cost=0.5 → f* = (0.6-0.5)/(1-0.5) = 0.2
    assert abs(kelly_fraction(0.6, 0.5) - 0.2) < 1e-12


def test_kelly_degenerate_costs():
    assert kelly_fraction(0.9, 0.0) == 0.0
    assert kelly_fraction(0.9, 1.0) == 0.0
    assert kelly_fraction(0.9, 1.5) == 0.0


def test_kelly_grows_with_probability():
    assert kelly_fraction(0.8, 0.5) > kelly_fraction(0.6, 0.5)


def test_position_size_respects_cap():
    # full kelly would be huge; cap must bind
    stake = position_size(1000, 0.9, 0.5, kelly_scale=1.0, max_position_frac=0.05)
    assert stake == 1000 * 0.05


def test_position_size_zero_edge():
    assert position_size(1000, 0.5, 0.6, kelly_scale=0.25, max_position_frac=0.05) == 0.0


def test_position_size_negative_bankroll():
    assert position_size(-100, 0.9, 0.5, kelly_scale=0.25, max_position_frac=0.05) == 0.0

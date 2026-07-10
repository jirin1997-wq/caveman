from polymarket_bot.config import Settings
from polymarket_bot.risk import RiskManager
from polymarket_bot.strategy import decide


def cfg(**overrides) -> Settings:
    s = Settings()
    s.fee_bps = 100
    s.edge_threshold = 0.05
    s.kelly_scale = 0.25
    s.max_position_frac = 0.05
    s.max_exposure_frac = 0.5
    s.daily_loss_limit_frac = 0.05
    s.min_volume = 10_000
    for k, v in overrides.items():
        setattr(s, k, v)
    return s


def test_decide_no_edge():
    assert decide(p_model_yes=0.52, yes_price=0.50, bankroll=1000, cfg=cfg()) is None


def test_decide_buys_yes_on_underpriced_yes():
    d = decide(p_model_yes=0.70, yes_price=0.50, bankroll=1000, cfg=cfg())
    assert d is not None and d.side == 0
    assert d.stake > 0
    assert d.edge >= 0.05


def test_decide_buys_no_on_overpriced_yes():
    d = decide(p_model_yes=0.30, yes_price=0.50, bankroll=1000, cfg=cfg())
    assert d is not None and d.side == 1
    assert abs(d.raw_price - 0.5) < 1e-9


def test_decide_fee_kills_marginal_edge():
    # 6% raw edge at a high price: fee of 5% of cost pushes it under the 5% threshold
    assert decide(p_model_yes=0.96, yes_price=0.90, bankroll=1000, cfg=cfg(fee_bps=500)) is None


def test_risk_blocks_low_volume():
    r = RiskManager(cfg(), bankroll=1000)
    ok, reason = r.check_trade(stake=10, market_volume=500, open_exposure=0, bankroll=1000, now_ts=0)
    assert not ok and "volume" in reason


def test_risk_exposure_cap():
    r = RiskManager(cfg(), bankroll=1000)
    ok, reason = r.check_trade(stake=40, market_volume=50_000, open_exposure=490, bankroll=1000, now_ts=0)
    assert not ok and "exposure" in reason


def test_kill_switch_trips_and_resets_next_day():
    r = RiskManager(cfg(), bankroll=1000)
    r.record_pnl(-60, now_ts=1000)  # > 5% of 1000
    assert r.kill_switch_active(1000)
    ok, reason = r.check_trade(stake=10, market_volume=50_000, open_exposure=0, bankroll=940, now_ts=2000)
    assert not ok and "kill-switch" in reason
    assert not r.kill_switch_active(1000 + 86400)  # next UTC day resets

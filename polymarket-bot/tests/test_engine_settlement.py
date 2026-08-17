"""Settlement behaviour of the shared engine — the zombie-position guard."""

import polymarket_bot.engine as engine
import polymarket_bot.gamma as gamma
from polymarket_bot.config import Settings
from polymarket_bot.ledger import Ledger
from polymarket_bot.risk import RiskManager


def make(tmp_path):
    led = Ledger(tmp_path / "l.json", starting_cash=1000)
    led.open_position("m1", "q", side=0, token_id="t", stake=100, cost=0.5, p_model=0.7, now_ts=0)
    risk = RiskManager(Settings(), bankroll=1000, state=led.risk_state)
    return led, risk


def test_resolved_position_settles(tmp_path, monkeypatch):
    led, risk = make(tmp_path)
    monkeypatch.setattr(engine.gamma, "market_resolution", lambda _: (gamma.STATUS_RESOLVED, 0))
    engine.settle_positions(led, risk, now_ts=10)
    assert not led.has_position("m1")
    assert led.cash == 1100
    assert risk.day_pnl == 100


def test_voided_position_is_refunded_not_left_open(tmp_path, monkeypatch):
    led, risk = make(tmp_path)
    monkeypatch.setattr(engine.gamma, "market_resolution", lambda _: (gamma.STATUS_VOID, None))
    engine.settle_positions(led, risk, now_ts=10)
    assert not led.has_position("m1")
    assert led.cash == 1000
    assert led.open_exposure() == 0


def test_failed_fetch_leaves_position_untouched(tmp_path, monkeypatch):
    led, risk = make(tmp_path)
    monkeypatch.setattr(engine.gamma, "market_resolution", lambda _: (gamma.STATUS_UNKNOWN, None))
    engine.settle_positions(led, risk, now_ts=10)
    assert led.has_position("m1")
    assert led.cash == 900


def test_open_market_leaves_position_untouched(tmp_path, monkeypatch):
    led, risk = make(tmp_path)
    monkeypatch.setattr(engine.gamma, "market_resolution", lambda _: (gamma.STATUS_OPEN, None))
    engine.settle_positions(led, risk, now_ts=10)
    assert led.has_position("m1")

from polymarket_bot.ledger import Ledger


def test_open_settle_win(tmp_path):
    led = Ledger(tmp_path / "l.json", starting_cash=1000)
    led.open_position("m1", "q", side=0, token_id="t", stake=100, cost=0.5, p_model=0.7, now_ts=0)
    assert led.cash == 900
    assert led.open_exposure() == 100
    pnl = led.settle("m1", winner_index=0, now_ts=10)
    assert pnl == 100  # 200 shares * $1 - $100 stake
    assert led.cash == 1100


def test_open_settle_loss(tmp_path):
    led = Ledger(tmp_path / "l.json", starting_cash=1000)
    led.open_position("m1", "q", side=0, token_id="t", stake=100, cost=0.5, p_model=0.7, now_ts=0)
    pnl = led.settle("m1", winner_index=1, now_ts=10)
    assert pnl == -100
    assert led.cash == 900


def test_voided_market_refunds(tmp_path):
    led = Ledger(tmp_path / "l.json", starting_cash=1000)
    led.open_position("m1", "q", side=0, token_id="t", stake=100, cost=0.5, p_model=0.7, now_ts=0)
    pnl = led.settle("m1", winner_index=None, now_ts=10)
    assert pnl == 0
    assert led.cash == 1000


def test_persistence_roundtrip(tmp_path):
    path = tmp_path / "l.json"
    led = Ledger(path, starting_cash=1000)
    led.open_position("m1", "q", side=1, token_id="t", stake=50, cost=0.25, p_model=0.4, now_ts=0)
    led.save()
    led2 = Ledger(path, starting_cash=999)  # starting_cash ignored when file exists
    assert led2.cash == 950
    assert led2.has_position("m1")
    assert led2.positions["m1"]["shares"] == 200

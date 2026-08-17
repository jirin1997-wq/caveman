"""Live-order fill interpretation — never let an unread response become a fake position."""

import pytest

from polymarket_bot.clob import round_to_tick
from polymarket_bot.live import ReconcileRequired, interpret_fill


def test_filled_order_uses_venue_amounts():
    resp = {"success": True, "status": "matched", "takingAmount": "95.5", "makingAmount": "50.0"}
    shares, spent = interpret_fill(resp, requested_shares=100, price=0.52)
    assert shares == 95.5
    assert spent == 50.0


def test_unmatched_order_records_nothing():
    resp = {"success": True, "status": "unmatched"}
    assert interpret_fill(resp, requested_shares=100, price=0.52) == (0.0, 0.0)


def test_rejected_order_records_nothing():
    resp = {"success": False, "errorMsg": "not enough balance"}
    assert interpret_fill(resp, requested_shares=100, price=0.52) == (0.0, 0.0)


def test_matched_without_sizes_falls_back_to_requested():
    resp = {"success": True, "status": "matched"}
    shares, spent = interpret_fill(resp, requested_shares=100, price=0.50)
    assert shares == 100
    assert spent == 50.0


def test_unreadable_response_raises_rather_than_guessing():
    with pytest.raises(ReconcileRequired):
        interpret_fill({"success": True, "status": "who knows"}, requested_shares=100, price=0.5)
    with pytest.raises(ReconcileRequired):
        interpret_fill("total garbage", requested_shares=100, price=0.5)


def test_partial_fill_derives_spend_when_absent():
    resp = {"success": True, "status": "matched", "takingAmount": "40"}
    shares, spent = interpret_fill(resp, requested_shares=100, price=0.25)
    assert shares == 40
    assert spent == 10.0


@pytest.mark.parametrize(
    "price,tick,expected",
    [
        (0.5234, 0.01, 0.52),
        (0.5234, 0.001, 0.523),
        (0.999, 0.01, 0.99),
        (0.0001, 0.01, 0.01),
        (1.5, 0.01, 0.99),
    ],
)
def test_round_to_tick(price, tick, expected):
    assert round_to_tick(price, tick) == pytest.approx(expected)


def test_round_to_tick_handles_bad_tick():
    assert 0 < round_to_tick(0.5, 0.0) < 1

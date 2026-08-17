import json

import polymarket_bot.gamma as gamma


def raw_market(**overrides):
    m = {
        "id": 42,
        "question": "Will X happen?",
        "slug": "will-x",
        "endDate": "2025-01-01T00:00:00Z",
        "volumeNum": 25_000,
        "outcomes": json.dumps(["Yes", "No"]),
        "clobTokenIds": json.dumps(["tok-yes", "tok-no"]),
        "closed": False,
    }
    m.update(overrides)
    return m


def test_normalize_open_market():
    m = gamma.normalize_market(raw_market())
    assert m is not None
    assert m["id"] == "42"
    assert m["token_ids"] == ["tok-yes", "tok-no"]
    assert m["winner_index"] is None
    assert m["volume"] == 25_000


def test_normalize_resolved_yes():
    m = gamma.normalize_market(raw_market(closed=True, outcomePrices=json.dumps(["1", "0"])))
    assert m["winner_index"] == 0


def test_normalize_resolved_no():
    m = gamma.normalize_market(raw_market(closed=True, outcomePrices=json.dumps(["0", "1"])))
    assert m["winner_index"] == 1


def test_normalize_rejects_voided_closed_market():
    m = gamma.normalize_market(raw_market(closed=True, outcomePrices=json.dumps(["0.5", "0.5"])))
    assert m is None


def test_normalize_rejects_non_binary():
    m = gamma.normalize_market(raw_market(outcomes=json.dumps(["A", "B", "C"])))
    assert m is None


def test_normalize_rejects_missing_end_date():
    assert gamma.normalize_market(raw_market(endDate=None)) is None


def test_is_tradable_flags():
    assert gamma._is_tradable(raw_market())
    assert not gamma._is_tradable(raw_market(archived=True))
    assert not gamma._is_tradable(raw_market(active=False))
    assert not gamma._is_tradable(raw_market(enableOrderBook=False))
    assert not gamma._is_tradable(raw_market(acceptingOrders=False))


def test_market_resolution_distinguishes_void_from_failure(monkeypatch):
    """The critical split: a voided market must settle, a failed fetch must not."""
    monkeypatch.setattr(gamma, "_get", lambda path, params: raw_market(
        closed=True, outcomePrices=json.dumps(["0.5", "0.5"])))
    assert gamma.market_resolution("42") == (gamma.STATUS_VOID, None)

    monkeypatch.setattr(gamma, "_get", lambda path, params: raw_market(
        closed=True, outcomePrices=json.dumps(["1", "0"])))
    assert gamma.market_resolution("42") == (gamma.STATUS_RESOLVED, 0)

    monkeypatch.setattr(gamma, "_get", lambda path, params: raw_market(closed=False))
    assert gamma.market_resolution("42") == (gamma.STATUS_OPEN, None)

    def boom(path, params):
        import requests
        raise requests.RequestException("network down")

    monkeypatch.setattr(gamma, "_get", boom)
    assert gamma.market_resolution("42") == (gamma.STATUS_UNKNOWN, None)


def test_market_resolution_unknown_on_garbage_response(monkeypatch):
    monkeypatch.setattr(gamma, "_get", lambda path, params: ["not", "a", "dict"])
    assert gamma.market_resolution("42") == (gamma.STATUS_UNKNOWN, None)

"""Gamma API client — market metadata (questions, outcomes, volumes, resolution).

Docs: https://docs.polymarket.com/  (Gamma Markets API)
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Optional, Tuple

import requests

from .config import GAMMA_HOST

_session = requests.Session()
_session.headers["User-Agent"] = "polymarket-bot/0.1 (research)"

# Resolution statuses returned by market_resolution().
STATUS_UNKNOWN = "unknown"   # fetch failed — retry later, do NOT touch the position
STATUS_OPEN = "open"         # still trading
STATUS_RESOLVED = "resolved" # settled with a definite winner
STATUS_VOID = "void"         # closed but no clean winner (voided / 50-50) — refund stakes


def _get(path: str, params: dict[str, Any]) -> Any:
    for attempt in range(4):
        try:
            resp = _session.get(f"{GAMMA_HOST}{path}", params=params, timeout=30)
            if resp.status_code == 429:
                time.sleep(2 ** (attempt + 1))
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def _parse_json_field(raw: Any) -> list:
    """Gamma serializes list fields (outcomes, clobTokenIds, outcomePrices) as JSON strings."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []
    return []


def _parse_end_date(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _winner_from_prices(m: dict) -> Optional[int]:
    """Winning outcome index from a resolved market's settled prices, or None if ambiguous.

    Resolved markets settle the winning outcome token at 1 and the loser at 0.
    """
    try:
        prices = [float(p) for p in _parse_json_field(m.get("outcomePrices"))]
    except (TypeError, ValueError):
        return None
    if len(prices) != 2:
        return None
    if prices[0] > 0.99 and prices[1] < 0.01:
        return 0
    if prices[1] > 0.99 and prices[0] < 0.01:
        return 1
    return None


def _is_tradable(m: dict) -> bool:
    """Whether an open market can actually be traded right now.

    Gamma exposes several independent flags; a market can be `closed=false` yet
    archived, order-book-disabled, or not accepting orders. Scanning those wastes
    API calls and can produce signals the bot could never act on.
    """
    if m.get("archived"):
        return False
    if m.get("active") is False:
        return False
    if m.get("enableOrderBook") is False:
        return False
    if m.get("acceptingOrders") is False:
        return False
    return True


def normalize_market(m: dict) -> Optional[dict]:
    """Reduce a raw Gamma market to the fields the bot needs. None if unusable.

    Only binary (two-outcome) markets with CLOB token ids are kept. A closed market
    with no clean winner is rejected here (it cannot be a training sample); use
    market_resolution() when you need to tell "voided" apart from "fetch failed".
    """
    outcomes = _parse_json_field(m.get("outcomes"))
    token_ids = _parse_json_field(m.get("clobTokenIds"))
    end_ts = _parse_end_date(m.get("endDate"))
    if len(outcomes) != 2 or len(token_ids) != 2 or end_ts is None:
        return None

    closed = bool(m.get("closed"))
    winner_index = _winner_from_prices(m) if closed else None
    if closed and winner_index is None:
        return None  # voided / ambiguous — unusable as a labeled sample

    return {
        "id": str(m.get("id")),
        "question": m.get("question", ""),
        "slug": m.get("slug", ""),
        "end_ts": end_ts,
        "volume": float(m.get("volumeNum") or m.get("volume") or 0),
        "outcomes": outcomes,
        "token_ids": [str(t) for t in token_ids],
        "closed": closed,
        "winner_index": winner_index,
    }


def iter_markets(closed: bool, min_volume: float = 0.0, max_markets: int = 1000) -> Iterator[dict]:
    """Yield normalized markets ordered by volume (descending), paginated.

    For open markets, only actually-tradable ones are yielded (see _is_tradable).
    """
    offset, yielded, empty_pages = 0, 0, 0
    while yielded < max_markets:
        params = {
            "closed": "true" if closed else "false",
            "order": "volumeNum",
            "ascending": "false",
            "limit": 100,
            "offset": offset,
        }
        if min_volume > 0:
            params["volume_num_min"] = min_volume  # server-side filter, saves pages
        batch = _get("/markets", params)
        if not isinstance(batch, list) or not batch:
            return

        page_yield = 0
        for raw in batch:
            if not closed and not _is_tradable(raw):
                continue
            market = normalize_market(raw)
            if market is None or market["volume"] < min_volume:
                continue
            yield market
            yielded += 1
            page_yield += 1
            if yielded >= max_markets:
                return

        # Guard against ordering quirks handing back pages we filter to nothing forever.
        empty_pages = empty_pages + 1 if page_yield == 0 else 0
        if empty_pages >= 20:
            return
        offset += len(batch)
        time.sleep(0.3)  # be polite to the public API


def get_market(market_id: str) -> Optional[dict]:
    """Normalized market, or None if unavailable/unusable."""
    try:
        raw = _get(f"/markets/{market_id}", {})
    except requests.RequestException:
        return None
    return normalize_market(raw) if isinstance(raw, dict) else None


def market_resolution(market_id: str) -> Tuple[str, Optional[int]]:
    """(status, winner_index) for settling an open position.

    Distinguishes a failed fetch (STATUS_UNKNOWN — leave the position alone and retry)
    from a market that closed without a clean winner (STATUS_VOID — refund the stake).
    Without this split, voided markets would leave positions open forever, silently
    eating the exposure budget.
    """
    try:
        raw = _get(f"/markets/{market_id}", {})
    except requests.RequestException:
        return STATUS_UNKNOWN, None
    if not isinstance(raw, dict) or "closed" not in raw:
        return STATUS_UNKNOWN, None
    if not raw.get("closed"):
        return STATUS_OPEN, None
    winner = _winner_from_prices(raw)
    if winner is None:
        return STATUS_VOID, None
    return STATUS_RESOLVED, winner


def now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()

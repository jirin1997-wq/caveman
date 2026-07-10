"""Gamma API client — market metadata (questions, outcomes, volumes, resolution).

Docs: https://docs.polymarket.com/  (Gamma Markets API)
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

import requests

from .config import GAMMA_HOST

_session = requests.Session()
_session.headers["User-Agent"] = "polymarket-bot/0.1 (research)"


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


def normalize_market(m: dict) -> Optional[dict]:
    """Reduce a raw Gamma market to the fields the bot needs. None if unusable.

    Only binary (two-outcome) markets with CLOB token ids are kept.
    """
    outcomes = _parse_json_field(m.get("outcomes"))
    token_ids = _parse_json_field(m.get("clobTokenIds"))
    end_ts = _parse_end_date(m.get("endDate"))
    if len(outcomes) != 2 or len(token_ids) != 2 or end_ts is None:
        return None

    volume = float(m.get("volumeNum") or m.get("volume") or 0)

    winner_index = None
    if m.get("closed"):
        prices = [float(p) for p in _parse_json_field(m.get("outcomePrices")) or []]
        # Resolved markets settle the winning outcome token at 1, the loser at 0.
        if len(prices) == 2:
            if prices[0] > 0.99 and prices[1] < 0.01:
                winner_index = 0
            elif prices[1] > 0.99 and prices[0] < 0.01:
                winner_index = 1
        if winner_index is None:
            return None  # unresolved / ambiguous (e.g. 50-50 voided markets)

    return {
        "id": str(m.get("id")),
        "question": m.get("question", ""),
        "slug": m.get("slug", ""),
        "end_ts": end_ts,
        "volume": volume,
        "outcomes": outcomes,
        "token_ids": [str(t) for t in token_ids],
        "closed": bool(m.get("closed")),
        "winner_index": winner_index,
    }


def iter_markets(closed: bool, min_volume: float = 0.0, max_markets: int = 1000) -> Iterator[dict]:
    """Yield normalized markets ordered by volume (descending), paginated."""
    offset, yielded = 0, 0
    while yielded < max_markets:
        batch = _get(
            "/markets",
            {
                "closed": str(closed).lower(),
                "order": "volumeNum",
                "ascending": "false",
                "limit": 100,
                "offset": offset,
            },
        )
        if not batch:
            return
        for raw in batch:
            market = normalize_market(raw)
            if market is None or market["volume"] < min_volume:
                continue
            yield market
            yielded += 1
            if yielded >= max_markets:
                return
        offset += len(batch)
        time.sleep(0.3)  # be polite to the public API


def get_market(market_id: str) -> Optional[dict]:
    try:
        raw = _get(f"/markets/{market_id}", {})
    except requests.RequestException:
        return None
    return normalize_market(raw) if isinstance(raw, dict) else None


def now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()

"""CLOB API client — price histories and current midpoints (read-only, no auth needed).

Docs: https://docs.polymarket.com/  (CLOB API)
"""

from __future__ import annotations

import time
from typing import Optional

import requests

from .config import CLOB_HOST

_session = requests.Session()
_session.headers["User-Agent"] = "polymarket-bot/0.1 (research)"


def _get(path: str, params: dict) -> Optional[dict]:
    for attempt in range(4):
        try:
            resp = _session.get(f"{CLOB_HOST}{path}", params=params, timeout=30)
            if resp.status_code == 429:
                time.sleep(2 ** (attempt + 1))
                continue
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            if attempt == 3:
                return None
            time.sleep(2 ** attempt)
    return None


def price_history(token_id: str, interval: str = "max", fidelity_minutes: int = 360) -> list[tuple[float, float]]:
    """Return [(unix_ts, price), ...] for a CLOB token, oldest first.

    interval: one of 1h, 6h, 1d, 1w, 1m, max. fidelity_minutes = candle spacing.
    """
    data = _get("/prices-history", {"market": token_id, "interval": interval, "fidelity": fidelity_minutes})
    if not data or "history" not in data:
        return []
    points = [(float(p["t"]), float(p["p"])) for p in data["history"] if "t" in p and "p" in p]
    points.sort(key=lambda x: x[0])
    return points


def midpoint(token_id: str) -> Optional[float]:
    """Current midpoint price of a token, or None if unavailable."""
    data = _get("/midpoint", {"token_id": token_id})
    if not data:
        return None
    try:
        return float(data["mid"])
    except (KeyError, TypeError, ValueError):
        return None

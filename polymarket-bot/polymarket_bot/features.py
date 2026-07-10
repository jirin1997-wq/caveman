"""Feature engineering: turn a price history snapshot into a model input vector.

All features use only data available at snapshot time — no lookahead.
"""

from __future__ import annotations

import math
from typing import Optional

DAY = 86400.0

# Canonical feature order — model training and inference must both use this.
FEATURE_ORDER = [
    "price",
    "extremity",
    "log_days_left",
    "log_volume",
    "mom_1d",
    "mom_7d",
    "vol_7d",
    "log_age_days",
]

MIN_POINTS = 5


def _price_at(points: list[tuple[float, float]], ts: float) -> float:
    """Last known price at or before ts (points sorted ascending)."""
    result = points[0][1]
    for t, p in points:
        if t > ts:
            break
        result = p
    return result


def compute_features(
    points: list[tuple[float, float]],
    snapshot_ts: float,
    end_ts: float,
    volume: float,
) -> Optional[dict[str, float]]:
    """Feature dict for one (market, snapshot) pair, or None if history is too thin."""
    visible = [(t, p) for t, p in points if t <= snapshot_ts]
    if len(visible) < MIN_POINTS or end_ts <= snapshot_ts:
        return None

    price = visible[-1][1]
    if not (0.0 < price < 1.0):
        return None

    week_ago = snapshot_ts - 7 * DAY
    recent = [p for t, p in visible if t >= week_ago]
    if len(recent) >= 2:
        mean = sum(recent) / len(recent)
        vol_7d = math.sqrt(sum((p - mean) ** 2 for p in recent) / (len(recent) - 1))
    else:
        vol_7d = 0.0

    return {
        "price": price,
        "extremity": abs(price - 0.5),
        "log_days_left": math.log1p((end_ts - snapshot_ts) / DAY),
        "log_volume": math.log1p(max(volume, 0.0)),
        "mom_1d": price - _price_at(visible, snapshot_ts - 1 * DAY),
        "mom_7d": price - _price_at(visible, week_ago),
        "vol_7d": vol_7d,
        "log_age_days": math.log1p(max(snapshot_ts - visible[0][0], 0.0) / DAY),
    }


def to_vector(features: dict[str, float]) -> list[float]:
    return [features[name] for name in FEATURE_ORDER]

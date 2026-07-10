"""Position sizing: fractional Kelly with hard caps.

Buying a binary share at cost c that pays 1 if it wins, with win probability p,
has full-Kelly optimum f* = (p - c) / (1 - c) of bankroll. Full Kelly is far too
aggressive for a model whose probabilities are themselves noisy, so we scale it
down (kelly_scale, default 0.25) and cap it (max_position_frac).
"""

from __future__ import annotations


def kelly_fraction(p: float, cost: float) -> float:
    """Full-Kelly bankroll fraction for buying at `cost` with win probability `p`.

    Returns 0 for non-positive edge or degenerate costs.
    """
    if not (0.0 < cost < 1.0):
        return 0.0
    p = min(max(p, 0.0), 1.0)
    f = (p - cost) / (1.0 - cost)
    return max(f, 0.0)


def position_size(bankroll: float, p: float, cost: float, kelly_scale: float, max_position_frac: float) -> float:
    """Dollar stake for one trade. 0 if there is no positive edge."""
    f = kelly_fraction(p, cost) * kelly_scale
    f = min(f, max_position_frac)
    return max(bankroll, 0.0) * f

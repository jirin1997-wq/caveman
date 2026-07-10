"""Trade decision core, shared by backtest, paper trading and live trading.

Convention: the model predicts P(outcome token 0 wins) — "YES". A positive edge on
YES means buy token 0; a positive edge on NO means buy token 1 at cost (1 - price).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .config import Settings
from .sizing import position_size


@dataclass
class Decision:
    side: int          # index into market["token_ids"] / market["outcomes"]
    p_win: float       # model probability the bought token wins
    cost: float        # effective cost per share incl. fee+slippage
    raw_price: float   # quoted price of the bought token before costs
    edge: float        # p_win - cost
    stake: float       # dollars to commit


def decide(p_model_yes: float, yes_price: float, bankroll: float, cfg: Settings) -> Optional[Decision]:
    """Return a Decision or None. Considers both sides, picks the better edge."""
    if not (0.0 < yes_price < 1.0):
        return None

    fee_mult = 1.0 + cfg.fee_bps / 10_000.0
    candidates = []
    for side, p_win, raw_price in ((0, p_model_yes, yes_price), (1, 1.0 - p_model_yes, 1.0 - yes_price)):
        cost = raw_price * fee_mult
        if cost >= 1.0:
            continue
        edge = p_win - cost
        if edge >= cfg.edge_threshold:
            candidates.append((edge, side, p_win, cost, raw_price))

    if not candidates:
        return None

    edge, side, p_win, cost, raw_price = max(candidates)
    stake = position_size(bankroll, p_win, cost, cfg.kelly_scale, cfg.max_position_frac)
    if stake <= 0:
        return None
    return Decision(side=side, p_win=p_win, cost=cost, raw_price=raw_price, edge=edge, stake=stake)

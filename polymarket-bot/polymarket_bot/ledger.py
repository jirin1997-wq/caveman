"""JSON ledger for paper and live trading: cash, open positions, trade log."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


class Ledger:
    def __init__(self, path: str | Path, starting_cash: float):
        self.path = Path(path)
        if self.path.is_file():
            state = json.loads(self.path.read_text(encoding="utf-8"))
        else:
            state = {"cash": starting_cash, "starting_cash": starting_cash, "positions": {}, "trades": []}
        self.state = state

    # ---- accounting -------------------------------------------------------

    @property
    def cash(self) -> float:
        return self.state["cash"]

    @property
    def positions(self) -> dict:
        return self.state["positions"]

    def open_exposure(self) -> float:
        return sum(pos["stake"] for pos in self.positions.values())

    def has_position(self, market_id: str) -> bool:
        return market_id in self.positions

    def open_position(
        self,
        market_id: str,
        question: str,
        side: int,
        token_id: str,
        stake: float,
        cost: float,
        p_model: float,
        now_ts: float,
    ) -> None:
        shares = stake / cost
        self.state["cash"] -= stake
        self.positions[market_id] = {
            "question": question,
            "side": side,
            "token_id": token_id,
            "stake": stake,
            "shares": shares,
            "cost": cost,
            "p_model": p_model,
            "opened_ts": now_ts,
        }
        self.state["trades"].append(
            {"ts": now_ts, "type": "open", "market_id": market_id, "side": side, "stake": stake, "cost": cost, "p_model": p_model}
        )

    def settle(self, market_id: str, winner_index: Optional[int], now_ts: float) -> float:
        """Realize a resolved position. Returns PnL. winner_index=None → voided, refund stake."""
        pos = self.positions.pop(market_id)
        if winner_index is None:
            proceeds = pos["stake"]
        else:
            proceeds = pos["shares"] if pos["side"] == winner_index else 0.0
        self.state["cash"] += proceeds
        pnl = proceeds - pos["stake"]
        self.state["trades"].append(
            {"ts": now_ts, "type": "settle", "market_id": market_id, "winner_index": winner_index, "pnl": pnl}
        )
        return pnl

    def equity(self, marks: dict[str, float] | None = None) -> float:
        """Cash + positions valued at current marks (fallback: entry cost)."""
        marks = marks or {}
        value = self.state["cash"]
        for market_id, pos in self.positions.items():
            mark = marks.get(market_id, pos["cost"])
            value += pos["shares"] * mark
        return value

    # ---- persistence ------------------------------------------------------

    def save(self) -> None:
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.state, indent=2), encoding="utf-8")
        tmp.replace(self.path)

"""Risk manager: hard limits that no strategy signal can override.

- per-market position cap
- total open exposure cap
- daily loss kill-switch: once tripped, no new trades until the next UTC day
- minimum market volume (liquidity floor)
- cash sufficiency

The daily-loss state lives in a caller-owned dict so it can be persisted with the
ledger. Without persistence, restarting the process would silently clear a tripped
kill-switch — the one moment you least want the bot trading again.
"""

from __future__ import annotations

from typing import Optional

from .config import Settings

DAY = 86400.0


class RiskManager:
    def __init__(self, cfg: Settings, bankroll: float, state: Optional[dict] = None):
        """`state` is persisted across restarts (see Ledger.risk_state)."""
        self.cfg = cfg
        self.initial_bankroll = bankroll
        self.state = state if state is not None else {}
        self.state.setdefault("day", None)
        self.state.setdefault("day_pnl", 0.0)

    def _roll_day(self, now_ts: float) -> None:
        day = int(now_ts // DAY)
        if day != self.state["day"]:
            self.state["day"] = day
            self.state["day_pnl"] = 0.0

    @property
    def day_pnl(self) -> float:
        return self.state["day_pnl"]

    def record_pnl(self, pnl: float, now_ts: float) -> None:
        self._roll_day(now_ts)
        self.state["day_pnl"] += pnl

    def kill_switch_active(self, now_ts: float) -> bool:
        self._roll_day(now_ts)
        return self.state["day_pnl"] <= -self.cfg.daily_loss_limit_frac * self.initial_bankroll

    def check_trade(
        self,
        stake: float,
        market_volume: float,
        open_exposure: float,
        bankroll: float,
        now_ts: float,
        cash: Optional[float] = None,
    ) -> tuple[bool, str]:
        """(allowed, reason). Reason is human-readable when blocked.

        `bankroll` is the sizing base (equity: cash + open positions at cost) and must
        be the same value passed to the sizing step, otherwise caps computed here
        disagree with the stake that was sized. `cash` is the spendable balance;
        defaults to `bankroll` for callers with no separate cash notion (backtest).
        """
        if cash is None:
            cash = bankroll
        if self.kill_switch_active(now_ts):
            return False, "daily loss kill-switch active"
        if market_volume < self.cfg.min_volume:
            return False, f"market volume {market_volume:.0f} below floor {self.cfg.min_volume:.0f}"
        if stake > self.cfg.max_position_frac * bankroll * 1.001:
            return False, "stake exceeds per-market cap"
        if open_exposure + stake > self.cfg.max_exposure_frac * bankroll:
            return False, "total exposure cap reached"
        if stake > cash:
            return False, "insufficient cash"
        return True, "ok"

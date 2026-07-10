"""Risk manager: hard limits that no strategy signal can override.

- per-market position cap (enforced upstream by sizing, re-checked here)
- total open exposure cap
- daily loss kill-switch: once tripped, no new trades until the next UTC day
- minimum market volume (liquidity floor)
"""

from __future__ import annotations

from .config import Settings

DAY = 86400.0


class RiskManager:
    def __init__(self, cfg: Settings, bankroll: float):
        self.cfg = cfg
        self.initial_bankroll = bankroll
        self._day: int | None = None
        self._day_pnl = 0.0

    def _roll_day(self, now_ts: float) -> None:
        day = int(now_ts // DAY)
        if day != self._day:
            self._day = day
            self._day_pnl = 0.0

    def record_pnl(self, pnl: float, now_ts: float) -> None:
        self._roll_day(now_ts)
        self._day_pnl += pnl

    def kill_switch_active(self, now_ts: float) -> bool:
        self._roll_day(now_ts)
        return self._day_pnl <= -self.cfg.daily_loss_limit_frac * self.initial_bankroll

    def check_trade(
        self,
        stake: float,
        market_volume: float,
        open_exposure: float,
        bankroll: float,
        now_ts: float,
    ) -> tuple[bool, str]:
        """(allowed, reason). Reason is human-readable when blocked."""
        if self.kill_switch_active(now_ts):
            return False, "daily loss kill-switch active"
        if market_volume < self.cfg.min_volume:
            return False, f"market volume {market_volume:.0f} below floor {self.cfg.min_volume:.0f}"
        if stake > self.cfg.max_position_frac * bankroll * 1.001:
            return False, "stake exceeds per-market cap"
        if open_exposure + stake > self.cfg.max_exposure_frac * bankroll:
            return False, "total exposure cap reached"
        if stake > bankroll:
            return False, "insufficient bankroll"
        return True, "ok"

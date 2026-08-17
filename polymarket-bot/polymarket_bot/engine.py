"""Shared trading engine used by both paper and live trading.

Paper and live differ only in what they do with an approved signal (record a
simulated fill vs. place a real order). Everything before that — settlement,
feature computation, model inference, risk checks — lives here so the two modes
cannot drift apart. A paper run that proved itself must exercise the same code
path the live run will take, or its track record means nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from . import clob, gamma
from .config import Settings
from .features import compute_features, to_vector
from .ledger import Ledger
from .risk import RiskManager
from .strategy import Decision, decide

# Price history window for live inference. Polymarket's interval codes are
# 1h/6h/1d/1w/1m/max, where "1m" means one month — long enough for the 7-day
# momentum and volatility features, which "1d" would leave undefined.
LIVE_HISTORY_INTERVAL = "1m"
LIVE_HISTORY_FIDELITY_MIN = 60


@dataclass
class Signal:
    market: dict
    decision: Decision


def load_model(model_dir: str):
    import joblib

    path = Path(model_dir) / "model.joblib"
    if not path.is_file():
        raise SystemExit(f"error: {path} not found — run 'python -m polymarket_bot.train' first")
    return joblib.load(path)["model"]


def settle_positions(ledger: Ledger, risk: RiskManager, now_ts: float) -> None:
    """Close out positions whose markets have resolved or been voided.

    A failed fetch is left alone and retried on the next scan. A market that closed
    without a clean winner is settled as voided (stake refunded) — otherwise those
    positions would sit open forever, permanently consuming the exposure budget.
    """
    for market_id in list(ledger.positions.keys()):
        status, winner_index = gamma.market_resolution(market_id)
        if status in (gamma.STATUS_UNKNOWN, gamma.STATUS_OPEN):
            continue
        # STATUS_VOID → winner_index is None → Ledger.settle refunds the stake.
        pnl = ledger.settle(market_id, winner_index, now_ts)
        risk.record_pnl(pnl, now_ts)
        label = "voided" if status == gamma.STATUS_VOID else f"winner={winner_index}"
        print(f"settled {market_id} ({label}): PnL {pnl:+.2f}")


def find_signals(model, ledger: Ledger, risk: RiskManager, cfg: Settings, top: int) -> Iterator[Signal]:
    """Yield risk-approved trade signals for the most liquid open markets."""
    now_ts = gamma.now_ts()
    for market in gamma.iter_markets(closed=False, min_volume=cfg.min_volume, max_markets=top):
        if ledger.has_position(market["id"]) or market["end_ts"] <= now_ts:
            continue
        yes_token = market["token_ids"][0]
        mid = clob.midpoint(yes_token)
        if mid is None:
            continue
        points = clob.price_history(yes_token, LIVE_HISTORY_INTERVAL, LIVE_HISTORY_FIDELITY_MIN)
        feats = compute_features(points + [(now_ts, mid)], now_ts, market["end_ts"], market["volume"])
        if feats is None:
            continue

        p_model = float(model.predict_proba([to_vector(feats)])[0][1])
        base = ledger.sizing_base()
        decision = decide(p_model, mid, base, cfg)
        if decision is None:
            continue

        ok, reason = risk.check_trade(
            stake=decision.stake,
            market_volume=market["volume"],
            open_exposure=ledger.open_exposure(),
            bankroll=base,
            now_ts=now_ts,
            cash=ledger.cash,
        )
        if not ok:
            print(f"blocked ({reason}): {market['question'][:60]}")
            continue

        yield Signal(market=market, decision=decision)

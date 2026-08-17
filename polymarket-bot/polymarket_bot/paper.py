"""Phase 2: paper trading — live prices, simulated money, no orders sent anywhere.

Each scan: settle resolved/voided positions → find risk-approved signals on the most
liquid open markets → record simulated fills in ledger.paper.json → sleep.

Run for weeks before even thinking about live trading. Judge it on realized PnL,
drawdown and bet count in the ledger — not on the backtest.

Usage:
  python -m polymarket_bot.paper [--bankroll 1000] [--interval 900] [--top 50] [--once]
"""

from __future__ import annotations

import argparse
import sys
import time

from . import gamma
from .config import get_settings
from .engine import find_signals, load_model, settle_positions
from .ledger import Ledger
from .risk import RiskManager


def scan_once(model, ledger: Ledger, risk: RiskManager, cfg, top: int) -> None:
    now_ts = gamma.now_ts()
    settle_positions(ledger, risk, now_ts)

    if risk.kill_switch_active(now_ts):
        print(f"kill-switch active for today (day PnL {risk.day_pnl:+.2f}) — no new trades")
        ledger.save()
        return

    for signal in find_signals(model, ledger, risk, cfg, top):
        market, decision = signal.market, signal.decision
        ledger.open_position(
            market["id"], market["question"], decision.side, market["token_ids"][decision.side],
            decision.stake, decision.cost, decision.p_win, gamma.now_ts(),
        )
        print(
            f"PAPER BUY {market['outcomes'][decision.side]} @ {decision.raw_price:.3f} "
            f"(model {decision.p_win:.3f}, edge {decision.edge:+.3f}, stake ${decision.stake:.2f}) "
            f"— {market['question'][:60]}"
        )
        ledger.save()  # persist immediately so a crash cannot lose a recorded fill
        time.sleep(0.3)

    ledger.save()
    print(
        f"equity ${ledger.equity():,.2f} | cash ${ledger.cash:,.2f} | "
        f"open {len(ledger.positions)} | realized PnL {ledger.realized_pnl():+,.2f}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bankroll", type=float, default=1_000.0)
    parser.add_argument("--interval", type=int, default=900, help="seconds between scans")
    parser.add_argument("--top", type=int, default=50, help="how many most-liquid markets to scan")
    parser.add_argument("--model-dir", default="models")
    parser.add_argument("--ledger", default="ledger.paper.json")
    parser.add_argument("--once", action="store_true", help="single scan, then exit")
    args = parser.parse_args()

    cfg = get_settings()
    model = load_model(args.model_dir)
    ledger = Ledger(args.ledger, starting_cash=args.bankroll)
    # Limits key off the ledger's original bankroll, not this run's flag, so restarting
    # with a different --bankroll cannot quietly widen the daily loss allowance.
    risk = RiskManager(cfg, bankroll=ledger.starting_cash, state=ledger.risk_state)

    print(f"paper trading: bankroll ${ledger.starting_cash:,.2f}, scan every {args.interval}s, ledger → {args.ledger}")
    while True:
        try:
            scan_once(model, ledger, risk, cfg, args.top)
        except Exception as exc:  # keep the loop alive through transient API failures
            print(f"scan failed: {exc}", file=sys.stderr)
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())

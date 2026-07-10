"""Phase 2: paper trading — live prices, simulated money, no orders sent anywhere.

Loop: settle resolved positions → scan the most liquid active markets → compute
features from live history + midpoint → model probability → shared decision core
→ risk checks → record a simulated fill in ledger.paper.json → sleep.

Run for weeks before even thinking about live trading. Judge it on realized PnL,
drawdown and bet count in the ledger.

Usage:
  python -m polymarket_bot.paper [--bankroll 1000] [--interval 900] [--top 50] [--once]
"""

from __future__ import annotations

import argparse
import sys
import time

from . import clob, gamma
from .config import get_settings
from .features import compute_features, to_vector
from .ledger import Ledger
from .risk import RiskManager
from .strategy import decide


def load_model(model_dir: str):
    import joblib
    from pathlib import Path

    bundle = joblib.load(Path(model_dir) / "model.joblib")
    return bundle["model"]


def settle_resolved(ledger: Ledger, risk: RiskManager, now_ts: float) -> None:
    for market_id in list(ledger.positions.keys()):
        market = gamma.get_market(market_id)
        if market is None or not market["closed"]:
            continue
        pnl = ledger.settle(market_id, market["winner_index"], now_ts)
        risk.record_pnl(pnl, now_ts)
        print(f"settled {market_id}: PnL {pnl:+.2f}")


def scan_once(model, ledger: Ledger, risk: RiskManager, cfg, top: int) -> None:
    now_ts = gamma.now_ts()
    settle_resolved(ledger, risk, now_ts)

    if risk.kill_switch_active(now_ts):
        print("kill-switch active for today — no new trades")
        return

    for market in gamma.iter_markets(closed=False, min_volume=cfg.min_volume, max_markets=top):
        if ledger.has_position(market["id"]) or market["end_ts"] <= now_ts:
            continue
        yes_token = market["token_ids"][0]
        mid = clob.midpoint(yes_token)
        if mid is None:
            continue
        points = clob.price_history(yes_token, interval="1m", fidelity_minutes=60)
        feats = compute_features(points + [(now_ts, mid)], now_ts, market["end_ts"], market["volume"])
        if feats is None:
            continue

        p_model = float(model.predict_proba([to_vector(feats)])[0][1])
        bankroll = ledger.equity()
        decision = decide(p_model, mid, bankroll, cfg)
        if decision is None:
            continue

        ok, reason = risk.check_trade(decision.stake, market["volume"], ledger.open_exposure(), ledger.cash, now_ts)
        if not ok:
            print(f"blocked ({reason}): {market['question'][:60]}")
            continue

        ledger.open_position(
            market["id"], market["question"], decision.side, market["token_ids"][decision.side],
            decision.stake, decision.cost, decision.p_win, now_ts,
        )
        side_name = market["outcomes"][decision.side]
        print(
            f"PAPER BUY {side_name} @ {decision.raw_price:.3f} (model {decision.p_win:.3f}, "
            f"edge {decision.edge:+.3f}, stake ${decision.stake:.2f}) — {market['question'][:60]}"
        )
        time.sleep(0.3)

    ledger.save()
    print(f"equity ${ledger.equity():,.2f} | cash ${ledger.cash:,.2f} | open positions {len(ledger.positions)}")


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
    risk = RiskManager(cfg, bankroll=args.bankroll)

    print(f"paper trading: bankroll ${args.bankroll:,.2f}, scan every {args.interval}s, ledger → {args.ledger}")
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

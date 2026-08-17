"""Phase 1, step 4: walk-forward backtest on the held-out test period.

Only markets ending after the model's training cutoff are used. Bets are placed
chronologically by snapshot time, at most one bet per market (the earliest snapshot
that produces a signal), with fees/slippage and fractional-Kelly sizing from the
shared strategy core — and through the same RiskManager the live bot uses, so the
result reflects what the bot would actually have been allowed to do.

Usage:
  python -m polymarket_bot.backtest [--data-dir data] [--model-dir models]
                                    [--bankroll 1000] [--edge 0.05] [--kelly-scale 0.25]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import joblib
import numpy as np

from .config import get_settings
from .features import to_vector
from .risk import RiskManager
from .strategy import decide


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--model-dir", default="models")
    parser.add_argument("--bankroll", type=float, default=1_000.0)
    parser.add_argument("--edge", type=float, default=None, help="override edge threshold")
    parser.add_argument("--kelly-scale", type=float, default=None)
    args = parser.parse_args()

    if args.bankroll <= 0:
        print("error: --bankroll must be positive", file=sys.stderr)
        return 1

    cfg = get_settings()
    if args.edge is not None:
        cfg.edge_threshold = args.edge
    if args.kelly_scale is not None:
        cfg.kelly_scale = args.kelly_scale

    model_path = Path(args.model_dir) / "model.joblib"
    if not model_path.is_file():
        print(f"error: {model_path} not found — run train first", file=sys.stderr)
        return 1
    bundle = joblib.load(model_path)
    model, cutoff = bundle["model"], bundle["cutoff_end_ts"]

    dataset_path = Path(args.data_dir) / "dataset.jsonl"
    if not dataset_path.is_file():
        print(f"error: {dataset_path} not found — run dataset first", file=sys.stderr)
        return 1
    rows = [json.loads(line) for line in dataset_path.read_text(encoding="utf-8").splitlines()]
    test_rows = sorted((r for r in rows if r["end_ts"] > cutoff), key=lambda r: r["snapshot_ts"])
    if not test_rows:
        print("error: no test rows beyond the model's training cutoff", file=sys.stderr)
        return 1

    p_all = model.predict_proba(np.array([to_vector(r["features"]) for r in test_rows]))[:, 1]

    # Bets are placed at snapshot time and settled at market end — process in time order.
    cash = args.bankroll
    open_bets: list[tuple[float, float, float, int, int]] = []  # (end_ts, stake, cost, side, label)
    risk = RiskManager(cfg, bankroll=args.bankroll)
    traded_markets: set[str] = set()
    blocked = Counter()
    n_bets = n_wins = 0
    total_staked = 0.0
    peak = args.bankroll
    max_drawdown = 0.0

    def open_exposure() -> float:
        return sum(stake for _, stake, _, _, _ in open_bets)

    def sizing_base() -> float:
        # Same definition as Ledger.sizing_base(): cash + open positions at entry cost.
        return cash + open_exposure()

    def track_equity() -> None:
        nonlocal peak, max_drawdown
        eq = sizing_base()
        peak = max(peak, eq)
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - eq) / peak)

    def settle_due(now_ts: float) -> None:
        nonlocal cash, n_wins
        remaining = []
        for end_ts, stake, cost, side, label in open_bets:
            if end_ts <= now_ts:
                won = (side == 0 and label == 1) or (side == 1 and label == 0)
                proceeds = stake / cost if won else 0.0
                cash += proceeds
                risk.record_pnl(proceeds - stake, end_ts)
                n_wins += int(won)
            else:
                remaining.append((end_ts, stake, cost, side, label))
        open_bets[:] = remaining
        track_equity()

    for row, p_model in zip(test_rows, p_all):
        settle_due(row["snapshot_ts"])
        if row["market_id"] in traded_markets:
            continue
        base = sizing_base()
        decision = decide(float(p_model), row["features"]["price"], base, cfg)
        if decision is None:
            continue
        ok, reason = risk.check_trade(
            stake=decision.stake,
            market_volume=row["volume"],
            open_exposure=open_exposure(),
            bankroll=base,
            now_ts=row["snapshot_ts"],
            cash=cash,
        )
        if not ok:
            blocked[reason] += 1
            continue
        traded_markets.add(row["market_id"])
        cash -= decision.stake
        total_staked += decision.stake
        open_bets.append((row["end_ts"], decision.stake, decision.cost, decision.side, row["label"]))
        n_bets += 1
        track_equity()

    settle_due(float("inf"))

    roi = (cash - args.bankroll) / args.bankroll
    print(f"test markets available: {len({r['market_id'] for r in test_rows})}")
    print(f"bets placed:            {n_bets}")
    if n_bets:
        print(f"win rate:               {n_wins / n_bets:.1%}")
        print(f"total staked:           ${total_staked:,.2f}")
    print(f"final bankroll:         ${cash:,.2f}  (start ${args.bankroll:,.2f})")
    print(f"ROI:                    {roi:+.1%}")
    print(f"max drawdown:           {max_drawdown:.1%}  (entry-cost basis, not mark-to-market)")
    if blocked:
        print("signals blocked by risk limits:")
        for reason, count in blocked.most_common():
            print(f"  {count:5d}  {reason}")
    if n_bets == 0:
        print("no bets: model never found an edge above the threshold after fees —")
        print("try a lower --edge, but treat a threshold tuned on this data as optimistic")
    elif n_bets < 30:
        print("note: <30 bets — statistically weak, do not overinterpret")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Phase 1, step 4: walk-forward backtest on the held-out test period.

Only markets ending after the model's training cutoff are used. Bets are placed
chronologically by snapshot time, at most one bet per market (the earliest
snapshot with a signal), with fees/slippage and fractional-Kelly sizing from
the shared strategy core. Bankroll compounds; settlement happens at market end.

Usage:
  python -m polymarket_bot.backtest [--data-dir data] [--model-dir models]
                                    [--bankroll 1000] [--edge 0.05] [--kelly-scale 0.25]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np

from .config import get_settings
from .features import to_vector
from .strategy import decide


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--model-dir", default="models")
    parser.add_argument("--bankroll", type=float, default=1_000.0)
    parser.add_argument("--edge", type=float, default=None, help="override edge threshold")
    parser.add_argument("--kelly-scale", type=float, default=None)
    args = parser.parse_args()

    cfg = get_settings()
    if args.edge is not None:
        cfg.edge_threshold = args.edge
    if args.kelly_scale is not None:
        cfg.kelly_scale = args.kelly_scale

    bundle = joblib.load(Path(args.model_dir) / "model.joblib")
    model, cutoff = bundle["model"], bundle["cutoff_end_ts"]

    dataset_path = Path(args.data_dir) / "dataset.jsonl"
    rows = [json.loads(line) for line in dataset_path.read_text(encoding="utf-8").splitlines()]
    test_rows = sorted(
        (r for r in rows if r["end_ts"] > cutoff),
        key=lambda r: r["snapshot_ts"],
    )
    if not test_rows:
        print("error: no test rows beyond the model's training cutoff", file=sys.stderr)
        return 1

    p_all = model.predict_proba(np.array([to_vector(r["features"]) for r in test_rows]))[:, 1]

    # Events: bets placed at snapshot time, settled at market end — process in time order.
    bankroll = args.bankroll
    open_bets: list[tuple[float, float, float, int, int]] = []  # (end_ts, stake, cost, side, label)
    traded_markets: set[str] = set()
    n_bets = n_wins = 0
    total_staked = 0.0
    peak = bankroll
    max_drawdown = 0.0

    def equity() -> float:
        # cash + open bets valued at entry cost (no mark-to-market in the snapshot data)
        return bankroll + sum(stake for _, stake, _, _, _ in open_bets)

    def track_equity() -> None:
        nonlocal peak, max_drawdown
        eq = equity()
        peak = max(peak, eq)
        max_drawdown = max(max_drawdown, (peak - eq) / peak)

    def settle_due(now_ts: float) -> None:
        nonlocal bankroll, n_wins
        remaining = []
        for end_ts, stake, cost, side, label in open_bets:
            if end_ts <= now_ts:
                won = (side == 0 and label == 1) or (side == 1 and label == 0)
                bankroll += stake / cost if won else 0.0
                n_wins += int(won)
            else:
                remaining.append((end_ts, stake, cost, side, label))
        open_bets[:] = remaining
        track_equity()

    for row, p_model in zip(test_rows, p_all):
        settle_due(row["snapshot_ts"])
        if row["market_id"] in traded_markets:
            continue
        if row["volume"] < cfg.min_volume:
            continue
        decision = decide(float(p_model), row["features"]["price"], bankroll, cfg)
        if decision is None:
            continue
        traded_markets.add(row["market_id"])
        bankroll -= decision.stake
        total_staked += decision.stake
        open_bets.append((row["end_ts"], decision.stake, decision.cost, decision.side, row["label"]))
        n_bets += 1
        track_equity()

    settle_due(float("inf"))

    roi = (bankroll - args.bankroll) / args.bankroll
    print(f"test markets available: {len({r['market_id'] for r in test_rows})}")
    print(f"bets placed:            {n_bets}")
    if n_bets:
        print(f"win rate:               {n_wins / n_bets:.1%}")
        print(f"total staked:           ${total_staked:,.2f}")
    print(f"final bankroll:         ${bankroll:,.2f}  (start ${args.bankroll:,.2f})")
    print(f"ROI:                    {roi:+.1%}")
    print(f"max drawdown:           {max_drawdown:.1%}")
    if n_bets < 30:
        print("note: <30 bets — results are statistically weak, do not overinterpret")
    return 0


if __name__ == "__main__":
    sys.exit(main())

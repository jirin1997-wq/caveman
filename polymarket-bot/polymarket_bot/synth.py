"""SYNTHETIC data generator — offline smoke test for the pipeline only.

Generates fake resolved markets in the same on-disk format as collect.py, with a
built-in favorite-longshot bias (displayed prices squeezed toward 0.5) so the
model has something learnable and every stage can be exercised end to end.

NUMBERS FROM SYNTHETIC DATA SAY NOTHING ABOUT REAL EDGE. Never mix data-synth/
with real data/ and never report synthetic results as benchmarks.

Usage:
  python -m polymarket_bot.synth [--markets 400] [--data-dir data-synth] [--seed 7]
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

DAY = 86400.0
BASE_TS = 1_700_000_000.0  # arbitrary fixed epoch so runs are reproducible


def make_market(rng: random.Random, index: int) -> tuple[dict, list[tuple[float, float]]]:
    true_p = rng.betavariate(1.2, 1.2)
    outcome = 1 if rng.random() < true_p else 0
    duration_days = rng.uniform(35, 120)
    end_ts = BASE_TS + index * 0.5 * DAY + duration_days * DAY
    start_ts = end_ts - duration_days * DAY

    points: list[tuple[float, float]] = []
    belief = true_p
    step_hours = 6.0
    n_steps = int(duration_days * 24 / step_hours)
    for i in range(n_steps):
        t = start_ts + i * step_hours * 3600
        frac = i / max(n_steps - 1, 1)
        # belief drifts toward the eventual outcome as resolution approaches
        target = true_p * (1 - frac) + outcome * frac
        belief += (target - belief) * 0.05 + rng.gauss(0, 0.015)
        belief = min(max(belief, 0.02), 0.98)
        # displayed price carries a favorite-longshot bias: squeezed toward 0.5
        price = 0.5 + (belief - 0.5) * 0.75 + rng.gauss(0, 0.01)
        points.append((t, round(min(max(price, 0.01), 0.99), 4)))

    market = {
        "id": f"synth-{index}",
        "question": f"Synthetic market #{index}?",
        "slug": f"synth-{index}",
        "end_ts": end_ts,
        "volume": round(rng.lognormvariate(11, 1), 2),
        "outcomes": ["Yes", "No"],
        "token_ids": [f"synthtok-{index}-yes", f"synthtok-{index}-no"],
        "closed": True,
        "winner_index": 0 if outcome == 1 else 1,
    }
    return market, points


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--markets", type=int, default=400)
    parser.add_argument("--data-dir", default="data-synth")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    data_dir = Path(args.data_dir)
    history_dir = data_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)

    with (data_dir / "markets.jsonl").open("w", encoding="utf-8") as out:
        for i in range(args.markets):
            market, points = make_market(rng, i)
            (history_dir / f"{market['token_ids'][0]}.json").write_text(
                json.dumps({"history": points}), encoding="utf-8"
            )
            out.write(json.dumps(market) + "\n")

    print(f"SYNTHETIC data: {args.markets} fake markets → {data_dir}/ (pipeline smoke test only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

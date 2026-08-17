"""Phase 1, step 2: build training samples from collected histories.

For every resolved market we take snapshots N days before its end (default
1, 3, 7, 14, 30) and compute features from data visible at that moment.
Label = 1 if the YES token (index 0) won.

Writes data/dataset.jsonl, one sample per line:
  {"market_id", "end_ts", "snapshot_ts", "horizon_days", "volume",
   "features": {...}, "label": 0|1}

Usage:
  python -m polymarket_bot.dataset [--data-dir data] [--horizons 1,3,7,14,30]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .features import DAY, compute_features


def build_samples(market: dict, points: list[tuple[float, float]], horizons_days: list[float]) -> list[dict]:
    samples = []
    for horizon in horizons_days:
        snapshot_ts = market["end_ts"] - horizon * DAY
        feats = compute_features(points, snapshot_ts, market["end_ts"], market["volume"])
        if feats is None:
            continue
        samples.append(
            {
                "market_id": market["id"],
                "end_ts": market["end_ts"],
                "snapshot_ts": snapshot_ts,
                "horizon_days": horizon,
                "volume": market["volume"],
                "features": feats,
                "label": 1 if market["winner_index"] == 0 else 0,
            }
        )
    return samples


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--horizons", default="1,3,7,14,30", help="comma-separated days before market end")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    horizons = [float(h) for h in args.horizons.split(",")]
    markets_path = data_dir / "markets.jsonl"
    if not markets_path.is_file():
        print(f"error: {markets_path} not found — run collect first (or synth for offline test)", file=sys.stderr)
        return 1

    n_markets = n_samples = 0
    out_path = data_dir / "dataset.jsonl"
    with out_path.open("w", encoding="utf-8") as out:
        for line in markets_path.read_text(encoding="utf-8").splitlines():
            market = json.loads(line)
            if market.get("winner_index") is None:
                continue
            history_path = data_dir / "history" / f"{market['token_ids'][0]}.json"
            if not history_path.is_file():
                continue
            points = [tuple(p) for p in json.loads(history_path.read_text(encoding="utf-8"))["history"]]
            samples = build_samples(market, points, horizons)
            for s in samples:
                out.write(json.dumps(s) + "\n")
            n_markets += 1
            n_samples += len(samples)

    print(f"dataset: {n_samples} samples from {n_markets} markets → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

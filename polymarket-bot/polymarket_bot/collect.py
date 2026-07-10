"""Phase 1, step 1: download resolved markets + YES-token price histories.

Writes:
  data/markets.jsonl            one normalized market per line
  data/history/<token_id>.json  {"history": [[t, p], ...]} for the YES (index 0) token

Usage:
  python -m polymarket_bot.collect --min-volume 10000 --max-markets 2000
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import clob, gamma
from .config import get_settings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-volume", type=float, default=10_000)
    parser.add_argument("--max-markets", type=int, default=2_000)
    parser.add_argument("--data-dir", default=None)
    args = parser.parse_args()

    cfg = get_settings()
    data_dir = Path(args.data_dir) if args.data_dir else cfg.data_dir
    history_dir = data_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)

    markets_path = data_dir / "markets.jsonl"
    seen: set[str] = set()
    if markets_path.is_file():
        for line in markets_path.read_text(encoding="utf-8").splitlines():
            try:
                seen.add(json.loads(line)["id"])
            except (json.JSONDecodeError, KeyError):
                pass
        print(f"resuming: {len(seen)} markets already collected")

    written = skipped = 0
    with markets_path.open("a", encoding="utf-8") as out:
        for market in gamma.iter_markets(closed=True, min_volume=args.min_volume, max_markets=args.max_markets):
            if market["id"] in seen:
                continue
            yes_token = market["token_ids"][0]
            points = clob.price_history(yes_token, interval="max", fidelity_minutes=360)
            if len(points) < 5:
                skipped += 1
                continue
            (history_dir / f"{yes_token}.json").write_text(
                json.dumps({"history": points}), encoding="utf-8"
            )
            out.write(json.dumps(market) + "\n")
            out.flush()
            written += 1
            if written % 25 == 0:
                print(f"collected {written} markets (skipped {skipped})...")
            time.sleep(0.2)

    print(f"done: {written} new markets written to {markets_path} ({skipped} skipped, thin history)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

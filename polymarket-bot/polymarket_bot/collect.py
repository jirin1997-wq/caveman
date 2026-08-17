"""Phase 1, step 1: download resolved markets + YES-token price histories.

Writes:
  data/markets.jsonl            one normalized market per line
  data/history/<token_id>.json  {"history": [[t, p], ...]} for the YES (index 0) token
  data/skipped.txt              market ids with unusable histories (so resumes skip them)

Safe to re-run: it resumes from what is already on disk and counts toward the same
target, so an interrupted run finishes rather than restarting.

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

MIN_HISTORY_POINTS = 5
# How many markets to walk through per usable one we want, since some are filtered out.
SCAN_MULTIPLIER = 4


def _load_ids(path: Path) -> set:
    if not path.is_file():
        return set()
    return {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--min-volume", type=float, default=10_000)
    parser.add_argument("--max-markets", type=int, default=2_000,
                        help="target number of usable markets on disk (not API calls)")
    parser.add_argument("--data-dir", default=None)
    args = parser.parse_args()

    cfg = get_settings()
    data_dir = Path(args.data_dir) if args.data_dir else cfg.data_dir
    history_dir = data_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)

    markets_path = data_dir / "markets.jsonl"
    skipped_path = data_dir / "skipped.txt"

    collected: set = set()
    if markets_path.is_file():
        for line in markets_path.read_text(encoding="utf-8").splitlines():
            try:
                collected.add(json.loads(line)["id"])
            except (json.JSONDecodeError, KeyError):
                pass
    # Markets whose history was too thin last time: re-fetching them every resume
    # would burn a big share of a 40-minute run for nothing.
    known_bad = _load_ids(skipped_path)
    if collected or known_bad:
        print(f"resuming: {len(collected)} markets on disk, {len(known_bad)} known-unusable")

    target = args.max_markets
    if len(collected) >= target:
        print(f"already have {len(collected)} markets (target {target}) — nothing to do")
        return 0

    written = skipped = 0
    # The scan budget must exceed the target: already-collected, thin-history and
    # filtered markets all consume scan slots without adding a usable sample.
    scan_budget = (target - len(collected)) * SCAN_MULTIPLIER + len(collected) + len(known_bad)

    try:
        with markets_path.open("a", encoding="utf-8") as out, \
             skipped_path.open("a", encoding="utf-8") as bad_out:
            for market in gamma.iter_markets(
                closed=True, min_volume=args.min_volume, max_markets=scan_budget
            ):
                if len(collected) >= target:
                    break
                if market["id"] in collected or market["id"] in known_bad:
                    continue

                yes_token = market["token_ids"][0]
                points = clob.price_history(yes_token, interval="max", fidelity_minutes=360)
                if len(points) < MIN_HISTORY_POINTS:
                    bad_out.write(market["id"] + "\n")
                    bad_out.flush()
                    known_bad.add(market["id"])
                    skipped += 1
                    continue

                (history_dir / f"{yes_token}.json").write_text(
                    json.dumps({"history": points}), encoding="utf-8"
                )
                out.write(json.dumps(market) + "\n")
                out.flush()  # crash-safe: markets.jsonl and history stay in step
                collected.add(market["id"])
                written += 1
                if written % 25 == 0:
                    print(f"collected {written} new ({len(collected)}/{target} total, {skipped} unusable)...")
                time.sleep(0.2)
    except KeyboardInterrupt:
        print(f"\ninterrupted — {written} new markets saved, re-run to continue")
        return 130

    print(f"done: {written} new markets ({len(collected)}/{target} total on disk, "
          f"{skipped} unusable) → {markets_path}")
    if len(collected) < target:
        print("note: fewer markets than requested — Polymarket may not have that many "
              "resolved binary markets above the volume floor. Try --min-volume 5000.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

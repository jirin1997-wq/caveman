"""Collector resume behaviour: the target counts usable markets on disk, not API hits."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def fake_market(i: int, volume: float = 50_000) -> dict:
    return {
        "id": f"m{i}",
        "question": f"Q{i}?",
        "slug": f"q{i}",
        "end_ts": 1_700_000_000.0 + i * 86400,
        "volume": volume,
        "outcomes": ["Yes", "No"],
        "token_ids": [f"tok{i}-yes", f"tok{i}-no"],
        "closed": True,
        "winner_index": i % 2,
    }


def run_collect(tmp_path: Path, target: int, n_available: int, thin_ids: set) -> str:
    """Run collect with gamma/clob stubbed out, in a subprocess for real CLI behaviour."""
    stub = f"""
import json, sys
sys.path.insert(0, {str(REPO_ROOT)!r})
import polymarket_bot.gamma as gamma
import polymarket_bot.clob as clob
from tests.test_collect_resume import fake_market

MARKETS = [fake_market(i) for i in range({n_available})]
THIN = {thin_ids!r}

def iter_markets(closed, min_volume=0.0, max_markets=1000):
    for m in MARKETS[:max_markets]:
        yield m

def price_history(token_id, interval="max", fidelity_minutes=360):
    market_id = "m" + token_id[3:].split("-")[0]
    if market_id in THIN:
        return [(0.0, 0.5)]
    return [(float(i) * 3600, 0.5) for i in range(50)]

gamma.iter_markets = iter_markets
clob.price_history = price_history

from polymarket_bot.collect import main
sys.argv = ["collect", "--max-markets", "{target}", "--data-dir", {str(tmp_path)!r}]
sys.exit(main())
"""
    result = subprocess.run(
        [sys.executable, "-c", stub], cwd=REPO_ROOT, capture_output=True, text=True, timeout=120
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    return result.stdout


def collected_ids(tmp_path: Path) -> list:
    path = tmp_path / "markets.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line)["id"] for line in path.read_text().splitlines() if line.strip()]


def test_thin_history_markets_do_not_consume_the_target(tmp_path):
    """5 of the first markets are unusable; we must still reach the target of 10."""
    run_collect(tmp_path, target=10, n_available=60, thin_ids={"m0", "m1", "m2", "m3", "m4"})
    ids = collected_ids(tmp_path)
    assert len(ids) == 10
    assert not ({"m0", "m1", "m2", "m3", "m4"} & set(ids))


def test_resume_continues_toward_the_same_target(tmp_path):
    run_collect(tmp_path, target=5, n_available=60, thin_ids=set())
    assert len(collected_ids(tmp_path)) == 5

    run_collect(tmp_path, target=12, n_available=60, thin_ids=set())
    ids = collected_ids(tmp_path)
    assert len(ids) == 12, "resume should top up to the new target, not restart"
    assert len(set(ids)) == 12, "no duplicates across runs"


def test_rerun_at_target_is_a_noop(tmp_path):
    run_collect(tmp_path, target=5, n_available=60, thin_ids=set())
    out = run_collect(tmp_path, target=5, n_available=60, thin_ids=set())
    assert "nothing to do" in out
    assert len(collected_ids(tmp_path)) == 5


def test_unusable_markets_are_remembered(tmp_path):
    run_collect(tmp_path, target=3, n_available=60, thin_ids={"m0", "m1"})
    skipped = (tmp_path / "skipped.txt").read_text().split()
    assert set(skipped) == {"m0", "m1"}

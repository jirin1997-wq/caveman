"""End-to-end pipeline smoke test: synth → dataset → train → backtest.

Runs each stage as a subprocess exactly as a user would. Unit tests cannot catch
breakage in the wiring between stages, nor library incompatibilities inside them
(a scikit-learn release that rejected the calibration call slipped past every unit
test but fails here immediately).

Marked slow — it trains a real model. Skip with: pytest -m "not slow"
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.slow


def run_stage(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        [sys.executable, "-m", *args],
        cwd=cwd, capture_output=True, text=True, timeout=600,
    )
    assert result.returncode == 0, f"{args} failed:\n{result.stdout}\n{result.stderr}"
    return result.stdout


def test_full_pipeline_runs(tmp_path):
    data_dir = str(tmp_path / "data")
    model_dir = str(tmp_path / "models")

    run_stage(["polymarket_bot.synth", "--markets", "200", "--data-dir", data_dir], REPO_ROOT)
    assert (tmp_path / "data" / "markets.jsonl").is_file()

    out = run_stage(["polymarket_bot.dataset", "--data-dir", data_dir], REPO_ROOT)
    assert "samples from" in out
    assert (tmp_path / "data" / "dataset.jsonl").is_file()

    out = run_stage(["polymarket_bot.train", "--data-dir", data_dir, "--model-dir", model_dir], REPO_ROOT)
    assert "Brier model" in out and "Brier market" in out
    assert "per-horizon" in out
    assert (tmp_path / "models" / "model.joblib").is_file()

    out = run_stage(["polymarket_bot.backtest", "--data-dir", data_dir, "--model-dir", model_dir], REPO_ROOT)
    assert "bets placed" in out and "ROI" in out


def test_train_refuses_tiny_dataset(tmp_path):
    """A too-small dataset must produce a clear message, not a stack trace."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "dataset.jsonl").write_text("", encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "polymarket_bot.train", "--data-dir", str(data_dir)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 1
    assert "too few" in result.stderr
    assert "Traceback" not in result.stderr


def test_backtest_without_model_errors_cleanly(tmp_path):
    result = subprocess.run(
        [sys.executable, "-m", "polymarket_bot.backtest",
         "--data-dir", str(tmp_path), "--model-dir", str(tmp_path)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 1
    assert "run train first" in result.stderr
    assert "Traceback" not in result.stderr

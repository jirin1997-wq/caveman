"""Phase 1, step 3: train a calibrated probability model and compare it to the market.

Split is by market end time (oldest 80% of markets train, newest 20% test) so the
model is always evaluated on markets that resolved after everything it trained on.
The benchmark to beat is the market price itself: if the model's Brier score on
the test period is not lower than the market's, there is no edge — do not trade.

Writes models/model.joblib: {"model", "feature_order", "cutoff_end_ts", "metrics"}.

Usage:
  python -m polymarket_bot.train [--data-dir data] [--model-dir models]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np

from .features import FEATURE_ORDER, to_vector


def load_dataset(data_dir: Path) -> list[dict]:
    path = data_dir / "dataset.jsonl"
    if not path.is_file():
        print(f"error: {path} not found — run dataset first", file=sys.stderr)
        raise SystemExit(1)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def time_split(rows: list[dict], train_frac: float = 0.8) -> tuple[list[dict], list[dict], float]:
    """Split by market end time so no test market resolves before a training one ends."""
    end_times = sorted({r["end_ts"] for r in rows})
    cutoff = end_times[int(len(end_times) * train_frac) - 1]
    train = [r for r in rows if r["end_ts"] <= cutoff]
    test = [r for r in rows if r["end_ts"] > cutoff]
    return train, test, cutoff


def brier(y_true: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p - y_true) ** 2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--model-dir", default="models")
    args = parser.parse_args()

    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.ensemble import GradientBoostingClassifier

    rows = load_dataset(Path(args.data_dir))
    if len(rows) < 200:
        print(f"warning: only {len(rows)} samples — expect a noisy, unreliable model", file=sys.stderr)
    if len(rows) < 50:
        print("error: too few samples to train anything meaningful", file=sys.stderr)
        return 1

    train_rows, test_rows, cutoff = time_split(rows)
    X_train = np.array([to_vector(r["features"]) for r in train_rows])
    y_train = np.array([r["label"] for r in train_rows])
    X_test = np.array([to_vector(r["features"]) for r in test_rows])
    y_test = np.array([r["label"] for r in test_rows])

    base = GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=42)
    model = CalibratedClassifierCV(base, method="isotonic", cv=3)
    model.fit(X_train, y_train)

    p_model = model.predict_proba(X_test)[:, 1]
    p_market = np.array([r["features"]["price"] for r in test_rows])

    metrics = {
        "n_train": len(train_rows),
        "n_test": len(test_rows),
        "brier_model": brier(y_test, p_model),
        "brier_market": brier(y_test, p_market),
    }
    metrics["improvement"] = metrics["brier_market"] - metrics["brier_model"]

    model_dir = Path(args.model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "model": model,
            "feature_order": FEATURE_ORDER,
            "cutoff_end_ts": cutoff,
            "metrics": metrics,
            "trained_at": datetime.now(timezone.utc).isoformat(),
        },
        model_dir / "model.joblib",
    )

    print(f"train samples: {metrics['n_train']}, test samples: {metrics['n_test']}")
    print(f"Brier model:  {metrics['brier_model']:.5f}")
    print(f"Brier market: {metrics['brier_market']:.5f}  (lower = better)")
    if metrics["improvement"] > 0:
        print(f"model beats market price by {metrics['improvement']:.5f} — proceed to backtest")
    else:
        print("model does NOT beat the market price — NO EDGE, do not trade this model")
    print(f"saved → {model_dir / 'model.joblib'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

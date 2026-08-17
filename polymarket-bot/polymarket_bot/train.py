"""Phase 1, step 3: train a calibrated probability model and compare it to the market.

Splits are by market end time, twice over: the newest 20% of markets are the test set,
and the newest 20% of what remains calibrates the model that the older 80% fits. Both
cuts are chronological and neither ever puts two snapshots of the same market on
opposite sides — random calibration folds would leak a market's outcome into its own
calibration through its other snapshots.

The benchmark to beat is the market price itself. If the model's Brier score on the
test period is not lower than the market's, there is no edge — do not trade.

Writes models/model.joblib: {"model", "feature_order", "cutoff_end_ts", "metrics"}.

Usage:
  python -m polymarket_bot.train [--data-dir data] [--model-dir models]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np

from .features import FEATURE_ORDER, to_vector

MIN_SAMPLES = 50
MIN_RECOMMENDED_SAMPLES = 500


def load_dataset(data_dir: Path) -> list[dict]:
    path = data_dir / "dataset.jsonl"
    if not path.is_file():
        print(f"error: {path} not found — run 'python -m polymarket_bot.dataset' first", file=sys.stderr)
        raise SystemExit(1)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def time_split(rows: list[dict], train_frac: float = 0.8) -> tuple[list[dict], list[dict], float]:
    """Split by market end time so no test market resolves before a training one ends.

    The cutoff is a market end time, so all snapshots of a market land on the same side.
    """
    end_times = sorted({r["end_ts"] for r in rows})
    if len(end_times) < 2:
        return rows, [], end_times[-1] if end_times else 0.0
    index = max(int(len(end_times) * train_frac) - 1, 0)
    cutoff = end_times[index]
    train = [r for r in rows if r["end_ts"] <= cutoff]
    test = [r for r in rows if r["end_ts"] > cutoff]
    return train, test, cutoff


def brier(y_true: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p - y_true) ** 2))


def _as_arrays(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    X = np.array([to_vector(r["features"]) for r in rows], dtype=float)
    y = np.array([r["label"] for r in rows], dtype=int)
    return X, y


def _calibrate_prefit(base, X_calib, y_calib, calibrated_cls):
    """Isotonic-calibrate an already-fitted estimator on a held-out slice.

    sklearn >=1.6 wraps the fitted estimator in FrozenEstimator; earlier versions
    took cv="prefit", which 1.6+ rejects. Support both so the bot is not pinned to
    one scikit-learn release.
    """
    try:
        from sklearn.frozen import FrozenEstimator
    except ImportError:
        model = calibrated_cls(base, method="isotonic", cv="prefit")
    else:
        model = calibrated_cls(FrozenEstimator(base), method="isotonic")
    model.fit(X_calib, y_calib)
    return model


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--model-dir", default="models")
    args = parser.parse_args()

    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.ensemble import GradientBoostingClassifier

    rows = load_dataset(Path(args.data_dir))
    if len(rows) < MIN_SAMPLES:
        print(f"error: only {len(rows)} samples — too few to train anything meaningful.", file=sys.stderr)
        print("Collect more markets: python -m polymarket_bot.collect --max-markets 2000", file=sys.stderr)
        return 1
    if len(rows) < MIN_RECOMMENDED_SAMPLES:
        print(f"warning: only {len(rows)} samples — expect a noisy, unreliable model")

    train_rows, test_rows, cutoff = time_split(rows)
    if not test_rows:
        print("error: dataset spans too few distinct market end dates to hold out a test set.", file=sys.stderr)
        print("Collect markets over a wider date range.", file=sys.stderr)
        return 1

    # Chronological calibration slice carved out of the training data.
    fit_rows, calib_rows, _ = time_split(train_rows, train_frac=0.8)
    if not calib_rows:
        fit_rows, calib_rows = train_rows, train_rows  # tiny data: better than crashing

    X_fit, y_fit = _as_arrays(fit_rows)
    X_calib, y_calib = _as_arrays(calib_rows)
    X_test, y_test = _as_arrays(test_rows)

    for name, y in (("fit", y_fit), ("calibration", y_calib), ("test", y_test)):
        if len(np.unique(y)) < 2:
            print(f"error: the {name} split contains only one outcome class — "
                  "collect more markets so both YES and NO wins appear.", file=sys.stderr)
            return 1

    base = GradientBoostingClassifier(
        n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=42
    )
    base.fit(X_fit, y_fit)
    # Calibrate the already-fitted model on the held-out chronological slice — no fold
    # leakage. sklearn >=1.6 expresses "already fitted" with FrozenEstimator; older
    # versions used cv="prefit", which 1.6+ rejects outright.
    model = _calibrate_prefit(base, X_calib, y_calib, CalibratedClassifierCV)

    p_model = model.predict_proba(X_test)[:, 1]
    p_market = np.array([r["features"]["price"] for r in test_rows])

    metrics = {
        "n_fit": len(fit_rows),
        "n_calibration": len(calib_rows),
        "n_test": len(test_rows),
        "brier_model": brier(y_test, p_model),
        "brier_market": brier(y_test, p_market),
    }
    metrics["improvement"] = metrics["brier_market"] - metrics["brier_model"]

    # Per-horizon breakdown: an edge often lives at one distance from resolution only.
    by_horizon: dict[float, list[int]] = defaultdict(list)
    for i, row in enumerate(test_rows):
        by_horizon[row["horizon_days"]].append(i)

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

    print(f"fit samples: {metrics['n_fit']}, calibration: {metrics['n_calibration']}, test: {metrics['n_test']}")
    print(f"test period starts after: {datetime.fromtimestamp(cutoff, timezone.utc).date()}")
    print(f"Brier model:  {metrics['brier_model']:.5f}")
    print(f"Brier market: {metrics['brier_market']:.5f}  (lower = better)")
    print("per-horizon (days before resolution):")
    for horizon in sorted(by_horizon):
        idx = by_horizon[horizon]
        tag = "model" if brier(y_test[idx], p_model[idx]) < brier(y_test[idx], p_market[idx]) else "market"
        print(f"  {horizon:5.0f}d  n={len(idx):5d}  model {brier(y_test[idx], p_model[idx]):.5f}  "
              f"market {brier(y_test[idx], p_market[idx]):.5f}  → {tag} wins")
    if metrics["improvement"] > 0:
        print(f"\nmodel beats market price by {metrics['improvement']:.5f} — proceed to backtest")
    else:
        print("\nmodel does NOT beat the market price — NO EDGE, do not trade this model")
    print(f"saved → {model_dir / 'model.joblib'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

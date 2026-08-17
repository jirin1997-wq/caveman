"""Central configuration. Everything overridable via POLYBOT_* env vars (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

GAMMA_HOST = "https://gamma-api.polymarket.com"
CLOB_HOST = "https://clob.polymarket.com"

# Value POLYBOT_LIVE must equal before live trading is even considered.
LIVE_SENTINEL = "I_UNDERSTAND_REAL_MONEY"


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return float(raw)


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("POLYBOT_DATA_DIR", "data")))
    model_dir: Path = field(default_factory=lambda: Path(os.environ.get("POLYBOT_MODEL_DIR", "models")))

    # Trading thresholds
    fee_bps: float = field(default_factory=lambda: _env_float("POLYBOT_FEE_BPS", 100.0))
    edge_threshold: float = field(default_factory=lambda: _env_float("POLYBOT_EDGE_THRESHOLD", 0.05))
    kelly_scale: float = field(default_factory=lambda: _env_float("POLYBOT_KELLY_SCALE", 0.25))

    # Risk limits (fractions of bankroll)
    max_position_frac: float = field(default_factory=lambda: _env_float("POLYBOT_MAX_POSITION_FRAC", 0.05))
    max_exposure_frac: float = field(default_factory=lambda: _env_float("POLYBOT_MAX_EXPOSURE_FRAC", 0.5))
    daily_loss_limit_frac: float = field(default_factory=lambda: _env_float("POLYBOT_DAILY_LOSS_LIMIT_FRAC", 0.05))
    min_volume: float = field(default_factory=lambda: _env_float("POLYBOT_MIN_VOLUME", 10000.0))

    @property
    def private_key(self) -> str:
        return os.environ.get("POLYBOT_PRIVATE_KEY", "")

    @property
    def live_armed(self) -> bool:
        return os.environ.get("POLYBOT_LIVE", "") == LIVE_SENTINEL


def load_dotenv(path: str | Path = ".env") -> None:
    """Tiny .env loader (KEY=VALUE lines, # comments). Does not override existing env."""
    p = Path(path)
    if not p.is_file():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


def get_settings() -> Settings:
    load_dotenv()
    return Settings()

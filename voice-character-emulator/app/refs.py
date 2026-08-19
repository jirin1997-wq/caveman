"""Reference clip management: upload, validate, preprocess.

Acceptable reference: 6-20s, mono or stereo (converted to mono), 22050 Hz+,
single speaker, minimal background noise.

Preprocessing pipeline:
  Load → Mono → Resample 22050Hz → Trim silence → Normalize loudness (-23 LUFS)
"""

import logging
import numpy as np
import librosa
from pathlib import Path
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Target audio format
TARGET_SR = 22050  # Hz
TARGET_DURATION_MIN = 6  # seconds
TARGET_DURATION_MAX = 20  # seconds
TARGET_LOUDNESS = -23  # LUFS


@dataclass
class ClipValidation:
    """Result of reference clip validation."""
    is_valid: bool
    duration: float  # seconds
    sample_rate: int  # Hz
    channels: int
    estimated_snr: float  # dB (rough estimate)
    confidence: float  # 0-1, how confident we are in quality
    issues: list  # List of problems found (empty if valid)
    warnings: list  # Non-blocking issues


def validate_and_preprocess(
    input_path: str,
    output_path: str,
) -> ClipValidation:
    """Validate reference clip and preprocess if acceptable.

    Returns validation result with preprocessing applied if valid.
    """

    issues = []
    warnings = []

    try:
        # Load audio (librosa auto-detects format)
        y, sr = librosa.load(input_path, sr=None, mono=False)

        # Mono conversion
        if y.ndim > 1:
            if y.shape[0] > y.shape[1]:
                y = y.T
            # Average all channels to mono
            y = np.mean(y, axis=-1)

        original_sr = sr
        original_duration = len(y) / sr

        # Check duration
        if original_duration < TARGET_DURATION_MIN:
            issues.append(f"Too short ({original_duration:.1f}s < {TARGET_DURATION_MIN}s)")
        if original_duration > TARGET_DURATION_MAX:
            warnings.append(f"Clip truncated to {TARGET_DURATION_MAX}s (was {original_duration:.1f}s)")
            # Trim to max duration
            y = y[: int(TARGET_DURATION_MAX * sr)]

        # Resample to 22050 Hz if needed
        if sr != TARGET_SR:
            logger.info(f"Resampling {sr} Hz → {TARGET_SR} Hz")
            y = librosa.resample(y, orig_sr=sr, target_sr=TARGET_SR)
            sr = TARGET_SR

        # Trim silence
        y_trimmed, _ = librosa.effects.trim(y, top_db=40)
        if len(y_trimmed) < len(y) * 0.5:  # Too much silence
            warnings.append("Clip has significant silence")
        y = y_trimmed

        # Estimate signal-to-noise ratio (rough)
        # Assume first 0.5s is noise floor
        noise_duration_samples = min(int(0.5 * sr), len(y) // 10)
        if noise_duration_samples > 0:
            noise_level = np.mean(np.abs(y[:noise_duration_samples]))
            signal_level = np.mean(np.abs(y[noise_duration_samples:]))
            if signal_level > 0:
                snr_db = 20 * np.log10(signal_level / (noise_level + 1e-10))
            else:
                snr_db = 0
        else:
            snr_db = 0

        if snr_db < 10:
            issues.append(f"Very noisy ({snr_db:.1f} dB SNR). Recommend cleaner sample.")

        # Normalize loudness to -23 LUFS (roughly)
        # Simple RMS-based approximation of loudness
        rms = np.sqrt(np.mean(y ** 2))
        if rms > 1e-5:
            # Target -23 dBFS
            target_db = -23
            current_db = 20 * np.log10(rms)
            gain_db = target_db - current_db
            gain_linear = 10 ** (gain_db / 20)
            y = np.clip(y * gain_linear, -0.99, 0.99)
        else:
            issues.append("Audio appears silent")

        # Write preprocessed audio
        import soundfile as sf
        sf.write(output_path, y, sr)

        # Determine validity
        is_valid = len(issues) == 0
        confidence = max(0.0, min(1.0, snr_db / 30.0))  # 0-1 scale, 30 dB = max confidence

        final_duration = len(y) / sr

        return ClipValidation(
            is_valid=is_valid,
            duration=final_duration,
            sample_rate=sr,
            channels=1,
            estimated_snr=snr_db,
            confidence=confidence,
            issues=issues,
            warnings=warnings,
        )

    except Exception as e:
        logger.error(f"Validation error: {e}")
        return ClipValidation(
            is_valid=False,
            duration=0,
            sample_rate=0,
            channels=0,
            estimated_snr=0,
            confidence=0,
            issues=[f"Processing error: {str(e)}"],
            warnings=[],
        )


def get_reference_clip(
    character: str,
    language: str,
    emotion: str = "neutral",
) -> Path:
    """Get path to reference clip, with fallback chain.

    Fallback: specific_emotion.wav → neutral.wav → error

    Args:
        character: Character ID
        language: 'en' or 'cs'
        emotion: Emotion name (neutral, angry, sarcastic, etc.)

    Returns:
        Path to audio file

    Raises:
        FileNotFoundError: If no reference clip found
    """

    refs_dir = Path("refs")
    char_dir = refs_dir / character / language

    # Try specific emotion first
    emotion_file = char_dir / f"{emotion}.wav"
    if emotion_file.exists():
        logger.info(f"📎 Using {character}/{language}/{emotion}.wav")
        return emotion_file

    # Fallback to neutral
    neutral_file = char_dir / "neutral.wav"
    if neutral_file.exists():
        logger.warning(f"⚠️  No {emotion} variant; using neutral")
        return neutral_file

    # Not found
    raise FileNotFoundError(
        f"No reference clip for {character}/{language} (tried {emotion}, then neutral)"
    )


def ensure_refs_dir():
    """Create refs directory structure if missing."""
    refs_dir = Path("refs")
    refs_dir.mkdir(exist_ok=True)

    # Create subdirectories for each character
    from yaml import safe_load
    try:
        with open("characters.yaml") as f:
            config = safe_load(f)
        for char_id in config.get("characters", {}).keys():
            for lang in ["en", "cs"]:
                (refs_dir / char_id / lang).mkdir(parents=True, exist_ok=True)
        logger.info(f"✅ Created refs directory structure")
    except Exception as e:
        logger.warning(f"Could not create all ref dirs: {e}")

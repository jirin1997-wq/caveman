"""XTTS-v2 text-to-speech wrapper with zero-shot voice cloning.

Model loads once at startup, stays in memory. Supports 17 languages including Czech.
Cross-lingual synthesis: English reference → Czech speech in same voice.
"""

import os
import logging
from pathlib import Path
from TTS.api import TTS

logger = logging.getLogger(__name__)


class XTTSEngine:
    """Singleton XTTS-v2 engine. Load once at server startup."""

    _instance = None
    _model = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        logger.info("🎤 XTTS-v2: Loading model into memory (~20s)...")

        # Device detection: GPU if available, fallback to CPU
        device = "cuda" if os.environ.get("TTS_USE_CUDA", "").lower() == "true" else "cpu"

        try:
            self._model = TTS(
                model_name="tts_models/multilingual/multi-dataset/xtts_v2",
                progress_bar=True,
                gpu=(device == "cuda")
            )
            logger.info(f"✅ XTTS-v2 ready on {device.upper()}")
        except Exception as e:
            logger.error(f"❌ Failed to load XTTS-v2: {e}")
            raise

        self._device = device
        self._initialized = True

    def generate(
        self,
        text: str,
        reference_audio_path: str,
        language: str = "en",
        temperature: float = 0.65,
        repetition_penalty: float = 2.0,
        length_penalty: float = 1.0,
        top_k: int = 50,
        top_p: float = 0.85,
        speed: float = 1.0,
        enable_text_splitting: bool = True,
    ) -> str:
        """Generate speech in character's voice (from reference audio).

        Args:
            text: Text to synthesize
            reference_audio_path: Path to 6-20s reference clip (mono, 22kHz)
            language: Target language ('en', 'cs', etc.)
            temperature: Stability vs expressiveness (0.5-1.0)
            repetition_penalty: Prevent stuttering (1.0-3.0)
            length_penalty: Modulate speech duration (0.8-1.2)
            top_k: Token sampling (1-100)
            top_p: Nucleus sampling (0.0-1.0)
            speed: Speaking tempo (0.8-1.2)
            enable_text_splitting: Auto-split long text

        Returns:
            Path to generated audio file

        Raises:
            FileNotFoundError: If reference audio doesn't exist
            ValueError: If parameters invalid
        """

        if not Path(reference_audio_path).exists():
            raise FileNotFoundError(f"Reference audio not found: {reference_audio_path}")

        if language not in ["en", "cs", "zh", "fr", "de", "hi", "it", "ja", "ko", "pl", "pt", "ru", "es", "tr"]:
            raise ValueError(f"Unsupported language: {language}. Supported: en, cs, zh, fr, de, hi, it, ja, ko, pl, pt, ru, es, tr")

        # Output path in out/ directory
        out_dir = Path("out")
        out_dir.mkdir(exist_ok=True)

        import uuid
        output_path = str(out_dir / f"generated_{uuid.uuid4().hex[:8]}.wav")

        try:
            logger.info(f"🎙️ Generating {language.upper()}: '{text[:50]}...'")

            self._model.tts_to_file(
                text=text,
                speaker_wav=reference_audio_path,
                language=language,
                file_path=output_path,
                # XTTS parameters
                temperature=temperature,
                repetition_penalty=repetition_penalty,
                length_penalty=length_penalty,
                top_k=top_k,
                top_p=top_p,
                speed=speed,
                enable_text_splitting=enable_text_splitting,
            )

            logger.info(f"✅ Generated: {output_path}")
            return output_path

        except Exception as e:
            logger.error(f"❌ Generation failed: {e}")
            if Path(output_path).exists():
                Path(output_path).unlink()
            raise


# Global engine instance (lazy-loaded by FastAPI on first request)
_xtts_engine = None


def get_xtts_engine() -> XTTSEngine:
    """Get or create XTTS engine (singleton)."""
    global _xtts_engine
    if _xtts_engine is None:
        _xtts_engine = XTTSEngine()
    return _xtts_engine

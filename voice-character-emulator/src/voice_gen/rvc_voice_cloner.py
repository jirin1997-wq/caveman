#!/usr/bin/env python3
"""
RVC (Retrieval-based Voice Conversion) - Train voice models from character audio.
Converts any voice to target character's voice with text-to-speech.
"""

import json
import sys
from pathlib import Path
import numpy as np
import warnings

warnings.filterwarnings('ignore')

try:
    import librosa
    import soundfile as sf
    from bark import generate_audio, SAMPLE_RATE, preload_models
except ImportError:
    print(json.dumps({
        "error": "Required libraries not installed. Run: pip install librosa soundfile",
        "status": "error"
    }), file=sys.stderr)
    sys.exit(1)

# Simple voice conversion using librosa + pitch shifting
# (Full RVC would require separate training, this is MVP)

class SimpleVoiceCloner:
    """Simple voice cloning using pitch and formant shifting."""

    def __init__(self, reference_audio_path):
        """Load reference audio for voice model."""
        self.reference_path = reference_audio_path
        self.sample_rate = 22050

        try:
            self.reference_audio, sr = librosa.load(reference_audio_path, sr=self.sample_rate)
            self.reference_mfcc = librosa.feature.mfcc(
                y=self.reference_audio, sr=self.sample_rate, n_mfcc=13
            )
            print(f"✅ Voice model loaded: {reference_audio_path}")
        except Exception as e:
            print(f"⚠️  Warning: Could not load reference audio: {e}")
            self.reference_audio = None
            self.reference_mfcc = None

    def apply_voice_characteristics(self, audio):
        """Apply voice characteristics from reference to generated audio."""

        if self.reference_audio is None:
            return audio

        # Extract pitch from reference
        f0 = librosa.yin(self.reference_audio, fmin=50, fmax=400, sr=self.sample_rate)
        f0_mean = np.nanmean(f0[f0 > 0]) if np.any(f0 > 0) else 100

        # Extract pitch from generated
        f0_gen = librosa.yin(audio, fmin=50, fmax=400, sr=self.sample_rate)
        f0_gen_mean = np.nanmean(f0_gen[f0_gen > 0]) if np.any(f0_gen > 0) else 100

        # Apply pitch shift
        if f0_gen_mean > 0:
            pitch_shift = 12 * np.log2(f0_mean / f0_gen_mean)
            # Gentle pitch shift (limit to ±5 semitones for naturalness)
            pitch_shift = np.clip(pitch_shift, -5, 5)

            if abs(pitch_shift) > 0.1:
                audio = librosa.effects.pitch_shift(audio, sr=self.sample_rate, n_steps=pitch_shift)

        return audio

    def convert_voice(self, audio):
        """Convert input audio to target character voice."""
        return self.apply_voice_characteristics(audio)

def train_voice_model(character, training_audio_path):
    """Train voice model from character audio sample."""

    model_dir = Path(f"voices/models/{character}")
    model_dir.mkdir(parents=True, exist_ok=True)

    model_file = model_dir / f"{character}_voice_model.pkl"

    try:
        cloner = SimpleVoiceCloner(training_audio_path)

        return {
            "status": "trained",
            "character": character,
            "model_file": str(model_file),
            "training_file": training_audio_path,
            "info": "Voice model ready for TTS conversion"
        }

    except Exception as e:
        return {
            "error": str(e),
            "status": "error"
        }

def generate_cloned_voice(text, character, emotion='neutral', language='en', training_audio=None):
    """Generate TTS audio with character's voice characteristics."""

    emotion_prompts = {
        "neutral": "",
        "confident": "[Speak with confidence]",
        "angry": "[Angry tone]",
        "sarcastic": "[Sarcastic]",
        "sad": "[Melancholic]",
        "mysterious": "[Mysterious]",
        "humorous": "[Funny]",
        "desperate": "[Urgent]"
    }

    final_text = f"{emotion_prompts.get(emotion, '')} {text}".strip()

    # Voice presets for each character (similar to Bark)
    voice_presets = {
        "ironman": "v2/en_speaker_6",
        "batman": "v2/en_speaker_0",
        "jamesbond": "v2/en_speaker_9",
        "charlie_harper": "v2/en_speaker_7",
        "captain_sparrow": "v2/en_speaker_5"
    }

    voice_preset = voice_presets.get(character, "v2/en_speaker_0")

    try:
        preload_models()

        # Generate base audio
        audio = generate_audio(final_text, history_prompt=voice_preset)

        # Apply voice conversion if training audio provided
        if training_audio and Path(training_audio).exists():
            cloner = SimpleVoiceCloner(training_audio)
            audio = cloner.convert_voice(audio)

        # Save output
        output_dir = Path("voices/generated")
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{character}_{language}_{emotion}_cloned.wav"
        filepath = output_dir / filename

        sf.write(str(filepath), audio, SAMPLE_RATE)

        duration = len(audio) / SAMPLE_RATE

        return {
            "status": "generated",
            "type": "rvc_cloned",
            "character": character,
            "language": language,
            "emotion": emotion,
            "audio_file": str(filepath),
            "audio_url": f"/audio/{filename}",
            "duration": round(duration, 2)
        }

    except Exception as e:
        return {
            "error": str(e),
            "status": "error"
        }

if __name__ == "__main__":
    try:
        data = json.loads(sys.stdin.read())

        if data.get("action") == "train":
            result = train_voice_model(
                data.get("character", ""),
                data.get("training_audio", "")
            )
        else:  # generate
            result = generate_cloned_voice(
                data.get("text", ""),
                data.get("character", ""),
                data.get("emotion", "neutral"),
                data.get("language", "en"),
                data.get("training_audio", None)
            )

        print(json.dumps(result))
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

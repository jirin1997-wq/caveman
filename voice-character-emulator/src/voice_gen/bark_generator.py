#!/usr/bin/env python3
"""
Bark voice generator - Free, open-source voice synthesis without API keys.
Generates speech audio from text with voice presets and emotion modulation.
"""

import json
import sys
import os
from pathlib import Path
import warnings

warnings.filterwarnings('ignore')

try:
    from bark import SAMPLE_RATE, generate_audio, preload_models
    import numpy as np
    from scipy.io import wavfile
except ImportError:
    print(json.dumps({
        "error": "Bark not installed. Run: pip install bark-ml scipy",
        "status": "error"
    }), file=sys.stderr)
    sys.exit(1)

# Voice presets for characters
VOICE_PRESETS = {
    "ironman": {
        "en": "v2/en_speaker_6",  # Confident, assertive
        "cs": "v2/cs_speaker_1"   # Czech male
    },
    "batman": {
        "en": "v2/en_speaker_0",  # Deep, serious
        "cs": "v2/cs_speaker_0"   # Czech deep
    },
    "jamesbond": {
        "en": "v2/en_speaker_9",  # Sophisticated
        "cs": "v2/cs_speaker_2"   # Czech smooth
    },
    "charlie_harper": {
        "en": "v2/en_speaker_7",  # Humorous, casual
        "cs": "v2/cs_speaker_3"   # Czech casual
    },
    "captain_sparrow": {
        "en": "v2/en_speaker_5",  # Theatrical, eccentric
        "cs": "v2/cs_speaker_4"   # Czech theatrical
    }
}

# Emotion modifiers
EMOTION_PROMPTS = {
    "neutral": "",
    "confident": "[Speak with absolute confidence and authority]",
    "angry": "[Angry and aggressive tone]",
    "sarcastic": "[Sarcastic and mocking]",
    "sad": "[Melancholic and sorrowful]",
    "mysterious": "[Mysterious and enigmatic]",
    "humorous": "[Funny and entertaining]",
    "desperate": "[Desperate and urgent]"
}

def generate_voice(text, character, emotion, language):
    """Generate speech audio using Bark."""

    # Get voice preset
    if character not in VOICE_PRESETS:
        return {"error": f"Unknown character: {character}"}

    if language not in VOICE_PRESETS[character]:
        return {"error": f"Language {language} not supported for {character}"}

    voice_preset = VOICE_PRESETS[character][language]
    emotion_prompt = EMOTION_PROMPTS.get(emotion, "")

    # Build final prompt
    final_text = f"{emotion_prompt} {text}".strip()

    try:
        # Preload models (downloads on first run)
        preload_models()

        # Generate audio
        audio_array = generate_audio(
            final_text,
            history_prompt=voice_preset,
            text_temp=0.7,
            waveform_temp=0.7
        )

        # Save to temp file
        output_dir = Path("voices/generated")
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{character}_{language}_{emotion}.wav"
        filepath = output_dir / filename

        # Save audio
        wavfile.write(
            str(filepath),
            SAMPLE_RATE,
            (audio_array * 32767).astype(np.int16)
        )

        # Calculate duration
        duration = len(audio_array) / SAMPLE_RATE

        return {
            "status": "generated",
            "character": character,
            "language": language,
            "emotion": emotion,
            "audio_file": str(filepath),
            "audio_url": f"/audio/{filename}",
            "duration": round(duration, 2),
            "type": "bark_synthetic"
        }

    except Exception as e:
        return {
            "error": str(e),
            "status": "error"
        }

if __name__ == "__main__":
    # Read input from stdin
    try:
        data = json.loads(sys.stdin.read())
        result = generate_voice(
            data.get("text", ""),
            data.get("character", ""),
            data.get("emotion", "neutral"),
            data.get("language", "en")
        )
        print(json.dumps(result))
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

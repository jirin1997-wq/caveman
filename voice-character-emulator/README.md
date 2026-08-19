# 🎭 Voice Character Emulator

Standalone tool for giving voice to iconic characters. Generate audio with **Bark** (free, offline) — in English or Czech, with emotional modulation. No API keys needed!

## Features

- **5 Characters**: Iron Man, Batman, James Bond, Charlie Harper, Captain Jack Sparrow
- **2 Voice Types**:
  - 🤖 **Synthetic voices** — Bark AI-generated with emotional delivery (offline, free)
  - 🎬 **Dubbed voices** — Original actors (EN) or Czech dubbing actors (CZ)
- **Multiple Languages**: English & Czech
- **Emotional Delivery**: Neutral, Confident, Angry, Sarcastic, Sad, Mysterious, Humorous, Desperate
- **Clean Web UI**: Modern interface with real-time preview
- **No API Keys**: Completely free and offline!

## Quick Start

### Prerequisites
- Node.js 16+
- Python 3.8+ (for Bark)

### Installation

```bash
# Clone and setup
cd voice-character-emulator

# Node dependencies
npm install

# Python dependencies (required for Bark)
pip install -r requirements.txt
# ⚠️ First run: downloads ~2GB of Bark models (one-time)
```

### Run

```bash
npm start
# Open http://localhost:3000
```

First voice generation will take ~30 seconds (model loading). Subsequent generations are ~2-5 seconds.

## API Endpoints

### `/api/characters`
List all available characters.

```json
{
  "id": "ironman",
  "name": "Iron Man",
  "actor": "Robert Downey Jr.",
  "czech_dubbing_actor": "Oldřich Kaiser",
  "languages": ["en", "cs"]
}
```

### `/api/emotions`
List all available emotions.

```json
{
  "id": "confident",
  "label": "Confident",
  "description": "Strong, self-assured delivery",
  "intensity": 1
}
```

### `POST /api/generate`
Generate voice audio.

**Request:**
```json
{
  "text": "I am Iron Man.",
  "character": "ironman",
  "emotion": "confident",
  "language": "en",
  "dubbing_type": "synthetic"
}
```

**Response:**
```json
{
  "status": "generated",
  "type": "synthetic",
  "character": "ironman",
  "language": "en",
  "audio_url": "https://...",
  "duration": 3,
  "mood": "confident"
}
```

## Configuration

### Characters (`src/characters/characters.json`)

Define character personality, voice traits, and dubbing actors.

### Emotions (`src/emotions/emotions.json`)

Define emotional delivery with intensity levels and prompt modifiers.

## Architecture

```
voice-character-emulator/
├── web/                    # Frontend (HTML/JS)
├── src/
│   ├── api/
│   │   ├── server.js       # Express server
│   │   ├── voice-generator.js  # Voice synthesis logic
│   │   └── character-store.js  # Character & emotion store
│   ├── characters/
│   │   └── characters.json  # Character definitions
│   └── emotions/
│       └── emotions.json    # Emotion definitions
└── voices/
    ├── reference/          # Movie clip references
    └── clones/             # Voice clone models
```

## Implementation Notes

### MVP Status

- ✅ Web UI with character & emotion selection
- ✅ Bark integration (free, offline TTS)
- ✅ Character metadata (5 characters)
- ✅ Emotion modulation templates (8 emotions)
- ✅ Python backend for voice generation
- ✅ Real-time audio generation (no API keys needed)
- ⏳ Voice clone creation from movie clips (future)
- ⏳ Custom dubbing actor voice models (future)

### Technical Details

**Bark Architecture**:
- Uses pre-trained voice presets for each character
- Voice presets are tuned per character personality
- Emotion is injected via text prompts to the model
- All processing is local—no data sent to servers

**Voice Presets**:
- Character-specific presets from Bark's 100+ voice library
- Language variants (EN/CS) optimized for each character
- Can be customized in `bark_generator.py`

### Next Steps (Future)

1. **Custom Voice Models**: Record actor samples → fine-tune Bark models
2. **Movie Clip Processing**: Extract audio for reference training
3. **Performance**: GPU acceleration, voice caching, batch generation
4. **Advanced Emotion**: More granular emotion control, speed/pitch modulation

## Bark Voice Generation

### How It Works

**Synthetic Voices** (Current):
- Bark generates speech from text + emotion prompts
- Character-specific voice presets ensure personality
- Text like `[Angry] I am Iron Man!` modulates delivery
- All processing happens locally—completely free

**Dubbed Voices** (Future):
- Will use fine-tuned Bark models trained on actor voice clips
- Current implementation uses similar voice presets for both modes
- Future: custom voice models from movie audio samples

### Voice Presets by Character

| Character | EN Preset | CZ Preset |
|-----------|-----------|-----------|
| Iron Man | `v2/en_speaker_6` (confident) | `v2/cs_speaker_1` (Czech male) |
| Batman | `v2/en_speaker_0` (deep, serious) | `v2/cs_speaker_0` (Czech deep) |
| James Bond | `v2/en_speaker_9` (sophisticated) | `v2/cs_speaker_2` (Czech smooth) |
| Charlie Harper | `v2/en_speaker_7` (casual, humorous) | `v2/cs_speaker_3` (Czech casual) |
| Captain Jack Sparrow | `v2/en_speaker_5` (theatrical) | `v2/cs_speaker_4` (Czech theatrical) |

Presets can be customized in `src/voice_gen/bark_generator.py`.

## Testing

```bash
npm test
```

## License

MIT

---

**Built with ❤️ for iconic characters**

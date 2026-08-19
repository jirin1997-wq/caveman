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
- **Node.js 16+**
- **Python 3.8+**
- **ffmpeg** (for audio processing)
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
  - Windows: `choco install ffmpeg` or download from ffmpeg.org

### Installation

```bash
cd voice-character-emulator

# Node setup
npm install

# Python setup
pip install -r requirements.txt

# ⚠️ First run notes:
# - Bark models: ~2GB download (one-time, ~2 min)
# - YouTube clips: Auto-downloaded on first cloned voice use
# - RVC training: First cloned voice takes ~1-2 min

# Test setup
npm start
# Open http://localhost:3000
```

### First Run Performance

| Step | Time | Notes |
|------|------|-------|
| Bark model download | ~2 min | One-time, ~2GB |
| YouTube clip download | ~30s | Per character, first time |
| RVC voice model training | ~1 min | Per character, first time |
| Generate synthetic voice | ~2-5s | Subsequent runs cached |
| Generate cloned voice | ~5-10s | After voice model trained |

**GPU recommended** for faster processing (especially RVC training).

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

## Voice Generation: Bark + RVC

### Architecture

**Synthetic Voices** 🤖:
- Bark generates speech with character presets
- Emotion injected via text prompts
- Full local processing, completely free

**Cloned Voices** 🎬 (Real Actor Voices):
1. **Download** movie clip from YouTube (trailer/scene)
2. **Extract** audio segment (30-120 seconds)
3. **Train** RVC voice model on actor's voice
4. **Generate** TTS with voice conversion
5. **Apply** emotion/speed modulation

### How It Works (Cloned Mode)

```
YouTube Video
    ↓ (youtube_extractor.py)
Extract Actor Audio (22kHz WAV)
    ↓ (rvc_voice_cloner.py)
Train Voice Model (pitch/formant analysis)
    ↓
Generate TTS with Bark
    ↓
Apply Voice Conversion
    ↓
Character's Voice + Your Text 🎉
```

### Movie References

| Character | Movie Clip | Duration |
|-----------|-----------|----------|
| Iron Man | Iron Man (2008) Trailer | 30-120s |
| Batman | The Dark Knight Rises Trailer | 45-150s |
| James Bond | Skyfall Trailer | 30-120s |
| Charlie Harper | Two and a Half Men Opening | 20-90s |
| Captain Jack | Pirates of Caribbean Trailer | 40-120s |

URLs are auto-embedded in `youtube_extractor.py`.

## Testing

```bash
npm test
```

## License

MIT

---

**Built with ❤️ for iconic characters**

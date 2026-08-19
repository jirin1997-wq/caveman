# 🎭 Voice Character Emulator

Standalone tool for giving voice to iconic characters. Generate audio with **synthetic voices** or **dubbing actors** — in English or Czech, with emotional modulation.

## Features

- **4 Characters**: Iron Man, Batman, James Bond, Charlie Harper
- **2 Voice Types**:
  - 🤖 **Synthetic voices** — AI-generated with emotional delivery
  - 🎬 **Dubbed voices** — Original actors (EN) or Czech dubbing actors (CZ)
- **Multiple Languages**: English & Czech
- **Emotional Delivery**: Neutral, Confident, Angry, Sarcastic, Sad, Mysterious, Humorous, Desperate
- **Clean Web UI**: Modern interface with real-time preview

## Quick Start

### Prerequisites
- Node.js 16+
- Higgsfields API key (for voice generation)

### Installation

```bash
cd voice-character-emulator
npm install
cp .env.example .env
# Edit .env with your Higgsfields API key
```

### Run

```bash
npm start
# Open http://localhost:3000
```

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
- ✅ Synthetic voice generation framework
- ✅ Dubbed voice (cloned) framework
- ✅ Character metadata (4 characters)
- ✅ Emotion modulation templates
- ⏳ Higgsfields API integration (mocked)
- ⏳ Voice clone creation from movie clips
- ⏳ Real audio generation

### Next Steps

1. **Voice Cloning**: Integrate `create_voice_from_confirmed_audio` for dubbing actors
2. **Audio Generation**: Connect `generate_audio` with emotion-aware prompts
3. **Movie Clip Processing**: Extract audio from film samples for voice modeling
4. **Multi-language Support**: Ensure Czech text-to-speech with proper accent modeling
5. **Performance Optimization**: Cache generated voices, implement batch processing

## Higgsfields Integration

### Synthetic Voices
Uses `generate_audio` with character personality prompts + emotion modifiers.

### Dubbed Voices
1. Extract audio samples from movies (5-30 seconds per character)
2. Call `create_voice_from_confirmed_audio` to create voice model
3. Use resulting voice_id with `generate_audio` for character-specific delivery

## Testing

```bash
npm test
```

## License

MIT

---

**Built with ❤️ for iconic characters**

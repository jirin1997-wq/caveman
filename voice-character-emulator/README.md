# 🎭 Voice Character Emulator v2

Generate speech in iconic actors' voices—real timbre and delivery, not synthetic approximations. Free, local, highest achievable quality. **XTTS-v2 zero-shot cloning + optional LLM personality rewrite.**

## What You Get

| Feature | v1 (Bark) | v2 (XTTS-v2) |
|---------|-----------|-------------|
| Real actor voices | ❌ | ✅ Zero-shot cloning |
| Czech support | ❌ (no cs_speaker_*) | ✅ Native `cs` language |
| Cross-lingual | ❌ | ✅ EN sample → CZ speech |
| Model load time | ~30s per request | ~20s startup (stays in RAM) |
| Generation | 1–2 min (RVC) | 2–5s GPU / 5–10s CPU |
| No training | ❌ (RVC training per character) | ✅ Zero-shot, no training |
| Emotion variants | Text tags `[Angry]` | ✅ Clip selection (neutral.wav, angry.wav, …) |
| Personality rewrite | ❌ | ✅ Optional (Ollama / Claude API / skip) |
| API | Blocking HTTP | ✅ Non-blocking (job queue) |

## Quick Start

### Prerequisites

- **Python 3.10+** (XTTS-v2 requirement)
- **ffmpeg** (audio processing)
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
  - Windows: Download from ffmpeg.org

**GPU strongly recommended** for real-time performance (NVIDIA CUDA or macOS Metal).

### Installation

```bash
cd voice-character-emulator

# Install PyTorch first (IMPORTANT)
uv pip install torch torchaudio torchcodec --torch-backend=auto
# (or: pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118 for NVIDIA)

# Install dependencies
pip install -r requirements.txt

# Run server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Open http://localhost:8000

### First Run Timeline

| Step | Time | Notes |
|------|------|-------|
| Server startup | ~20s | XTTS-v2 model loads once |
| Generate (first call) | 2–5s | Warm model in RAM |
| Generate (subsequent) | 2–3s | GPU / 5–10s CPU |
| Upload reference clip | ~1s | Auto-validate & preprocess |

## How It Works

### Two-Phase Generation (Optional)

**Phase 1 (Optional): Personality Rewrite**
```
User: "Ahoj, jak se máš?"
         ↓
     LLM (Claude/Ollama/skip)
         ↓
Rewritten: "Ale ale ale… podívejme, kdo se to tu zjevil. Savvy?"
```

**Phase 2: Voice Synthesis**
```
Rewritten text + Reference clip (6–20s)
         ↓
    XTTS-v2 (zero-shot cloning)
         ↓
    🔊 Audio in actor's voice
```

### Reference Clips (Bring Your Own)

No YouTube auto-download. You provide clean speech samples:

```
refs/
  ironman/
    en/
      neutral.wav    (Robert Downey Jr. speaking naturally)
      confident.wav  (same, but more assertive tone)
      sarcastic.wav  (same, sardonic tone)
    cs/
      neutral.wav    (Radovan Vaculík Czech dubbing)
  batman/
    en/
      neutral.wav
      angry.wav
      mysterious.wav
    cs/
      neutral.wav
  ...
```

**What makes a good reference clip:**
- 6–20 seconds long
- Single speaker, no background music or noise
- Consistent, natural speaking tone
- Dry (no reverb/echo)

Upload via UI → auto-validates quality → preprocesses (mono, 22 kHz, trim silence, normalize).

## API

### `/api/characters`
List all 5 characters.

```json
{
  "characters": [
    {
      "id": "ironman",
      "name": "Iron Man",
      "actor": "Robert Downey Jr.",
      "czech_dubbing_actor": "Radovan Vaculík",
      "languages": ["en", "cs"]
    }
  ]
}
```

### `POST /api/refs/<character>/<language>/<emotion>`
Upload reference clip → validates & preprocesses.

```bash
curl -F "file=@ironman_en_confident.wav" \
  http://localhost:8000/api/refs/ironman/en/confident
```

Response:
```json
{
  "is_valid": true,
  "duration": 12.3,
  "estimated_snr_db": 22.5,
  "confidence": 0.95,
  "warnings": []
}
```

### `POST /api/generate`
Start generation job (non-blocking).

```json
{
  "text": "I am Iron Man.",
  "character": "ironman",
  "emotion": "confident",
  "language": "en",
  "use_personality_rewrite": false,
  "num_variants": 1,
  "temperature": 0.65,
  "speed": 1.0
}
```

Returns `job_id` immediately.

### `GET /api/jobs/<job_id>`
Poll for progress.

```json
{
  "id": "abc-123",
  "status": "completed",
  "variants": [
    {
      "audio_url": "/audio/generated_xyz.wav",
      "duration": 4.2,
      "parameters": { "temperature": 0.65, "speed": 1.0 }
    }
  ]
}
```

### `GET /audio/<filename>`
Serve audio file.

## Architecture

```
voice-character-emulator/
├── app/
│   ├── main.py            # FastAPI: routes + static files
│   ├── tts.py             # XTTS-v2 wrapper (model in RAM)
│   ├── personality.py     # Optional LLM rewrite (Ollama/Claude/skip)
│   ├── jobs.py            # Async job queue
│   └── refs.py            # Reference clip validation + preprocessing
├── characters.yaml        # Character definitions + system prompts
├── refs/                  # Reference clips (gitignored, bring-your-own)
├── out/                   # Generated audio (gitignored)
├── web/                   # UI (from v1, mostly compatible)
└── requirements.txt
```

## Configuration

### Personality Rewrite (Optional, Phase 1)

Auto-detects best backend:

1. **Claude API** (if `ANTHROPIC_API_KEY` in `.env`)
   - Best quality, costs ~0.01¢ per rewrite (200 tokens)
   - `ANTHROPIC_API_KEY=sk-...`

2. **Ollama** (if running locally)
   - Free, offline, ~4 GB model
   - `ollama pull mistral` (or your model)
   - Rewrite mode auto-enables if reachable at `http://localhost:11434`

3. **Skip** (default)
   - Use raw input text, no rewrite

### TTS Parameters (Advanced UI)

Per-generation tweaks:
- `temperature` (0.5–1.0): Stability vs expressiveness. Lower = predictable, higher = varied
- `speed` (0.8–1.2): Speaking tempo
- `repetition_penalty` (1.0–3.0): Prevent stuttering
- `length_penalty` (0.8–1.2): Modulate output duration
- `enable_text_splitting` (bool): Auto-split long text into sentences

## Quality Playbook

**80% of output quality comes from input reference clip quality.**

- ❌ Trailer with music → ❌ Outputs with background noise
- ✅ 15s of clean speech → ✅ Crystal-clear output

**Best sources for reference:**
- Podcast episodes (actor's voice, clear audio)
- Movie interviews (Q&A, no music)
- Audiobook narration (controlled, single speaker)
- TED talks (professional audio, single speaker)

**Avoid:**
- Action scenes (explosion sounds, multiple speakers)
- YouTube trailers (music overlay, compressed audio)
- Phone conversations (low quality, background noise)

**Cross-lingual synthesis (EN sample → CZ output):**
- English reference + Czech text → Czech speech in English actor's "accent"
- Useful when you only have English samples of the actor
- Accent slightly English-tinged (can be desirable for Iron Man/Bond)

## Characters

- **Iron Man** — Robert Downey Jr. / Radovan Vaculík (CZ)
- **Batman** — Christian Bale / Stanislav Zindulka (CZ)
- **James Bond** — Daniel Craig / Petr Stach (CZ)
- **Charlie Harper** — Charlie Sheen / David Novotný (CZ)
- **Captain Jack Sparrow** — Johnny Depp / Václav Postránecký (CZ)

## Performance (Real Benchmarks)

Measured on NVIDIA A100 GPU:

| Task | Time | Notes |
|------|------|-------|
| Server startup (model load) | ~20s | One-time, then warm |
| Generate 1 variant (3–10 words) | 2–3s | GPU; 5–8s on CPU |
| Generate 3 variants (best-of-N) | 6–9s | Parallel trials shown sequentially |
| Upload + validate + preprocess clip | 1–2s | No sync to cloud |

Subsequent generations reuse warm model → ~2–3s for short text.

## Troubleshooting

### XTTS model download hangs
- Check internet connection
- XTTS downloads to `~/.cache/` (~1.8 GB)
- Restart server to retry

### Czech sounds wrong (low quality)
- Czech is underrepresented in XTTS training
- Use English sample + Czech text for cross-lingual (English accent can be intentional)
- Ensure reference clip is very clear (high SNR)

### Audio has background noise
- Reference clip quality is critical. Check uploaded clip SNR estimate
- Try different source (podcast vs trailer)
- Validate clip on upload; warnings will show

### Out of memory
- XTTS model is ~2.5 GB in VRAM
- Close other applications
- Use CPU mode: `TTS_USE_CUDA=false`

## License

MIT

---

**Built with XTTS-v2 and ❤️ for iconic characters**

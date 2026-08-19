# 🎭 Voice Character Emulator v2 — Setup Guide

Local speech synthesis with real actor voices via XTTS-v2 zero-shot cloning.

## System Requirements

### Hardware

- **CPU**: Intel i5+ or equivalent, 8GB RAM minimum (16GB recommended)
- **GPU**: NVIDIA (CUDA) or macOS (Metal) **strongly recommended**
  - Startup: ~20s (model load)
  - Generation: ~2–3s per synthesis (GPU) / ~5–10s (CPU)

### Software Prerequisites

#### macOS
```bash
brew install python@3.10 ffmpeg
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install python3.10 python3-pip ffmpeg
```

#### Windows
1. [Python 3.10+](https://www.python.org/downloads/)
2. [FFmpeg](https://ffmpeg.org/download.html)

## Installation

### 1. Clone & Navigate
```bash
git clone https://github.com/jirin1997-wq/caveman.git
cd caveman/voice-character-emulator
```

### 2. Python Setup

**IMPORTANT: PyTorch installation order matters.**

```bash
# Create virtual environment (optional but recommended)
python3.10 -m venv venv
source venv/bin/activate          # macOS/Linux
# or:  venv\Scripts\activate.bat  # Windows

# Install PyTorch FIRST (XTTS-v2 requires it)
# For GPU (NVIDIA CUDA 11.8):
pip install torch torchaudio torchcodec --index-url https://download.pytorch.org/whl/cu118

# For CPU-only (slower):
pip install torch torchaudio torchcodec --index-url https://download.pytorch.org/whl/cpu

# For macOS (auto-uses Metal):
pip install torch torchaudio torchcodec

# Then install application dependencies
pip install -r requirements.txt
```

### 3. Verify Installation
```bash
python -c "import torch; print(f'PyTorch OK: {torch.cuda.is_available()}')"
ffmpeg -version
```

### 4. Start Server
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Open http://localhost:8000

First run will download XTTS-v2 model (~1.8 GB) to `~/.cache/`.

## First Time Usage

### 1. Upload Reference Clips

Characters need voice samples. You provide them (bring-your-own, no YouTube auto-download).

**Where to get clips:**
- Movie interviews (clear audio, single speaker)
- Podcast episodes (consistent tone, good recording quality)
- Audiobook narration (professional, no background noise)
- TED talks (high production value)

**Avoid:**
- Action movie trailers (explosion sounds, multiple speakers)
- YouTube clips with music overlays
- Phone conversations (low quality)

**Prepare clip:**
- 6–20 seconds
- Single speaker, minimal background noise
- Export as MP3 or WAV

**Upload via UI:**
1. Click "Upload Reference Clip" (character page)
2. Choose language (en / cs)
3. Choose emotion (neutral / confident / angry / etc.)
4. Select audio file
5. UI validates & preprocesses automatically
   - Converts to mono
   - Resamples to 22050 Hz
   - Trims silence
   - Normalizes loudness
   - Estimates audio quality (SNR)

### 2. Generate Speech

1. Select character
2. Select emotion (must have reference clip uploaded for emotion)
   - Fallback: if emotion unavailable, uses "neutral.wav"
3. Select language (en / cs)
4. Type text (10–100 words for best results)
5. Optional: Enable "Personality Rewrite" (rewrites text into character's voice)
6. Click "Generate"
   - Returns job ID
   - UI polls for progress
   - Generates audio (~2–5s)
   - Displays result with player

### 3. Optional: Personality Rewrite (Phase 1)

Automatically detects available LLM backend:

**Claude API** (best quality)
```bash
# .env or environment variable
ANTHROPIC_API_KEY=sk-...
```
Cost: ~¢0.01 per rewrite (200 tokens)

**Ollama** (free, offline)
```bash
# Install: https://ollama.ai
ollama pull mistral

# Server auto-detects Ollama at http://localhost:11434
```

**Skip** (default, no rewrite)
Uses raw input text as-is.

## Directory Structure

After first run:

```
voice-character-emulator/
├── app/                   # Python backend
│   ├── main.py           # FastAPI server
│   ├── tts.py            # XTTS-v2 wrapper
│   ├── jobs.py           # Async job queue
│   ├── refs.py           # Reference clip handling
│   └── personality.py    # Optional LLM rewrite
├── web/                  # Frontend UI
├── characters.yaml       # Character config + prompts
├── refs/                 # Your reference clips (gitignored)
│   ├── ironman/
│   │   ├── en/
│   │   │   ├── neutral.wav
│   │   │   ├── confident.wav
│   │   │   └── sarcastic.wav
│   │   └── cs/
│   │       └── neutral.wav
│   └── batman/ ...
├── out/                  # Generated audio (gitignored)
│   └── generated_*.wav
└── requirements.txt
```

## Troubleshooting

### XTTS model download hangs
```bash
# Check internet. Model (~1.8 GB) downloads to:
# Linux/macOS: ~/.cache/huggingface/hub/
# Windows: %USERPROFILE%\.cache\huggingface\hub\

# Restart server to retry
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### "ModuleNotFoundError: No module named 'TTS'"
```bash
# XTTS-v2 is part of coqui-tts package
pip install coqui-tts

# Verify PyTorch was installed BEFORE coqui-tts
pip list | grep -E "torch|coqui"
```

### "Out of Memory" (CUDA)
```bash
# XTTS model is ~2.5 GB VRAM. Solutions:
# 1. Close other GPU apps
# 2. Use CPU:
TTS_USE_CUDA=false python -m uvicorn app.main:app ...
# 3. Reduce other apps' VRAM usage
```

### Czech audio quality is low
- Czech is underrepresented in XTTS training data
- Use English reference clip + Czech text (cross-lingual)
  - English-accented Czech is sometimes intentional for characters
- Ensure reference clip is very clean (check SNR on upload)

### Generated audio has background noise
- **Reference clip quality is critical** (determines 80% of output quality)
- Check SNR estimate on upload; if <15 dB, try different source
- Use podcast/interview, not movie trailer (music overlay ruins output)

### "Connection refused" on http://localhost:8000
```bash
# Check server running:
ps aux | grep uvicorn

# Check port 8000 available:
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows

# If occupied, use different port:
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

## Performance Optimization

### GPU Acceleration

Automatic via PyTorch's CUDA / Metal detection. To force CPU:

```bash
TTS_USE_CUDA=false python -m uvicorn app.main:app ...
```

### Best-of-N Variants

Generate 3 variants, pick the best. Costs 3× time but often worth it:

```json
POST /api/generate
{
  "text": "I am Iron Man.",
  "num_variants": 3
}
```

Takes ~6–9s GPU, returns all three options.

### Text Splitting

Long text auto-splits into sentences for better prosody. Fine-tune via UI "Advanced" panel.

## Configuration

### Character System Prompts

Edit `characters.yaml` to customize personality rewrite behavior:

```yaml
characters:
  ironman:
    system_prompt: |
      You are Tony Stark (Iron Man). Respond with characteristic wit and sarcasm.
      Use tech references and confident assertions.
```

### TTS Parameters (Advanced UI)

Visible under "Advanced" in UI:

| Param | Range | Effect |
|-------|-------|--------|
| temperature | 0.5–1.0 | Lower = stable, Higher = varied |
| speed | 0.8–1.2 | Speech tempo |
| repetition_penalty | 1.0–3.0 | Prevent stuttering |
| length_penalty | 0.8–1.2 | Output duration |

### Environment Variables

```bash
# Optional
ANTHROPIC_API_KEY=sk-...            # Claude API
OLLAMA_BASE_URL=http://localhost:11434  # Custom Ollama host
TTS_USE_CUDA=false                  # Force CPU
```

## Storage

| Item | Size | Notes |
|------|------|-------|
| XTTS model | ~1.8 GB | Downloaded once, cached |
| Reference clips (5 chars × 3 emotions × 2 langs) | ~50–100 MB | Depends on source quality |
| Generated audio | ~50 KB per 3 sec | Short-lived, deleted after use |

**Total:** ~2 GB after first run (mostly model cache)

## Advanced: Ollama Local LLM

For offline personality rewrite:

```bash
# Install Ollama: https://ollama.ai

# Download a model (~4 GB):
ollama pull mistral
# (or: ollama pull neural-chat, orca-mini, etc.)

# Ollama runs on http://localhost:11434 by default
# App auto-detects and uses for Phase 1 rewrites
```

No config needed — app finds Ollama automatically.

---

**Built with XTTS-v2 and ❤️**

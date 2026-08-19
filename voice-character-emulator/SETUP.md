# 🎭 Voice Character Emulator — Setup Guide

Complete setup instructions for voice cloning with real actor voices.

## System Requirements

### Hardware
- **CPU**: Intel i5+ or equivalent
- **RAM**: 8GB minimum (16GB recommended)
- **GPU**: NVIDIA GPU with CUDA (optional but recommended for speed)
  - RVC training: ~1 min with GPU, ~5 min with CPU
  - Generation: ~2s with GPU, ~5s with CPU

### Software

#### macOS
```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install python@3.10 ffmpeg git node
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install python3.10 python3-pip ffmpeg git nodejs npm
```

#### Windows
1. Download and install:
   - [Python 3.10+](https://www.python.org/downloads/)
   - [Node.js](https://nodejs.org/)
   - [FFmpeg](https://ffmpeg.org/download.html)
   - [Git](https://git-scm.com/)

2. Add to PATH (Windows):
   - Python: `C:\Users\<YourUser>\AppData\Local\Programs\Python\Python310`
   - Node: Usually automatic
   - FFmpeg: Extract to `C:\ffmpeg`, add to PATH
   - Git: Usually automatic

## Installation Steps

### 1. Clone Repository
```bash
git clone https://github.com/jirin1997-wq/caveman.git
cd caveman/voice-character-emulator
```

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Install Python Dependencies
```bash
# Create virtual environment (optional but recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install requirements
pip install -r requirements.txt
```

### 4. Verify FFmpeg
```bash
ffmpeg -version
```

Should show version info. If not found, install FFmpeg properly.

### 5. Test Setup
```bash
npm start
```

Open http://localhost:3000

## First Time Usage

### Synthetic Voices (Fast)
1. Select character (Iron Man, Batman, etc.)
2. Tab: "🤖 Synthetic Voices"
3. Pick emotion
4. Type text
5. Click "Generate Voice 🎤"

✅ **First run**: ~30s (Bark downloads ~2GB models)
✅ **Subsequent**: ~2-5s per audio

### Cloned Voices (Real Actor Voices)
1. Select character
2. Tab: "🎬 Dubbed Voices"
3. Pick emotion
4. Type text
5. Click "Generate Voice 🎤"

⏳ **First run** (per character):
- YouTube download: ~30s
- RVC training: ~1-2 min (GPU) / ~5 min (CPU)
- Generation: ~5-10s

✅ **Subsequent**: ~5-10s per audio (model cached)

## Troubleshooting

### "Python script not found"
```bash
# Check Python installation
python3 --version  # Should be 3.8+

# Check scripts exist
ls src/voice_gen/
```

### "FFmpeg not found"
```bash
# macOS
brew install ffmpeg

# Ubuntu
sudo apt install ffmpeg

# Windows: add to PATH or reinstall
```

### "torch/CUDA not found"
```bash
# CPU-only (slower):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# GPU (NVIDIA):
pip install torch torchvision torchaudio  # Auto-detects CUDA
```

### "YouTube download fails"
```bash
# Update yt-dlp
pip install --upgrade yt-dlp

# Check YouTube is accessible (not blocked)
# Try different video URL if specific one fails
```

### "Out of memory"
- Close other apps
- Use GPU if available
- Reduce audio length (max 120s recommended)
- Restart Python process

### "Audio quality is poor"
- Ensure reference audio is clear (Hollywood trailers work best)
- Try different movie clip (YouTube time range in code)
- Check sample rate: should be 22050 Hz

## Performance Tips

### Enable GPU (Faster Processing)

#### NVIDIA (CUDA)
```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

#### macOS (Metal)
```bash
pip install torch torchvision torchaudio  # Auto-uses Metal
```

### Batch Generate
Want multiple voices? Generate one after another — they'll cache and speed up.

### Use Shorter Text
- Recommendation: 10-30 words per generation
- Quality vs speed tradeoff

## Storage Requirements

| Component | Size | Notes |
|-----------|------|-------|
| Bark models | ~2GB | Downloaded once, reused |
| Node modules | ~200MB | Standard npm install |
| Python venv | ~500MB | Optional |
| Generated audio | ~1-5MB per file | Stored in `voices/generated/` |
| Training audio | ~5-10MB per character | Auto-downloaded from YouTube |

**Total**: ~3GB on first run (mostly models, cached after)

## Advanced Configuration

### Custom Movie References
Edit `src/voice_gen/youtube_extractor.py`:

```python
MOVIE_REFERENCES = {
    "your_character": {
        "en": "https://www.youtube.com/watch?v=YOUR_VIDEO_ID",
        "description": "Movie Title - Clip",
        "duration": (30, 120)  # (start_sec, end_sec)
    }
}
```

### Custom Emotions
Edit `src/voice_gen/rvc_voice_cloner.py`:

```python
emotion_prompts = {
    "your_emotion": "[Your emotional direction]",
}
```

### Voice Presets
Edit `src/voice_gen/bark_generator.py` or `rvc_voice_cloner.py`:

```python
VOICE_PRESETS = {
    "character": {
        "en": "v2/en_speaker_X",  # 0-11 available
        "cs": "v2/cs_speaker_Y"   # 0-4 available
    }
}
```

List all Bark voices: https://github.com/suno-ai/bark/blob/main/bark/assets/voice_presets.json

## Getting Help

- **Installation issues**: Check Python/Node/FFmpeg versions
- **Audio quality**: Try different YouTube clip time range
- **Performance**: Enable GPU or use CPU-only mode
- **GitHub Issues**: https://github.com/jirin1997-wq/caveman/issues

---

**Built with ❤️ for iconic characters — now with REAL actor voices! 🎬**

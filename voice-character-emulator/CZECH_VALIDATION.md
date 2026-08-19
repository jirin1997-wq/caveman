# Czech Output Validation — Step-by-Step

This document guides you through validating XTTS-v2's Czech output quality before full implementation.

**Status:** v2 stack implemented. Awaiting reference clip to validate Czech.

## Why This Matters

Czech is underrepresented in XTTS-v2's training data. Before committing to the full pipeline, we must verify:
1. Czech synthesis works at all (basic sanity check)
2. Intelligibility is acceptable (not garbled)
3. Prosody is usable (not robotic)
4. Cross-lingual (EN sample → CZ output) is acceptable

This is the **one unvalidated assumption** in the entire redesign.

## Step 1: Extract Reference Audio

You provided: https://www.youtube.com/watch?v=3TTrgzjqQlY (Iron Man Czech dubbing)

**Manual extraction:**

**Option A: FFmpeg + browser**
1. Open link in browser
2. Use yt-dlp CLI locally:
   ```bash
   yt-dlp -f bestaudio -x --audio-format wav "https://www.youtube.com/watch?v=3TTrgzjqQlY"
   ```
3. Extract a clean segment (~10–15s):
   ```bash
   ffmpeg -i downloaded_video.wav -ss 00:00:15 -t 15 ironman_cs_neutral.wav
   ```

**Option B: Online tools**
- youtube-dl.org
- y2mate.com
- Other video-to-audio converters

**Result:** `ironman_cs_neutral.wav` (mono or stereo, 10–20s, clean speech)

## Step 2: Upload Reference Clip

1. **Start server:**
   ```bash
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

2. **Upload via API:**
   ```bash
   curl -F "file=@ironman_cs_neutral.wav" \
     http://localhost:8000/api/refs/ironman/cs/neutral
   ```

3. **Check response:**
   ```json
   {
     "is_valid": true,
     "duration": 12.3,
     "estimated_snr_db": 22.5,
     "confidence": 0.95,
     "warnings": []
   }
   ```

   - ✅ `is_valid: true` → Clip is usable
   - ⚠️  `estimated_snr_db < 15` → Very noisy, try different source
   - ✅ `confidence > 0.8` → High quality

## Step 3: Test Czech Generation

Generate a test sentence in Czech:

```bash
curl -X POST http://localhost:8000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Jsem Iron Man.",
    "character": "ironman",
    "emotion": "neutral",
    "language": "cs",
    "use_personality_rewrite": false,
    "num_variants": 1
  }'
```

Response:
```json
{
  "job_id": "abc-123",
  "status": "pending"
}
```

Poll for result:
```bash
curl http://localhost:8000/api/jobs/abc-123
```

When `status: "completed"`, the audio is ready at `variants[0].audio_url`.

## Step 4: Evaluate Output

Download the generated audio and listen:

- ✅ **Success criteria:**
  - Speech is intelligible (can understand the Czech words)
  - Prosody is natural (not robotic, breathing points sensible)
  - Voice identity carries (sounds like the actor, even if accent slightly different)
  - No major artifacts (no cracking, stuttering, weird phoneme breaks)

- ⚠️  **Accept if:**
  - Czech pronunciation slightly accented (English actor speaking Czech)
  - Intonation sometimes odd (Czech prosody is tricky for multilingual models)
  - Not movie-quality, but usable

- ❌ **Fail if:**
  - Completely unintelligible (garbled Czech)
  - Heavy artifacts (model struggling with phonemes)
  - No voice identity (sounds like generic TTS)
  - Frequent cracking/stuttering

## Step 5: Compare with English

For baseline:

```bash
curl -X POST http://localhost:8000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "I am Iron Man.",
    "character": "ironman",
    "emotion": "neutral",
    "language": "en",
    "use_personality_rewrite": false
  }'
```

English should be noticeably better quality. Czech may be 10–20% lower quality, which is expected.

## Step 6: Cross-Lingual Test (Optional)

**Hypothesis:** If English reference + Czech text works reasonably, we can skip English-only recording.

Test:
```bash
# English reference (from video), Czech text
{
  "text": "Jsem Iron Man.",
  "character": "ironman",
  "emotion": "neutral",
  "language": "cs",
  "use_personality_rewrite": false
}
```

If this also works, we've confirmed cross-lingual synthesis + actor identity preservation.

## Interpretation

**Validation passes if:**
- Czech output is intelligible
- Voice identity is recognizable
- Acceptable for character dialogue (not award-winning, but functional)

**Action after passing:**
- Proceed with full v2 implementation (PLAN.md steps 6–9)
- Extract reference clips for all 5 characters (en + cs)
- Build UI for reference clip upload/validation
- Test with personality rewrite (Phase 1)

**Action if failing:**
- Investigate: Is reference clip bad quality? Try different source.
- Check: Is the clip actually in Czech or dubbed over music?
- Decide: Accept lower quality for Czech, or pivot to English-only app

## Technical Notes

- XTTS-v2 supports: `en`, `cs`, `zh`, `fr`, `de`, `hi`, `it`, `ja`, `ko`, `pl`, `pt`, `ru`, `es`, `tr`
- Czech is in the list and was part of training data (though underrepresented)
- Zero-shot = no fine-tuning needed, quality depends entirely on reference clip
- Cross-lingual works because XTTS encodes voice as language-agnostic embedding

## Files Needed

After this validation, place reference clips in:
```
refs/
  ironman/
    en/
      neutral.wav       (English actor or EN-language clip)
      confident.wav     (optional, for emotion variants)
    cs/
      neutral.wav       (Czech dubbing actor)
  batman/
    en/
      neutral.wav
    cs/
      neutral.wav
  ...
```

Each `.wav` should be:
- 6–20 seconds
- Mono or stereo (converted to mono)
- 22050 Hz+ sample rate
- SNR > 15 dB (ideally > 20 dB)

---

**Next:** Extract clip from https://www.youtube.com/watch?v=3TTrgzjqQlY and report Czech validation results.

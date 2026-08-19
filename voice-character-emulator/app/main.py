"""Voice Character Emulator v2 — FastAPI server with XTTS-v2 backend.

Model loads once at startup, stays in memory. Non-blocking generation via job queue.
Reference clips via bring-your-own (no YouTube auto-download).
"""

import asyncio
import logging
from pathlib import Path
from typing import Optional
import yaml

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .tts import get_xtts_engine
from .jobs import get_queue, JobStatus, GenerationVariant
from .refs import (
    get_reference_clip,
    validate_and_preprocess,
    ensure_refs_dir,
)
from .personality import get_rewriter

# Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Voice Character Emulator",
    description="Real actor voices via XTTS-v2 zero-shot cloning",
    version="2.0.0",
)

# Load characters config
def load_characters():
    """Load characters from YAML."""
    try:
        with open("characters.yaml") as f:
            return yaml.safe_load(f)
    except Exception as e:
        logger.error(f"Failed to load characters.yaml: {e}")
        return {"characters": {}}


CHARACTERS_CONFIG = load_characters()


# API Models
class GenerateRequest(BaseModel):
    """Request to generate voice audio."""
    text: str
    character: str
    emotion: str = "neutral"
    language: str = "en"
    use_personality_rewrite: bool = False
    num_variants: int = 1  # Best-of-N
    # Advanced XTTS parameters
    temperature: float = 0.65
    repetition_penalty: float = 2.0
    length_penalty: float = 1.0
    top_k: int = 50
    top_p: float = 0.85
    speed: float = 1.0


# Startup
@app.on_event("startup")
async def startup():
    """Load model and initialize on server start."""
    logger.info("🚀 Voice Character Emulator v2 starting...")
    ensure_refs_dir()
    # Trigger model load
    get_xtts_engine()
    get_rewriter()
    logger.info("✅ Server ready")


# Static files (web UI)
try:
    app.mount("/", StaticFiles(directory="web", html=True), name="web")
except Exception as e:
    logger.warning(f"Could not mount web UI: {e}")


# API Endpoints

@app.get("/api/characters")
async def list_characters():
    """List all available characters."""
    chars = CHARACTERS_CONFIG.get("characters", {})
    return {
        "characters": [
            {
                "id": char_id,
                "name": data.get("name"),
                "actor": data.get("actor"),
                "czech_dubbing_actor": data.get("czech_dubbing_actor"),
                "description": data.get("description"),
                "languages": data.get("languages", ["en"]),
            }
            for char_id, data in chars.items()
        ]
    }


@app.get("/api/emotions")
async def list_emotions():
    """List available emotions (mapped to reference clip structure)."""
    return {
        "emotions": [
            {
                "id": "neutral",
                "label": "Neutral",
                "description": "Natural speaking voice",
            },
            {
                "id": "confident",
                "label": "Confident",
                "description": "Strong, self-assured delivery",
            },
            {
                "id": "angry",
                "label": "Angry",
                "description": "Forceful, intense emotion",
            },
            {
                "id": "sarcastic",
                "label": "Sarcastic",
                "description": "Witty, ironic tone",
            },
            {
                "id": "mysterious",
                "label": "Mysterious",
                "description": "Cryptic, intriguing delivery",
            },
            {
                "id": "sad",
                "label": "Sad",
                "description": "Melancholic, downcast tone",
            },
            {
                "id": "humorous",
                "label": "Humorous",
                "description": "Funny, lighthearted delivery",
            },
            {
                "id": "desperate",
                "label": "Desperate",
                "description": "Urgent, pleading tone",
            },
        ]
    }


@app.post("/api/refs/{character}/{language}/{emotion}")
async def upload_reference_clip(
    character: str,
    language: str,
    emotion: str,
    file: UploadFile = File(...),
):
    """Upload and validate a reference audio clip.

    Validates: 6-20s duration, mono-compatible, single speaker, minimal noise.
    Preprocesses: Mono → 22050 Hz → Trim silence → Normalize loudness.

    Returns validation result and preprocessed clip path.
    """

    try:
        # Create temp directory for uploads
        temp_dir = Path("refs_temp")
        temp_dir.mkdir(exist_ok=True)

        # Save uploaded file
        temp_path = temp_dir / f"{character}_{language}_{emotion}_{file.filename}"
        with open(temp_path, "wb") as f:
            f.write(await file.read())

        # Validate and preprocess
        final_dir = Path("refs") / character / language
        final_dir.mkdir(parents=True, exist_ok=True)
        final_path = final_dir / f"{emotion}.wav"

        validation = validate_and_preprocess(str(temp_path), str(final_path))

        # Clean up temp file
        temp_path.unlink()

        if not validation.is_valid:
            final_path.unlink(missing_ok=True)
            return JSONResponse(
                status_code=400,
                content={
                    "is_valid": False,
                    "issues": validation.issues,
                    "warnings": validation.warnings,
                },
            )

        return {
            "is_valid": True,
            "duration": validation.duration,
            "sample_rate": validation.sample_rate,
            "estimated_snr_db": validation.estimated_snr,
            "confidence": validation.confidence,
            "path": str(final_path),
            "warnings": validation.warnings,
        }

    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate")
async def generate_voice(req: GenerateRequest, background_tasks: BackgroundTasks):
    """Start voice generation job (non-blocking).

    Returns job_id immediately. Client polls /api/jobs/<job_id> for progress.
    """

    # Validate character
    if req.character not in CHARACTERS_CONFIG.get("characters", {}):
        raise HTTPException(status_code=400, detail=f"Unknown character: {req.character}")

    # Create job
    queue = get_queue()
    job_id = await queue.create(
        character=req.character,
        text=req.text,
        language=req.language,
        emotion=req.emotion,
        num_variants=req.num_variants,
    )

    # Start generation in background
    background_tasks.add_task(
        _generate_job,
        job_id,
        req,
    )

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "Generation started. Poll /api/jobs/<job_id> for progress.",
    }


async def _generate_job(job_id: str, req: GenerateRequest):
    """Background task: generate voice for job."""

    queue = get_queue()
    tts = get_xtts_engine()
    rewriter = get_rewriter()

    try:
        await queue.mark_processing(job_id)

        # Get reference clip (with emotion fallback)
        try:
            ref_path = get_reference_clip(req.character, req.language, req.emotion)
        except FileNotFoundError as e:
            await queue.mark_failed(job_id, str(e))
            return

        # Optional: Rewrite into character's voice
        text = req.text
        if req.use_personality_rewrite:
            char_config = CHARACTERS_CONFIG.get("characters", {}).get(req.character, {})
            system_prompt = char_config.get("system_prompt", "")
            if system_prompt:
                text = await rewriter.rewrite(
                    text=text,
                    character=req.character,
                    system_prompt=system_prompt,
                )

        # Generate N variants
        variants = []
        for i in range(req.num_variants):
            try:
                output_path = tts.generate(
                    text=text,
                    reference_audio_path=str(ref_path),
                    language=req.language,
                    temperature=req.temperature,
                    repetition_penalty=req.repetition_penalty,
                    length_penalty=req.length_penalty,
                    top_k=req.top_k,
                    top_p=req.top_p,
                    speed=req.speed,
                )

                # Get duration
                import soundfile as sf
                data, sr = sf.read(output_path)
                duration = len(data) / sr

                variants.append(
                    GenerationVariant(
                        audio_url=f"/audio/{Path(output_path).name}",
                        duration=duration,
                        parameters={
                            "temperature": req.temperature,
                            "speed": req.speed,
                            "repetition_penalty": req.repetition_penalty,
                        },
                    )
                )
            except Exception as e:
                logger.error(f"Variant {i+1} failed: {e}")
                if req.num_variants == 1:
                    await queue.mark_failed(job_id, f"Generation failed: {str(e)}")
                    return

        if variants:
            await queue.mark_completed(job_id, variants)
        else:
            await queue.mark_failed(job_id, "No variants generated")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}")
        await queue.mark_failed(job_id, f"Unexpected error: {str(e)}")


@app.get("/api/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get job status and results (if completed)."""
    queue = get_queue()
    job = await queue.get(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return job.to_dict()


@app.get("/audio/{filename}")
async def serve_audio(filename: str):
    """Serve generated audio file."""
    audio_path = Path("out") / filename
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(audio_path, media_type="audio/wav")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "2.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

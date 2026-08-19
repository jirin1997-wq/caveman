#!/usr/bin/env python3
"""
YouTube video audio extractor for voice cloning.
Downloads movie clips and extracts audio for voice model training.
"""

import json
import sys
from pathlib import Path
import subprocess
import os

try:
    from yt_dlp import YoutubeDL
except ImportError:
    print(json.dumps({
        "error": "yt-dlp not installed. Run: pip install yt-dlp pydub",
        "status": "error"
    }), file=sys.stderr)
    sys.exit(1)

# Character movie references - YouTube trailer/clip URLs
MOVIE_REFERENCES = {
    "ironman": {
        "en": "https://www.youtube.com/watch?v=PBn_JrjdkXg",  # Iron Man Official Trailer
        "description": "Iron Man (2008) - Official Trailer",
        "duration": (30, 120)  # Extract 30-120 seconds
    },
    "batman": {
        "en": "https://www.youtube.com/watch?v=neI3_Hxc65g",  # Dark Knight Rises Trailer
        "description": "The Dark Knight Rises - Trailer",
        "duration": (45, 150)
    },
    "jamesbond": {
        "en": "https://www.youtube.com/watch?v=Q_uE7kEtABE",  # Skyfall Trailer
        "description": "Skyfall - Official Trailer",
        "duration": (30, 120)
    },
    "charlie_harper": {
        "en": "https://www.youtube.com/watch?v=9dEiKP3ql38",  # Two and a Half Men Theme/Clip
        "description": "Two and a Half Men - Opening",
        "duration": (20, 90)
    },
    "captain_sparrow": {
        "en": "https://www.youtube.com/watch?v=FfJt5upsUGQ",  # Pirates of Caribbean Trailer
        "description": "Pirates of the Caribbean - Official Trailer",
        "duration": (40, 120)
    }
}

def download_youtube_audio(url, output_path, start_time=0, duration=60):
    """Download audio from YouTube video."""

    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
                'preferredquality': '192',
            }],
            'outtmpl': str(output_path).replace('.wav', ''),
            'quiet': False,
            'no_warnings': False,
        }

        with YoutubeDL(ydl_opts) as ydl:
            print(f"📥 Downloading: {url}")
            info = ydl.extract_info(url, download=True)
            print(f"✅ Downloaded: {info.get('title', 'Unknown')}")

        return {
            "status": "downloaded",
            "url": url,
            "audio_file": str(output_path),
            "title": info.get('title', ''),
            "duration": info.get('duration', 0)
        }

    except Exception as e:
        return {
            "error": str(e),
            "status": "error",
            "url": url
        }

def extract_audio_segment(audio_file, start_sec=0, duration_sec=60, output_file=None):
    """Extract segment from audio file using ffmpeg."""

    if output_file is None:
        output_file = str(Path(audio_file).stem) + "_segment.wav"

    try:
        # Use ffmpeg to extract segment
        cmd = [
            'ffmpeg',
            '-i', str(audio_file),
            '-ss', str(start_sec),
            '-t', str(duration_sec),
            '-c:a', 'pcm_s16le',
            '-ar', '22050',  # RVC standard sample rate
            '-y',  # Overwrite
            str(output_file)
        ]

        subprocess.run(cmd, check=True, capture_output=True)

        return {
            "status": "extracted",
            "source_file": str(audio_file),
            "output_file": str(output_file),
            "start_time": start_sec,
            "duration": duration_sec
        }

    except Exception as e:
        return {
            "error": str(e),
            "status": "error"
        }

def prepare_character_voice(character, language='en'):
    """Prepare training audio for character voice."""

    if character not in MOVIE_REFERENCES:
        return {"error": f"Unknown character: {character}"}

    ref = MOVIE_REFERENCES[character]
    url = ref.get(language) or ref.get('en')

    output_dir = Path(f"voices/training/{character}")
    output_dir.mkdir(parents=True, exist_ok=True)

    # Download
    audio_file = output_dir / f"{character}_{language}_raw.wav"
    download_result = download_youtube_audio(url, str(audio_file))

    if download_result.get('error'):
        return download_result

    # Extract segment
    start, end = ref.get('duration', (30, 120))
    segment_file = output_dir / f"{character}_{language}_training.wav"
    extract_result = extract_audio_segment(
        str(audio_file),
        start_sec=start,
        duration_sec=min(end - start, 60),  # Max 60 seconds
        output_file=str(segment_file)
    )

    if extract_result.get('error'):
        return extract_result

    return {
        "status": "prepared",
        "character": character,
        "language": language,
        "training_file": str(segment_file),
        "description": ref.get('description', ''),
        "url": url
    }

if __name__ == "__main__":
    try:
        data = json.loads(sys.stdin.read())
        result = prepare_character_voice(
            data.get("character", ""),
            data.get("language", "en")
        )
        print(json.dumps(result))
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

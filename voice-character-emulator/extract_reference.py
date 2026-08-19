#!/usr/bin/env python3
"""Extract and validate reference audio clip from YouTube.

Usage:
    python extract_reference.py <youtube_url> <character> <language> <emotion>

Example:
    python extract_reference.py "https://www.youtube.com/watch?v=3TTrgzjqQlY" \
        ironman cs neutral
"""

import sys
import subprocess
from pathlib import Path
from app.refs import validate_and_preprocess

def extract_youtube_audio(url: str, output_path: str, duration_range=(6, 20)):
    """Download YouTube video and extract audio segment.

    Args:
        url: YouTube URL
        output_path: Where to save audio
        duration_range: (start_sec, end_sec) or None for full audio
    """

    try:
        import yt_dlp
    except ImportError:
        print("❌ yt-dlp not installed. Install with: pip install yt-dlp")
        return False

    print(f"📥 Downloading from YouTube: {url}")

    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
                'preferredquality': '192',
            }],
            'outtmpl': output_path.replace('.wav', ''),
            'quiet': False,
            'no_warnings': False,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            print(f"✅ Downloaded: {info.get('title', 'Unknown')}")
            print(f"   Duration: {info.get('duration', 'unknown')} seconds")

        return True
    except Exception as e:
        print(f"❌ Download failed: {e}")
        return False


def main():
    if len(sys.argv) < 4:
        print("Usage: python extract_reference.py <youtube_url> <character> <language> [emotion]")
        print("Example: python extract_reference.py 'https://www.youtube.com/watch?v=...' ironman cs neutral")
        sys.exit(1)

    url = sys.argv[1]
    character = sys.argv[2]
    language = sys.argv[3]
    emotion = sys.argv[4] if len(sys.argv) > 4 else "neutral"

    # Create temp directory
    temp_dir = Path("refs_temp")
    temp_dir.mkdir(exist_ok=True)
    temp_path = str(temp_dir / f"{character}_{language}_{emotion}_raw.wav")

    # Download
    if not extract_youtube_audio(url, temp_path):
        sys.exit(1)

    # Validate and preprocess
    refs_dir = Path("refs") / character / language
    refs_dir.mkdir(parents=True, exist_ok=True)
    final_path = str(refs_dir / f"{emotion}.wav")

    print(f"\n📊 Validating audio...")
    validation = validate_and_preprocess(temp_path, final_path)

    print(f"\n{'='*60}")
    print(f"VALIDATION RESULT")
    print(f"{'='*60}")
    print(f"Valid: {validation.is_valid}")
    print(f"Duration: {validation.duration:.1f}s")
    print(f"Sample rate: {validation.sample_rate} Hz")
    print(f"Channels: {validation.channels}")
    print(f"Estimated SNR: {validation.estimated_snr:.1f} dB")
    print(f"Confidence: {validation.confidence:.1%}")

    if validation.issues:
        print(f"\n❌ Issues:")
        for issue in validation.issues:
            print(f"   - {issue}")

    if validation.warnings:
        print(f"\n⚠️  Warnings:")
        for warning in validation.warnings:
            print(f"   - {warning}")

    if validation.is_valid:
        print(f"\n✅ Reference clip saved to: {final_path}")
        print(f"\n💡 Ready to generate Czech speech with this actor's voice!")
        return 0
    else:
        print(f"\n❌ Clip not suitable. Try a different source.")
        # Clean up invalid output
        Path(final_path).unlink(missing_ok=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())

"""ffmpeg plumbing: normalise the input, and render the files a singer gets.

The separated stems are never the deliverable on their own. What choirs
actually rehearse with is the real recording with their own line pushed to the
front — any separation artefacts hide under the original, and bleed from the
next section just sounds like the recording. Solo stems are still written, for
note-bashing, but they are the rough option and are labelled as such.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

SAMPLE_RATE = 44100
MP3_STEM_KBPS = "128k"
MP3_MIX_KBPS = "192k"

# How much the original ducks, and how much your own part lifts, in the default
# mix. -6/+4 keeps the recording clearly audible while your line sits on top.
ORIG_DUCK_DB = -6
PART_LIFT_DB = 4


def _run(args: list[str]) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{proc.stderr.strip()}")


def normalise(src: Path, dst: Path) -> Path:
    """Everything downstream assumes 44.1 kHz stereo WAV."""
    _run(["-i", str(src), "-ar", str(SAMPLE_RATE), "-ac", "2", "-c:a", "pcm_s16le", str(dst)])
    return dst


def duration_seconds(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1", str(path),
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def to_mono_mp3(src: Path, dst: Path) -> Path:
    """Stems are register-limited, so stereo buys nothing but memory."""
    _run(["-i", str(src), "-ac", "1", "-b:a", MP3_STEM_KBPS, str(dst)])
    return dst


def to_stereo_mp3(src: Path, dst: Path) -> Path:
    _run(["-i", str(src), "-ac", "2", "-b:a", MP3_MIX_KBPS, str(dst)])
    return dst


def predominant(orig: Path, part: Path, dst: Path) -> Path:
    """Original ducked, your part lifted on top. The default practice track."""
    _run([
        "-i", str(orig), "-i", str(part),
        "-filter_complex",
        f"[0:a]volume={ORIG_DUCK_DB}dB[a];"
        f"[1:a]volume={PART_LIFT_DB}dB,pan=stereo|c0=c0|c1=c0[b];"
        "[a][b]amix=inputs=2:duration=longest:normalize=0[m];"
        "[m]alimiter=limit=0.95[out]",
        "-map", "[out]", "-b:a", MP3_MIX_KBPS, str(dst),
    ])
    return dst


def split_ears(orig: Path, part: Path, dst: Path) -> Path:
    """Your part in the left ear, the whole choir in the right.

    One earbud in, lean either way — the trick every rehearsal pianist knows.
    """
    _run([
        "-i", str(orig), "-i", str(part),
        "-filter_complex",
        "[1:a]pan=mono|c0=c0[l];"
        "[0:a]pan=mono|c0=0.5*c0+0.5*c1[r];"
        "[l][r]join=inputs=2:channel_layout=stereo[out]",
        "-map", "[out]", "-b:a", MP3_MIX_KBPS, str(dst),
    ])
    return dst


def part_only(part: Path, dst: Path) -> Path:
    """Just the separated line. Rough by nature — good enough to learn notes."""
    _run([
        "-i", str(part),
        "-filter_complex", "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,pan=stereo|c0=c0|c1=c0[out]",
        "-map", "[out]", "-b:a", MP3_MIX_KBPS, str(dst),
    ])
    return dst

#!/usr/bin/env python3
"""Smoke test: synthesise a four-part quartet, then run it through the kitchen.

This proves the plumbing — ffmpeg, the models, the manifest — without needing a
real recording to hand. It says nothing about separation quality on real
singing; four clean synthetic voices are far easier than eight people per part
in a church.

    conda activate divisi
    python kitchen/selftest.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 44100

# A plain four-part progression, one chord per bar, in MIDI numbers.
# I-vi-IV-V-I in C, spaced the way a hymn would be.
CHORDS = [
    (72, 67, 60, 48),
    (69, 64, 60, 45),
    (72, 65, 57, 41),
    (71, 67, 62, 43),
    (72, 67, 64, 48),
]
BAR = 1.6


def voice(midi: float, seconds: float, vibrato: float, colour: float) -> np.ndarray:
    t = np.linspace(0, seconds, int(seconds * RATE), endpoint=False)
    f0 = 440 * 2 ** ((midi - 69) / 12)
    # a slow wobble and a slightly different harmonic mix per part, so the parts
    # are not literally identical waveforms an octave apart
    freq = f0 * (1 + 0.004 * np.sin(2 * np.pi * vibrato * t))
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    wave = np.sin(phase)
    for h, amp in enumerate([0.45, 0.28, 0.16, 0.09], start=2):
        wave += amp * colour * np.sin(h * phase)
    env = np.minimum(1.0, np.minimum(t / 0.06, (seconds - t) / 0.12))
    return (wave * np.clip(env, 0, 1)).astype(np.float32)


def build(path: Path) -> Path:
    parts = []
    for i, (vib, colour) in enumerate([(5.4, 0.7), (5.0, 0.85), (4.7, 1.0), (4.4, 1.15)]):
        line = np.concatenate([voice(chord[i], BAR, vib, colour) for chord in CHORDS])
        parts.append(line / np.max(np.abs(line)))
    mix = sum(parts) / len(parts)
    mix = np.stack([mix, mix], axis=1) * 0.8
    sf.write(str(path), mix, RATE)
    return path


def main() -> int:
    out = Path(__file__).resolve().parent / "_selftest"
    out.mkdir(exist_ok=True)
    wav = build(out / "quartet.wav")
    print(f"wrote {wav} ({len(CHORDS) * BAR:.1f}s)")

    cmd = [
        sys.executable,
        str(Path(__file__).resolve().parent / "run.py"),
        str(wav),
        "--title", "Selftest Quartet",
        "--out", str(out / "projects"),
        "--instruments", "no",
    ]
    print(" ".join(cmd))
    return subprocess.run(cmd).returncode


if __name__ == "__main__":
    raise SystemExit(main())

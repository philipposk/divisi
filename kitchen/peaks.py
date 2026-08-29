"""Waveform peaks, precomputed here so the player never decodes audio to draw."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

# Enough resolution to see phrases and find your place, small enough that the
# manifest stays a few tens of kilobytes.
POINTS_PER_SECOND = 40
MAX_POINTS = 24000


def compute(path: Path) -> list[float]:
    data, rate = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if mono.size == 0:
        return []

    seconds = mono.size / rate
    points = min(MAX_POINTS, max(1, int(seconds * POINTS_PER_SECOND)))
    bucket = max(1, mono.size // points)
    usable = (mono.size // bucket) * bucket
    blocks = np.abs(mono[:usable]).reshape(-1, bucket)
    peaks = blocks.max(axis=1)

    top = float(peaks.max()) or 1.0
    return [round(float(v / top), 3) for v in peaks]

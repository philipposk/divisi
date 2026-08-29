"""Model wrangling: strip the accompaniment, then split the singing into SATB.

Everything here shells out to ZFTurbo's Music-Source-Separation-Training, which
is the only maintained runner for the choir checkpoint we use. Keeping it at
arm's length means a toolkit update can't break our CLI, only the one call.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

KITCHEN = Path(__file__).resolve().parent
MSST = KITCHEN / "vendor" / "Music-Source-Separation-Training"
MODELS = KITCHEN / "models"
REGISTRY = json.loads((KITCHEN / "models.json").read_text())

# Below this, whatever the vocals model called "instrumental" is just bleed and
# reverb tail rather than a real piano, so the recording was a cappella and we
# are better off feeding the SATB model the untouched original.
ACCOMP_SILENCE_DB = -26.0


class KitchenError(RuntimeError):
    pass


def _rms_db(path: Path) -> float:
    data, _ = sf.read(str(path), dtype="float32", always_2d=True)
    if data.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(data))))
    return 20 * np.log10(max(rms, 1e-9))


def _find_config(spec: dict, model_dir: Path) -> Path:
    if spec.get("from") == "msst-repo":
        p = MSST / spec["path"]
        if p.exists():
            return p
        raise KitchenError(f"config missing from the toolkit: {p}")
    # Hugging Face repos vary in layout, so take the first yaml we find.
    named = model_dir / spec["file"]
    if named.exists():
        return named
    found = sorted(model_dir.rglob("*.yaml"))
    if found:
        return found[0]
    raise KitchenError(f"no config yaml under {model_dir} — run kitchen/setup.sh")


def _find_checkpoint(spec: dict, model_dir: Path) -> Path:
    named = model_dir / spec["file"]
    if named.exists():
        return named
    found = sorted(model_dir.rglob("*.ckpt")) + sorted(model_dir.rglob("*.th"))
    if found:
        return found[0]
    raise KitchenError(f"no checkpoint under {model_dir} — run kitchen/setup.sh")


def run_model(key: str, source: Path, out_dir: Path, force_cpu: bool = False) -> dict[str, Path]:
    """Run one separation model and return {stem name: wav path}."""
    if not MSST.exists():
        raise KitchenError(f"separation toolkit not installed at {MSST} — run kitchen/setup.sh")

    spec = REGISTRY[key]
    model_dir = MODELS / key
    config = _find_config(spec["config"], model_dir)
    checkpoint = _find_checkpoint(spec["checkpoint"], model_dir)

    # inference.py works on folders, so give it one containing only our file
    stage = out_dir / f"_{key}_in"
    stage.mkdir(parents=True, exist_ok=True)
    shutil.copy(source, stage / source.name)
    store = out_dir / f"_{key}_out"
    store.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        str(MSST / "inference.py"),
        "--model_type", spec["model_type"],
        "--config_path", str(config),
        "--start_check_point", str(checkpoint),
        "--input_folder", str(stage),
        "--store_dir", str(store),
    ]
    if spec.get("extract_instrumental"):
        # models with a single target only write that one stem unless asked
        cmd.append("--extract_instrumental")
    if force_cpu:
        cmd.append("--force_cpu")

    env = dict(os.environ)
    # SCNet has a couple of ops Metal does not implement; without this the run
    # dies half way instead of quietly using the CPU for those ops.
    env.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    print(f"  running {spec['model_type']} ({spec['purpose']})")
    proc = subprocess.run(cmd, cwd=str(MSST), env=env)
    if proc.returncode != 0:
        raise KitchenError(f"{key} separation failed (exit {proc.returncode})")

    produced: dict[str, Path] = {}
    for wav in sorted(store.rglob("*.wav")):
        for stem in spec["stems"]:
            if wav.stem.lower().endswith(stem):
                produced[stem] = wav
    if not produced:
        loose = sorted(store.rglob("*.wav"))
        raise KitchenError(
            f"{key} produced no recognisable stems. Files found: {[p.name for p in loose]}"
        )

    shutil.rmtree(stage, ignore_errors=True)
    return produced


def strip_accompaniment(source: Path, work: Path, mode: str, force_cpu: bool) -> tuple[Path, Path | None]:
    """Return (singing only, accompaniment or None).

    `mode` is auto / yes / no. On auto we run the model and then check whether
    the instrumental it produced actually contains anything — that check is what
    stops an a cappella recording from being needlessly mangled.
    """
    if mode == "no":
        return source, None

    try:
        stems = run_model("vocals", source, work, force_cpu=force_cpu)
    except KitchenError as e:
        if mode == "yes":
            raise
        print(f"  skipping accompaniment removal: {e}")
        return source, None

    vocals = stems.get("vocals")
    accomp = stems.get("instrumental")
    if vocals is None:
        return source, None

    if accomp is not None:
        level = _rms_db(accomp)
        print(f"  accompaniment level: {level:.1f} dB")
        if mode == "auto" and level < ACCOMP_SILENCE_DB:
            print("  sounds a cappella — keeping the original untouched")
            return source, None

    return vocals, accomp

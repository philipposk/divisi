#!/usr/bin/env python3
"""Divisi kitchen — turn a choir recording into per-section practice tracks.

    conda activate divisi
    python kitchen/run.py rehearsal.wav --title "Fauré — Sanctus"
    python kitchen/run.py ~/recordings/*.wav          # whole folder in one go

Out comes a project folder: ready-to-email MP3s for each section, plus the
stems and a manifest the web player reads.

What this can and cannot do is in ../docs/QUALITY.md. Short version: your own
line comes out clearly on top, and you will still hear the section next to you
underneath it. That is the honest state of the art, and it is also exactly the
format choirs have rehearsed with for thirty years.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mixes  # noqa: E402
import peaks  # noqa: E402
from separate import KitchenError, run_model, strip_accompaniment  # noqa: E402

PARTS = [
    ("S", "Soprano", "soprano"),
    ("A", "Alto", "alto"),
    ("T", "Tenor", "tenor"),
    ("B", "Bass", "bass"),
]


def slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE).strip()
    return re.sub(r"[\s_]+", "-", text) or "untitled"


def human(seconds: float) -> str:
    return f"{int(seconds) // 60}m {int(seconds) % 60}s"


def process(
    source: Path,
    out_root: Path,
    title: str | None,
    wanted: list[str],
    instruments: str,
    force_cpu: bool,
    keep_work: bool,
) -> Path:
    started = time.time()
    title = title or source.stem.replace("_", " ").replace("-", " ").strip()
    slug = slugify(title)
    project = out_root / slug
    work = project / "_work"
    stems_dir = project / "stems"
    mixes_dir = project / "mixes"
    for d in (work, stems_dir, mixes_dir):
        d.mkdir(parents=True, exist_ok=True)

    print(f"\n=== {title} ===")
    print("  normalising")
    src = mixes.normalise(source, work / "source.wav")
    duration = mixes.duration_seconds(src)
    print(f"  {human(duration)} of audio")

    print("  looking for accompaniment")
    singing, accomp = strip_accompaniment(src, work, instruments, force_cpu)

    print("  splitting the voices")
    satb = run_model("satb", singing, work, force_cpu=force_cpu)

    print("  rendering tracks")
    mixes.to_stereo_mp3(src, stems_dir / "original.mp3")
    manifest_parts = []
    manifest_mixes = []

    for pid, label, stem_key in PARTS:
        if pid not in wanted:
            continue
        stem_wav = satb.get(stem_key)
        if stem_wav is None:
            print(f"    {label}: model produced nothing, skipping")
            continue

        stem_mp3 = mixes.to_mono_mp3(stem_wav, stems_dir / f"{stem_key}.mp3")
        manifest_parts.append(
            {"id": pid, "label": label, "stem": f"stems/{stem_mp3.name}"}
        )

        base = f"{slug}_{label.upper()}"
        made = [
            ("predominant", mixes.predominant(src, stem_wav, mixes_dir / f"{base}.mp3")),
            ("split-ears", mixes.split_ears(src, stem_wav, mixes_dir / f"{base}-SPLIT.mp3")),
            ("part-only", mixes.part_only(stem_wav, mixes_dir / f"{base}-ONLY.mp3")),
        ]
        for kind, path in made:
            manifest_mixes.append({"part": pid, "kind": kind, "file": f"mixes/{path.name}"})
        print(f"    {label}: 3 mixes")

    accomp_rel = None
    if accomp is not None:
        accomp_mp3 = mixes.to_mono_mp3(accomp, stems_dir / "accompaniment.mp3")
        accomp_rel = f"stems/{accomp_mp3.name}"
        acc_mix = mixes.part_only(accomp, mixes_dir / f"{slug}_ACCOMPANIMENT.mp3")
        manifest_mixes.append({"part": None, "kind": "accompaniment", "file": f"mixes/{acc_mix.name}"})
        print("    Accompaniment: 1 mix")

    print("  drawing the waveform")
    manifest = {
        "version": 1,
        "title": title,
        "slug": slug,
        "source": source.name,
        "duration": duration,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "original": "stems/original.mp3",
        "accompaniment": accomp_rel,
        "parts": manifest_parts,
        "mixes": manifest_mixes,
        "peaks": peaks.compute(src),
        "bookmarks": [],
    }
    (project / "project.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

    if not keep_work:
        shutil.rmtree(work, ignore_errors=True)

    print(f"  done in {human(time.time() - started)} -> {project}")
    return project


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Split a choir recording into per-section practice tracks.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("inputs", nargs="+", type=Path, help="audio files to process")
    ap.add_argument("--title", help="piece name (defaults to the filename); ignored for batches")
    ap.add_argument("--out", type=Path, default=Path.home() / "Divisi", help="where projects go")
    ap.add_argument(
        "--parts",
        default="SATB",
        help="which sections sing on this recording, e.g. SAB or ATB (default SATB)",
    )
    ap.add_argument(
        "--instruments",
        choices=["auto", "yes", "no"],
        default="auto",
        help="remove piano/organ/band first (auto decides by listening, default)",
    )
    ap.add_argument("--cpu", action="store_true", help="force CPU instead of the GPU")
    ap.add_argument("--keep-work", action="store_true", help="keep intermediate files for debugging")
    args = ap.parse_args()

    wanted = [c for c in args.parts.upper() if c in "SATB"]
    if not wanted:
        print("--parts needs at least one of S A T B", file=sys.stderr)
        return 2

    # the separation toolkit runs with its own working directory, so every path
    # handed to it has to be absolute or it quietly finds nothing
    args.out = args.out.expanduser().resolve()
    inputs = [p.expanduser().resolve() for p in args.inputs]

    files = [p for p in inputs if p.is_file()]
    missing = [p for p in inputs if not p.is_file()]
    for p in missing:
        print(f"skipping {p}: not a file", file=sys.stderr)
    if not files:
        return 2

    args.out.mkdir(parents=True, exist_ok=True)
    failures = 0
    for i, f in enumerate(files):
        try:
            process(
                f,
                args.out,
                args.title if len(files) == 1 else None,
                wanted,
                args.instruments,
                args.cpu,
                args.keep_work,
            )
        except KitchenError as e:
            failures += 1
            print(f"\n!! {f.name}: {e}", file=sys.stderr)
        except KeyboardInterrupt:
            print("\nstopped", file=sys.stderr)
            return 130

    if failures:
        print(f"\n{failures} of {len(files)} failed", file=sys.stderr)
    return 1 if failures == len(files) else 0


if __name__ == "__main__":
    raise SystemExit(main())

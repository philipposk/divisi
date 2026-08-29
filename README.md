# Divisi

Practice tracks for choirs. Feed it a recording of your choir; get one track per
voice group, a player that slows down without going flat, and a loop you can pin
to the four bars nobody can sing yet.

Live at **[divisi.6x7.gr](https://divisi.6x7.gr)**.

There are two halves:

| | what it is | where it runs |
| --- | --- | --- |
| **the player** | the web app singers use | any browser, nothing uploaded |
| **the kitchen** | the separation pipeline | a Mac with the models installed |

The player works on its own — drop any recording in and you get slow-down,
looping, transpose and a mixer. The kitchen is what turns one recording into
four separated voices.

## What it can and cannot do

Pulling four clean voices out of a single choir recording is not a solved
problem. The published state of the art for exactly this task sits around 45–55%
note-level accuracy, and it fails in a predictable shape: **bass comes out best,
soprano is decent, alto is the worst** — alto overlaps the soprano range above
and the tenor range below, so there is often nothing in the audio that
distinguishes them.

So the deliverable is not "four isolated voices". It is the format choirs have
actually rehearsed with for decades: **the real recording, with your line lifted
on top of it.** Separation artefacts hide underneath the original, and bleed from
the section next to you just sounds like a choir.

Measured on the synthetic quartet in `kitchen/selftest.py`, correlation of each
separated stem against the true line:

| stem | soprano | alto | tenor | bass |
| --- | --- | --- | --- | --- |
| soprano | **0.77** | 0.43 | 0.27 | 0.17 |
| alto | 0.75 | *0.40* | 0.42 | 0.33 |
| tenor | 0.43 | 0.34 | **0.77** | 0.15 |
| bass | 0.09 | 0.45 | 0.26 | **0.81** |

Three of four land on the right part. Alto leans soprano, exactly as the
literature predicts. See [docs/QUALITY.md](docs/QUALITY.md).

## The player

Open [divisi.6x7.gr](https://divisi.6x7.gr) and drop in either a project folder
from the kitchen, or any audio file.

- **Speed** 40–125%, pitch held exactly. Slowing down does not flatten anybody.
- **Transpose** ±6 semitones, for when the choir sings it a tone down.
- **A–B loop** — drag across the waveform, then nudge each edge by 0.1 s.
- **Marks** — name spots ("Letter B"), jump to them, loop between two of them.
- **Mixer** — volume, mute, solo and pan per voice.
- **Four presets** — my part on top / my part alone / whole choir / split ears
  (your line left, the choir right).
- **Find the parts** — with no kitchen folder, the browser transcribes the
  recording and plays each line back as a plain tone. Useful for checking an
  entry; wrong often enough that you should not trust it over the score.
- **Download** the current mix as MP3, or every ready-made track as a zip.

Keyboard: `space` play · `←` `→` skip 5 s (shift for 1 s) · `[` `]` set loop ·
`L` clear loop · `1`–`4` pick your part.

Nothing is uploaded. Every file is read straight off the machine, and the app is
a static export, so it runs just as happily from a folder on a laptop.

### Sharing a piece by link

`divisi.6x7.gr/?project=<url of a published folder>` opens straight into the
player. The folder needs to be served with permissive CORS — an object store
like Cloudflare R2 or a Supabase public bucket is fine.

**Google Drive will not work as a link.** Drive refuses cross-origin reads and
serves a virus-scan interstitial whose confirm token only exists inside a page
the browser is already blocked from reading. Drive is still fine for *sending*
the folder — the recipient downloads it and opens it with "Choose a project
folder".

## The kitchen

```bash
bash kitchen/setup.sh          # once: conda env, toolkit, ~1 GB of weights
conda activate divisi
python kitchen/run.py rehearsal.wav --title "Fauré — Sanctus"
python kitchen/run.py ~/recordings/*.wav        # or a whole folder
```

Out comes `~/Divisi/<slug>/`:

```
project.json          manifest the player reads
stems/                original + one mono track per voice (+ accompaniment)
mixes/                ready-to-email MP3s, three per voice
```

Options:

| flag | what it does |
| --- | --- |
| `--parts SAB` | which sections sing on this recording (default `SATB`) |
| `--instruments auto\|yes\|no` | strip piano/organ/band first; `auto` decides by listening |
| `--cpu` | force CPU instead of the GPU |
| `--keep-work` | keep intermediates for debugging |

Roughly 2× realtime on Apple silicon, so a four-minute anthem takes about eight
minutes.

`python kitchen/selftest.py` synthesises a quartet and runs the whole pipeline,
which is the quickest way to check the install.

## How it works

```
recording ──▶ vocals model ──▶ SATB model ──▶ ffmpeg mixes ──▶ project folder
              (Mel-Band          (SCNet         (your part on
               Roformer)          masked)        top / split / only)
                                                        │
                                                        ▼
                                              player: one stretch node,
                                              one channel per stem
```

The player puts every stem into a **single** `signalsmith-stretch` node as its
own output channel. One node means one clock, so parts cannot drift apart at any
speed, and rate / transpose / loop apply to everything at once. It fans out
through a channel splitter into a gain and a panner per stem — that is the
mixer.

With no kitchen folder, the browser path is Basic Pitch for the notes, then
`src/lib/satb.ts` to decide who sang what: cut at every onset *and* offset, and
beam-search across the slices scoring pitch proximity, range fit, time gaps and
a heavy penalty for voices crossing.

## Layout

```
src/lib/player.ts      the stretch node and mixer
src/lib/satb.ts        note list -> one line per voice
src/lib/transcribe.ts  Basic Pitch
src/lib/synth.ts       guide tones
src/lib/dsp.ts         FFT and harmonic masking
kitchen/run.py         the CLI
kitchen/separate.py    model wrangling
kitchen/mixes.py       ffmpeg
```

## Licence

MIT for this code. The models are fetched at setup and are not redistributed
here — the choir checkpoint in particular carries no stated licence, so it stays
on the machine that downloaded it.

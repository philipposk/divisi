# What to expect from the separation

Short version: **use "my part on top", not "my part alone", and you will be
happy.** The rest of this explains why.

## The problem is genuinely unsolved

Separating one choir recording into four voice lines is an open research
problem, not a thing that exists and we failed to buy. Two reference points:

- Schramm, McLeod, Steedman & Benetos (ISMIR 2017), on exactly this task:
  **F-measure 45.3%** on Bach chorales, 46.9% on barbershop quartets.
- VoasCNN / VoasCLSTM (TISMIR 2022), on real audio: soprano 0.73–0.77,
  alto 0.51–0.56, tenor 0.54–0.56, bass 0.71–0.76.

Every system fails in the same shape, for a reason you can see on a piano:

```
MIDI:  40   45   50   55   60   65   70   75   80
B      |========================|                    E2–D4
T           |=========================|              C3–A4
A                |========================|          F3–D5
S                     |========================|     C4–A5
```

Alto overlaps tenor by 17 semitones and soprano by 15. When an alto and a
soprano sing the same note, no amount of processing can tell you which section
it came from — the information is not in the recording.

Bass separates well because it lives an octave below everything else.

## What we measured

`kitchen/selftest.py` synthesises a four-part quartet, runs the full pipeline,
and the stems correlate against the true lines like this:

| separated stem | vs true soprano | vs true alto | vs true tenor | vs true bass |
| --- | --- | --- | --- | --- |
| soprano | **0.77** | 0.43 | 0.27 | 0.17 |
| alto | 0.75 | *0.40* | 0.42 | 0.33 |
| tenor | 0.43 | 0.34 | **0.77** | 0.15 |
| bass | 0.09 | 0.45 | 0.26 | **0.81** |

Soprano, tenor and bass each match their own line best. Alto does not — it
correlates more with soprano than with itself.

Caveat in both directions: synthetic voices share a timbre, which removes a cue
a real model would use, but they are also perfectly in tune and never breathe.
Treat it as a smoke test of the pipeline, not a benchmark.

## Which output to use

The kitchen writes three mixes per voice. They are not equally good.

**`_SOPRANO.mp3` — your part on top.** The real recording at −6 dB with your
line at +4 dB over it. Use this one. Artefacts sit underneath the original, and
bleed from the next section sounds like a choir because it *is* a choir. This is
what rehearsal CDs have always sounded like.

**`_SOPRANO-SPLIT.mp3` — split ears.** Your line in the left ear, the whole
choir in the right. One earbud in, lean whichever way you need.

**`_SOPRANO-ONLY.mp3` — your part alone.** The separated stem, normalised. Good
for bashing out notes on a line you have never sung. It will sound watery, and
on alto it will sometimes be singing the soprano line. Do not learn rhythm from
it.

## When it will do badly

- **Alto**, always. If one section has to check against the score, it is this one.
- **Unison or near-unison passages.** There is nothing to separate.
- **Heavy reverb.** A cathedral tail smears the onsets the model keys off.
- **Divisi.** The model knows four parts. SSAATTBB will be flattened into four.
- **One voice much louder than the rest.** A strong soloist bleeds everywhere.
- **Very short recordings.** Under about ten seconds there is little context.

## When it will do well

- Close-recorded, balanced four-part singing.
- Homophonic writing — hymns, chorales, anthems — where the parts move together.
- Anything where the bass is what you needed.

## Making it better

In rough order of payoff:

1. **Record the sections separately.** Twenty minutes of a rehearsal gets you a
   perfect result and no models at all — the player takes the stems as they are.
2. **Use the score.** MusicXML or MIDI gives exact parts; symbolic voice
   separation is a solved problem at 0.96–0.99 F1. Not wired up yet.
3. **Feed it a cleaner recording.** Closer mic, less reverb, balanced sections.

Divisi used to try transcribing in the browser and synthesising each line as a
guide tone. It was removed: it ran at roughly 2.5x realtime while blocking the
page, and stacked two error sources — a transcriber mishearing notes, then an
assignment putting them in the wrong section. [Riffscribe](https://riffscribe.6x7.gr)
does transcription properly, with a score to check it against.

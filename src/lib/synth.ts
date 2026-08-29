/**
 * Offline synth for guide tones.
 *
 * Renders one voice line to audio so a section can hear their own notes clearly
 * over (or instead of) the recording. Deliberately a plain additive tone rather
 * than a sampled instrument: no assets to download, and a slightly reedy organ
 * timbre is easy to pick out of a choir mix without masking it.
 */

import type { Note } from "./satb";
import { midiToHz } from "./dsp";

export type Timbre = "organ" | "piano" | "sine";

export interface SynthOptions {
  timbre: Timbre;
  /** seconds of fade at note edges, stops clicks */
  fade: number;
  gain: number;
}

export const DEFAULT_SYNTH: SynthOptions = { timbre: "organ", fade: 0.012, gain: 0.85 };

/** Relative level of harmonics 1..n for each timbre. */
const PARTIALS: Record<Timbre, number[]> = {
  organ: [1, 0.5, 0.32, 0.18, 0.12, 0.07, 0.04],
  piano: [1, 0.34, 0.16, 0.09, 0.05, 0.03],
  sine: [1],
};

function envelope(t: number, dur: number, timbre: Timbre, fade: number): number {
  if (t < fade) return t / fade;
  const tail = dur - t;
  if (tail < fade) return Math.max(0, tail / fade);
  if (timbre === "piano") {
    // struck, not sustained — decays under a held choir line so it reads as a cue
    return Math.exp(-2.2 * (t - fade));
  }
  return 1;
}

/**
 * Render a voice line into a mono sample buffer.
 * Written straight into a Float32Array so it can be mixed or WAV-encoded.
 */
export function renderLine(
  notes: Note[],
  duration: number,
  sampleRate: number,
  opt: SynthOptions = DEFAULT_SYNTH
): Float32Array {
  const out = new Float32Array(Math.ceil(duration * sampleRate));
  const partials = PARTIALS[opt.timbre];

  for (const note of notes) {
    const start = Math.max(0, Math.floor(note.start * sampleRate));
    const end = Math.min(out.length, Math.ceil(note.end * sampleRate));
    if (end <= start) continue;
    const dur = (end - start) / sampleRate;
    const f0 = midiToHz(note.pitch);
    // a touch of vibrato keeps a long held tone from sounding like a test signal
    const vibRate = 5.2;
    const vibDepth = opt.timbre === "sine" ? 0 : 0.0035;

    for (let i = start; i < end; i++) {
      const t = (i - start) / sampleRate;
      const env = envelope(t, dur, opt.timbre, opt.fade);
      if (env <= 0) continue;
      const detune = 1 + vibDepth * Math.sin(2 * Math.PI * vibRate * t);
      let s = 0;
      for (let h = 0; h < partials.length; h++) {
        const freq = f0 * (h + 1) * detune;
        if (freq >= sampleRate / 2) break;
        s += partials[h] * Math.sin(2 * Math.PI * freq * t);
      }
      out[i] += (s / partials.length) * env * opt.gain;
    }
  }

  // soft-clip rather than hard-clip where notes butt up against each other
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]);
  return out;
}

/** Click track, so a section can rehearse in time without the recording. */
export function renderClick(
  bpm: number,
  beatsPerBar: number,
  duration: number,
  sampleRate: number
): Float32Array {
  const out = new Float32Array(Math.ceil(duration * sampleRate));
  const period = 60 / bpm;
  const len = Math.floor(0.035 * sampleRate);
  let beat = 0;
  for (let t = 0; t < duration; t += period, beat++) {
    const start = Math.floor(t * sampleRate);
    const freq = beat % beatsPerBar === 0 ? 1600 : 1000;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const env = Math.exp(-28 * (i / sampleRate));
      out[start + i] += Math.sin((2 * Math.PI * freq * i) / sampleRate) * env * 0.5;
    }
  }
  return out;
}

/** Sum several mono buffers at given gains into one. */
export function mixDown(sources: { data: Float32Array; gain: number }[], length: number): Float32Array {
  const out = new Float32Array(length);
  for (const src of sources) {
    const n = Math.min(length, src.data.length);
    for (let i = 0; i < n; i++) out[i] += src.data[i] * src.gain;
  }
  for (let i = 0; i < length; i++) out[i] = Math.tanh(out[i] * 0.9);
  return out;
}

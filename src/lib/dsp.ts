/**
 * Small DSP kit: FFT, STFT/ISTFT, and harmonic masking.
 *
 * Used to pull one voice group out of the real recording. Each singer's line is
 * a fundamental plus a stack of harmonics; if we know the line (from the
 * transcription) we can keep the bins that belong to it and duck the rest. It
 * is never surgical — choir parts share harmonics constantly — but it keeps
 * actual human voices instead of a synth beep, which is what a singer wants to
 * hear when they are checking a tricky entry.
 */

/* ------------------------------------------------------------------ */
/* FFT (in-place radix-2)                                              */
/* ------------------------------------------------------------------ */

export class FFT {
  readonly size: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint32Array;

  constructor(size: number) {
    if (size & (size - 1)) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** In-place transform. `inverse` also divides by N. */
  transform(re: Float32Array, im: Float32Array, inverse = false) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const tw = k * step;
          const wr = this.cos[tw];
          const wi = inverse ? -this.sin[tw] : this.sin[tw];
          const a = i + k;
          const b = a + len / 2;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/* ------------------------------------------------------------------ */
/* harmonic mask                                                       */
/* ------------------------------------------------------------------ */

export interface PitchPoint {
  /** seconds */
  time: number;
  /** MIDI note number, or null for silence */
  pitch: number | null;
}

export interface MaskOptions {
  fftSize: number;
  hopSize: number;
  /** how many harmonics of the fundamental to keep */
  harmonics: number;
  /** half-width of the kept band around each harmonic, in semitones */
  bandwidth: number;
  /** how loud everything outside the mask stays (0 = hard mute) */
  floor: number;
  /** keep this much of the untouched original underneath, for context */
  bleed: number;
}

export const DEFAULT_MASK: MaskOptions = {
  fftSize: 4096,
  hopSize: 1024,
  harmonics: 14,
  bandwidth: 0.6,
  floor: 0.06,
  bleed: 0.0,
};

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Turn a voice's note list into a frame-rate pitch track, so the mask knows
 * which fundamental to follow at every moment.
 */
export function notesToPitchTrack(
  notes: { start: number; end: number; pitch: number }[],
  duration: number,
  frameRate: number
): (number | null)[] {
  const frames = Math.ceil(duration * frameRate);
  const track: (number | null)[] = new Array(frames).fill(null);
  for (const n of notes) {
    const a = Math.max(0, Math.floor(n.start * frameRate));
    const b = Math.min(frames, Math.ceil(n.end * frameRate));
    for (let i = a; i < b; i++) track[i] = n.pitch;
  }
  return track;
}

/**
 * Keep the harmonic series of `pitchTrack` and duck everything else.
 *
 * Overlap-add with a Hann window at 75% overlap, so the windows sum flat and
 * there is no amplitude ripple.
 */
export function harmonicMask(
  input: Float32Array,
  sampleRate: number,
  pitchTrack: (number | null)[],
  opt: MaskOptions = DEFAULT_MASK
): Float32Array {
  const { fftSize, hopSize, harmonics, bandwidth, floor, bleed } = opt;
  const fft = new FFT(fftSize);
  const win = hann(fftSize);
  const out = new Float32Array(input.length);
  const norm = new Float32Array(input.length);

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const gain = new Float32Array(fftSize / 2 + 1);
  const binHz = sampleRate / fftSize;
  const ratio = Math.pow(2, bandwidth / 12);

  const frames = Math.max(1, Math.ceil((input.length - fftSize) / hopSize) + 1);

  for (let f = 0; f < frames; f++) {
    const off = f * hopSize;
    const pitch = pitchTrack[Math.min(pitchTrack.length - 1, Math.floor(f))] ?? null;

    for (let i = 0; i < fftSize; i++) {
      const s = off + i;
      re[i] = s < input.length ? input[s] * win[i] : 0;
      im[i] = 0;
    }

    if (pitch === null) {
      gain.fill(floor);
    } else {
      gain.fill(floor);
      const f0 = midiToHz(pitch);
      for (let h = 1; h <= harmonics; h++) {
        const centre = f0 * h;
        if (centre >= sampleRate / 2) break;
        const lo = Math.max(0, Math.floor((centre / ratio) / binHz));
        const hi = Math.min(gain.length - 1, Math.ceil((centre * ratio) / binHz));
        // higher harmonics are shared with other voices, so trust them less
        const g = h <= 4 ? 1 : Math.max(0.35, 1 - (h - 4) * 0.06);
        for (let b = lo; b <= hi; b++) gain[b] = Math.max(gain[b], g);
      }
    }

    fft.transform(re, im, false);
    for (let b = 0; b <= fftSize / 2; b++) {
      const g = gain[b];
      re[b] *= g;
      im[b] *= g;
      if (b > 0 && b < fftSize / 2) {
        const m = fftSize - b;
        re[m] *= g;
        im[m] *= g;
      }
    }
    fft.transform(re, im, true);

    for (let i = 0; i < fftSize; i++) {
      const s = off + i;
      if (s >= out.length) break;
      out[s] += re[i] * win[i];
      norm[s] += win[i] * win[i];
    }
  }

  for (let i = 0; i < out.length; i++) {
    if (norm[i] > 1e-6) out[i] /= norm[i];
    if (bleed > 0) out[i] = out[i] * (1 - bleed) + input[i] * bleed;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* buffer helpers                                                      */
/* ------------------------------------------------------------------ */

export function toMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  const scale = 1 / Math.max(1, buffer.numberOfChannels);
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}

export function peakNormalize(x: Float32Array, target = 0.89): Float32Array {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 1e-6) return x;
  const g = target / peak;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** Wrap raw samples in an AudioBuffer the player can use. */
export function monoBuffer(ctx: BaseAudioContext, data: Float32Array, sampleRate: number): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

/** 16-bit PCM WAV, so parts can be downloaded and shared on Drive. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const n = channels[0].length;
  const numCh = channels.length;
  const bytes = 44 + n * numCh * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  str(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, n * numCh * 2, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/**
 * Practice player.
 *
 * Every stem (the original recording plus one guide track per voice group)
 * lives in a single signalsmith-stretch node as its own output channel. One
 * node means one clock, so the parts can never drift apart no matter how far
 * the tempo is pulled down, and rate / transpose / loop apply to everything at
 * once. The node fans out through a splitter into a per-stem gain + pan, which
 * is the mixer.
 */

import type { StretchNode } from "signalsmith-stretch";

type StretchFactory = (
  context: BaseAudioContext,
  options?: AudioWorkletNodeOptions
) => Promise<StretchNode>;

let factory: Promise<StretchFactory> | null = null;

/**
 * Load the stretcher from /public at runtime rather than importing it.
 *
 * It registers its AudioWorklet by stringifying a function and handing the text
 * to addModule(). Bundlers rewrite that function's source, and the rewritten
 * text references module-loader globals that do not exist inside a worklet — the
 * worklet then throws on load and playback never starts. Going through a
 * constructed import keeps the bundler's hands off the file entirely.
 */
function loadStretch(): Promise<StretchFactory> {
  factory ??= (
    new Function("url", "return import(url)")(
      "/vendor/signalsmith-stretch.mjs"
    ) as Promise<{ default: StretchFactory }>
  ).then((m) => m.default);
  return factory;
}

export interface StemInput {
  id: string;
  label: string;
  color: string;
  /** mono samples at the context sample rate */
  data: Float32Array;
  gain?: number;
  pan?: number;
}

interface StemNodes {
  id: string;
  label: string;
  color: string;
  gain: GainNode;
  pan: StereoPannerNode;
  volume: number;
  muted: boolean;
}

/** One row of the mixer, as the UI sees it. */
export interface MixerChannel {
  id: string;
  label: string;
  color: string;
  volume: number;
  muted: boolean;
  pan: number;
  soloed: boolean;
}

export interface PlayerState {
  playing: boolean;
  position: number;
  duration: number;
  rate: number;
  semitones: number;
  loop: [number, number] | null;
}

const SMOOTH = 0.015;

export class PracticePlayer {
  private ctx: AudioContext;
  private stretch!: StretchNode;
  private master: GainNode;
  private stems: StemNodes[] = [];
  private soloId: string | null = null;

  private _playing = false;
  private _rate = 1;
  private _semitones = 0;
  private _loop: [number, number] | null = null;
  private _duration = 0;
  private _position = 0;

  private listeners = new Set<(s: PlayerState) => void>();

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  static async create(ctx: AudioContext, inputs: StemInput[]): Promise<PracticePlayer> {
    if (!inputs.length) throw new Error("player needs at least one stem");
    const p = new PracticePlayer(ctx);

    // one channel per stem; all channels must be the same length
    const length = inputs.reduce((m, s) => Math.max(m, s.data.length), 0);
    const channels = inputs.map((s) => {
      if (s.data.length === length) return s.data;
      const padded = new Float32Array(length);
      padded.set(s.data);
      return padded;
    });

    const SignalsmithStretch = await loadStretch();
    // numberOfInputs stays 1 even though nothing is connected to it: while
    // paused the worklet reads inputList[0] unguarded, so declaring zero inputs
    // throws on the very first render quantum. Left unconnected it arrives as an
    // empty array, which is the signal to play from the loaded buffers instead.
    p.stretch = await SignalsmithStretch(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [inputs.length],
    });
    await p.stretch.addBuffers(channels);

    const split = ctx.createChannelSplitter(inputs.length);
    p.stretch.connect(split);

    inputs.forEach((s, i) => {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.gain.value = s.gain ?? 1;
      pan.pan.value = s.pan ?? 0;
      split.connect(gain, i, 0);
      gain.connect(pan).connect(p.master);
      p.stems.push({
        id: s.id,
        label: s.label,
        color: s.color,
        gain,
        pan,
        volume: s.gain ?? 1,
        muted: false,
      });
    });

    p._duration = length / ctx.sampleRate;
    p.stretch.schedule({ active: false, input: 0, rate: 1, semitones: 0 });
    p.stretch.setUpdateInterval(0.05, () => {
      p._position = p.stretch.inputTime ?? 0;
      p.emit();
    });
    return p;
  }

  /* ---------------- transport ---------------- */

  async play() {
    if (this._playing) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this._playing = true;
    this.stretch.schedule({ ...this.scheduleBase(), active: true });
    this.stretch.start();
    this.emit();
  }

  pause() {
    if (!this._playing) return;
    this._playing = false;
    this.stretch.schedule({ active: false });
    this.emit();
  }

  toggle() {
    return this._playing ? (this.pause(), Promise.resolve()) : this.play();
  }

  seek(seconds: number) {
    const t = Math.max(0, Math.min(this._duration, seconds));
    this._position = t;
    this.stretch.schedule({ ...this.scheduleBase(), input: t, active: this._playing });
    this.emit();
  }

  /** Nudge by a few seconds — the "play that bit again" button. */
  nudge(seconds: number) {
    this.seek(this._position + seconds);
  }

  /* ---------------- speed / key ---------------- */

  /** 1 = original tempo. Pitch is held regardless. */
  setRate(rate: number) {
    this._rate = Math.max(0.25, Math.min(1.5, rate));
    this.stretch.schedule({ ...this.scheduleBase(), active: this._playing });
    this.emit();
  }

  /** Transpose the whole thing, for choirs that sing a song down a tone. */
  setSemitones(semitones: number) {
    this._semitones = Math.max(-12, Math.min(12, Math.round(semitones)));
    this.stretch.schedule({ ...this.scheduleBase(), active: this._playing });
    this.emit();
  }

  /* ---------------- loop ---------------- */

  setLoop(start: number, end: number) {
    const a = Math.max(0, Math.min(start, end));
    const b = Math.min(this._duration, Math.max(start, end));
    this._loop = b - a < 0.25 ? null : [a, b];
    this.stretch.schedule({ ...this.scheduleBase(), active: this._playing });
    this.emit();
  }

  clearLoop() {
    this._loop = null;
    this.stretch.schedule({ ...this.scheduleBase(), active: this._playing });
    this.emit();
  }

  /* ---------------- mixer ---------------- */

  setVolume(id: string, v: number) {
    const stem = this.stems.find((s) => s.id === id);
    if (!stem) return;
    stem.volume = Math.max(0, Math.min(1.5, v));
    this.applyGains();
  }

  setPan(id: string, v: number) {
    const stem = this.stems.find((s) => s.id === id);
    if (!stem) return;
    stem.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, v)), this.ctx.currentTime, SMOOTH);
  }

  toggleMute(id: string) {
    const stem = this.stems.find((s) => s.id === id);
    if (!stem) return;
    stem.muted = !stem.muted;
    this.applyGains();
  }

  /** Solo is the button a singer actually uses: just my part, nothing else. */
  setSolo(id: string | null) {
    this.soloId = this.soloId === id ? null : id;
    this.applyGains();
  }

  get solo() {
    return this.soloId;
  }

  setMasterVolume(v: number) {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), this.ctx.currentTime, SMOOTH);
  }

  private applyGains() {
    const now = this.ctx.currentTime;
    for (const s of this.stems) {
      const audible = !s.muted && (this.soloId === null || this.soloId === s.id);
      s.gain.gain.setTargetAtTime(audible ? s.volume : 0, now, SMOOTH);
    }
    this.emit();
  }

  get mixer(): MixerChannel[] {
    return this.stems.map((s) => ({
      id: s.id,
      label: s.label,
      color: s.color,
      volume: s.volume,
      muted: s.muted,
      pan: s.pan.pan.value,
      soloed: this.soloId === s.id,
    }));
  }

  /* ---------------- plumbing ---------------- */

  private scheduleBase() {
    return {
      rate: this._rate,
      semitones: this._semitones,
      loopStart: this._loop ? this._loop[0] : 0,
      loopEnd: this._loop ? this._loop[1] : 0,
    };
  }

  get state(): PlayerState {
    return {
      playing: this._playing,
      position: this._position,
      duration: this._duration,
      rate: this._rate,
      semitones: this._semitones,
      loop: this._loop,
    };
  }

  subscribe(fn: (s: PlayerState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }

  destroy() {
    try {
      this.stretch.schedule({ active: false });
      this.stretch.dropBuffers();
      this.stretch.disconnect();
    } catch {
      /* context may already be closed */
    }
    this.listeners.clear();
  }
}

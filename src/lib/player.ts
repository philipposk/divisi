/**
 * Practice player.
 *
 * Speed and pitch changes are rendered *offline* — the whole piece is
 * time-stretched ahead of time into a plain AudioBuffer — and playback is then
 * an ordinary AudioBufferSourceNode. That is the reliable way to use this
 * library: running its stretcher live in an AudioWorklet was tried first and
 * comes up producing silence and never advancing, depending on how and when the
 * AudioContext was created, and once wedged it reports a negative position
 * forever. The same code renders offline perfectly.
 *
 * Every stem is one channel of a single multichannel buffer, so one render pass
 * covers the lot and the parts cannot drift apart no matter how far the tempo is
 * pulled down. Playback splits that buffer back out into a gain and a panner per
 * stem, which is the mixer.
 *
 * At 100% speed with no transpose nothing is rendered at all, so pressing play
 * is instant.
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
 * It builds its AudioWorklet by calling toString() on its own WASM loader and
 * shipping that source into the worklet. Any bundler that renames or re-scopes
 * that function breaks the trick and every call hangs with no error. Importing
 * the untouched file straight from /vendor keeps the source self-contained.
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
  /** mono samples at the project sample rate */
  data: Float32Array;
  gain?: number;
  pan?: number;
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
  /** 0..1 while re-rendering after a speed or key change, else null */
  rendering: number | null;
}

interface Channel {
  id: string;
  label: string;
  color: string;
  gain: GainNode;
  pan: StereoPannerNode;
  volume: number;
  muted: boolean;
}

const SMOOTH = 0.02;
const cacheKey = (rate: number, semitones: number) => `${rate.toFixed(3)}|${semitones}`;

export class PracticePlayer {
  private stems: StemInput[];
  private sampleRate: number;
  private ctx: AudioContext | null = null;
  private channels: Channel[] = [];
  private source: AudioBufferSourceNode | null = null;

  /** rendered audio per (rate, semitones) */
  private cache = new Map<string, AudioBuffer>();
  private renderJob: Promise<AudioBuffer> | null = null;
  private renderKey = "";
  /** bumped whenever something supersedes an in-flight render or start */
  private generation = 0;

  private _duration = 0;
  private _rate = 1;
  private _semitones = 0;
  private _loop: [number, number] | null = null;
  private _playing = false;
  private _rendering: number | null = null;
  private soloId: string | null = null;

  /** where the current run started, in song time and in context time */
  private anchorSong = 0;
  private anchorCtx = 0;
  private ticker: number | null = null;

  private listeners = new Set<(s: PlayerState) => void>();

  private constructor(stems: StemInput[], sampleRate: number) {
    this.stems = stems;
    this.sampleRate = sampleRate;
    this._duration = stems.length
      ? Math.max(...stems.map((s) => s.data.length)) / sampleRate
      : 0;
  }

  static async create(stems: StemInput[], sampleRate: number): Promise<PracticePlayer> {
    if (!stems.length) throw new Error("player needs at least one stem");
    return new PracticePlayer(stems, sampleRate);
  }

  /* ---------------- audio graph ---------------- */

  /** The realtime context is created on the first play, inside the click. */
  private async context(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const ctx = new AudioContext({ sampleRate: this.sampleRate });
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    this.ctx = ctx;

    for (const stem of this.stems) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.gain.value = stem.gain ?? 1;
      pan.pan.value = stem.pan ?? 0;
      gain.connect(pan).connect(ctx.destination);
      this.channels.push({
        id: stem.id,
        label: stem.label,
        color: stem.color,
        gain,
        pan,
        volume: stem.gain ?? 1,
        muted: false,
      });
    }
    this.applyGains();
    return ctx;
  }

  /** Pack the stems into one buffer, a channel each. */
  private packed(ctx: BaseAudioContext): AudioBuffer {
    const length = Math.max(...this.stems.map((s) => s.data.length));
    const buf = ctx.createBuffer(this.stems.length, length, this.sampleRate);
    this.stems.forEach((stem, i) => buf.getChannelData(i).set(stem.data));
    return buf;
  }

  /**
   * Time-stretched audio for the current speed and key, rendering if needed.
   * `rate` follows the library's convention: output length = input / rate.
   */
  private async buffer(): Promise<AudioBuffer> {
    const ctx = await this.context();
    const key = cacheKey(this._rate, this._semitones);
    const hit = this.cache.get(key);
    if (hit) return hit;

    if (this._rate === 1 && this._semitones === 0) {
      const plain = this.packed(ctx);
      this.cache.set(key, plain);
      return plain;
    }

    if (this.renderJob && this.renderKey === key) return this.renderJob;

    this.renderKey = key;
    const generation = this.generation;
    const channels = this.stems.length;

    this.renderJob = (async () => {
      const SignalsmithStretch = await loadStretch();
      this._rendering = 0;
      this.emit();

      const inLength = Math.max(...this.stems.map((s) => s.data.length));
      // slowing down makes the output longer; the tail is padding for the
      // stretcher's own latency
      const outLength = Math.ceil(inLength / this._rate) + Math.ceil(this.sampleRate * 0.25);

      const off = new OfflineAudioContext(channels, outLength, this.sampleRate);
      // one channel per stem, kept strictly separate rather than mixed down
      off.destination.channelInterpretation = "discrete";

      const node = await SignalsmithStretch(off, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
      });
      // Float32Array.from because the node keeps a reference to what it is given
      await node.addBuffers(this.stems.map((s) => Float32Array.from(s.data)));
      node.connect(off.destination);
      node.schedule({
        output: 0,
        active: true,
        input: 0,
        rate: this._rate,
        semitones: this._semitones,
      });

      this._rendering = 0.5;
      this.emit();
      const rendered = await off.startRendering();

      this._rendering = null;
      if (generation === this.generation) this.cache.set(key, rendered);
      this.emit();
      return rendered;
    })();

    try {
      return await this.renderJob;
    } finally {
      this.renderJob = null;
    }
  }

  /* ---------------- transport ---------------- */

  /** Position in song time, i.e. seconds of the original recording. */
  private position(): number {
    if (!this._playing || !this.ctx) return this.anchorSong;
    const elapsed = (this.ctx.currentTime - this.anchorCtx) * this._rate;
    let t = this.anchorSong + elapsed;
    if (this._loop) {
      const [a, b] = this._loop;
      const span = b - a;
      if (span > 0 && t > b) t = a + ((t - a) % span);
    }
    return Math.max(0, Math.min(this._duration, t));
  }

  private stopSource() {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  async play(from?: number) {
    const generation = ++this.generation;
    const startSong = Math.max(0, Math.min(this._duration, from ?? this.anchorSong));
    const ctx = await this.context();
    const buffer = await this.buffer();
    if (generation !== this.generation) return; // superseded while rendering

    this.stopSource();

    const splitter = ctx.createChannelSplitter(this.stems.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (this._loop) {
      src.loop = true;
      src.loopStart = this._loop[0] / this._rate;
      src.loopEnd = this._loop[1] / this._rate;
    }
    src.connect(splitter);
    this.channels.forEach((ch, i) => splitter.connect(ch.gain, i, 0));

    const when = ctx.currentTime + 0.08;
    // the rendered audio runs at 1/rate of song time
    src.start(when, startSong / this._rate);
    this.source = src;

    this.anchorSong = startSong;
    this.anchorCtx = when;
    this._playing = true;

    this.ticker = window.setInterval(() => {
      const t = this.position();
      if (!this._loop && t >= this._duration - 0.02) void this.pause(this._duration);
      else this.emit();
    }, 60);

    this.emit();
  }

  async pause(at?: number) {
    const t = at ?? this.position();
    this.stopSource();
    this.anchorSong = Math.max(0, Math.min(this._duration, t));
    this._playing = false;
    this.emit();
  }

  async toggle() {
    return this._playing ? this.pause() : this.play();
  }

  async seek(seconds: number) {
    const target = Math.max(0, Math.min(this._duration, seconds));
    if (this._playing) return this.play(target);
    this.anchorSong = target;
    this.emit();
  }

  /** Nudge by a few seconds — the "play that bit again" button. */
  nudge(seconds: number) {
    return this.seek(this.position() + seconds);
  }

  /** Stop, change something, then pick up where we were. */
  private async reflow(apply: () => void) {
    const resumeAt = this.position();
    const wasPlaying = this._playing;
    if (wasPlaying) this.stopSource();
    this._playing = false;
    apply();
    this.anchorSong = resumeAt;
    if (wasPlaying) await this.play(resumeAt);
    else this.emit();
  }

  /* ---------------- speed / key ---------------- */

  /** 1 = original tempo. The pitch is held regardless. */
  async setRate(rate: number) {
    const next = Math.max(0.4, Math.min(1.25, Math.round(rate * 100) / 100));
    if (next === this._rate) return;
    await this.reflow(() => {
      this._rate = next;
    });
  }

  /** Transpose the whole thing, for choirs that sing a song down a tone. */
  async setSemitones(semitones: number) {
    const next = Math.max(-6, Math.min(6, Math.round(semitones)));
    if (next === this._semitones) return;
    await this.reflow(() => {
      this._semitones = next;
    });
  }

  /* ---------------- loop ---------------- */

  async setLoop(start: number, end: number) {
    const a = Math.max(0, Math.min(start, end));
    const b = Math.min(this._duration, Math.max(start, end));
    const next: [number, number] | null = b - a < 0.25 ? null : [a, b];
    this._loop = next;
    if (!this._playing) {
      this.emit();
      return;
    }
    // restart so the source picks up the new loop points
    const here = this.position();
    await this.play(next ? Math.max(next[0], Math.min(next[1], here)) : here);
  }

  async clearLoop() {
    this._loop = null;
    if (!this._playing) {
      this.emit();
      return;
    }
    await this.play(this.position());
  }

  /* ---------------- mixer ---------------- */

  setVolume(id: string, v: number) {
    const ch = this.channels.find((c) => c.id === id);
    if (ch) {
      ch.volume = Math.max(0, Math.min(1.5, v));
      this.applyGains();
      return;
    }
    // before the first play there is no graph yet, so remember it for then
    const stem = this.stems.find((s) => s.id === id);
    if (stem) stem.gain = Math.max(0, Math.min(1.5, v));
    this.emit();
  }

  setPan(id: string, v: number) {
    const value = Math.max(-1, Math.min(1, v));
    const ch = this.channels.find((c) => c.id === id);
    if (ch && this.ctx) {
      ch.pan.pan.setTargetAtTime(value, this.ctx.currentTime, SMOOTH);
      this.emit();
      return;
    }
    const stem = this.stems.find((s) => s.id === id);
    if (stem) stem.pan = value;
    this.emit();
  }

  toggleMute(id: string) {
    const ch = this.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.muted = !ch.muted;
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

  private applyGains() {
    if (!this.ctx) {
      this.emit();
      return;
    }
    const now = this.ctx.currentTime;
    for (const ch of this.channels) {
      const audible = !ch.muted && (this.soloId === null || this.soloId === ch.id);
      ch.gain.gain.setTargetAtTime(audible ? ch.volume : 0, now, SMOOTH);
    }
    this.emit();
  }

  get mixer(): MixerChannel[] {
    if (this.channels.length) {
      return this.channels.map((c) => ({
        id: c.id,
        label: c.label,
        color: c.color,
        volume: c.volume,
        muted: c.muted,
        pan: c.pan.pan.value,
        soloed: this.soloId === c.id,
      }));
    }
    // the graph is built on first play, so describe the stems until then
    return this.stems.map((s) => ({
      id: s.id,
      label: s.label,
      color: s.color,
      volume: s.gain ?? 1,
      muted: false,
      pan: s.pan ?? 0,
      soloed: this.soloId === s.id,
    }));
  }

  /* ---------------- plumbing ---------------- */

  get state(): PlayerState {
    return {
      playing: this._playing,
      position: this.position(),
      duration: this._duration,
      rate: this._rate,
      semitones: this._semitones,
      loop: this._loop,
      rendering: this._rendering,
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

  async destroy() {
    this.generation++;
    this.stopSource();
    for (const ch of this.channels) ch.gain.disconnect();
    this.channels = [];
    this.cache.clear();
    this.renderJob = null;
    this.listeners.clear();
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = null;
    this._playing = false;
    this._rendering = null;
  }
}

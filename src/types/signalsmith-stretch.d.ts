declare module "signalsmith-stretch" {
  export interface StretchSchedule {
    /** AudioContext time this change should take effect */
    output?: number;
    active?: boolean;
    /** seek: position in the loaded buffer, in seconds */
    input?: number;
    /** 1 = original tempo; pitch is unaffected */
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    /** A-B loop, in seconds; disabled when start === end */
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchNode extends AudioWorkletNode {
    schedule(options: StretchSchedule): void;
    start(when?: number): void;
    stop(when?: number): void;
    /** one Float32Array per output channel, all the same length */
    addBuffers(channels: Float32Array[]): Promise<number>;
    dropBuffers(before?: number): Promise<unknown>;
    latency(): number;
    configure(options: { blockMs?: number; intervalMs?: number; splitComputation?: boolean }): void;
    setUpdateInterval(seconds: number, callback?: () => void): void;
    /** playback position within the loaded buffer, in seconds */
    inputTime: number;
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions
  ): Promise<StretchNode>;
}

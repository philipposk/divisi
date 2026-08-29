/**
 * Audio -> notes, using Spotify's Basic Pitch.
 *
 * This is the input to the voice splitter, and it is the weakest link in the
 * chain: a general-purpose polyphonic transcriber listening to eight people per
 * part singing vowels in a reverberant church. Expect it to be broadly right
 * about the shape of the lines and wrong about individual notes.
 */

import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from "@spotify/basic-pitch";

import { resampleMono } from "./decode";
import type { Note } from "./satb";

const MODEL_URL = "/models/basic-pitch/model.json";
const MODEL_RATE = 22050;

/** Frames per second the model reports at — needed because minNoteLen is in frames. */
const FRAME_RATE = MODEL_RATE / 256;

/** Clamp to the range a choir can actually produce: D2 up to C6. */
const MIN_HZ = 73.4;
const MAX_HZ = 1046.5;

let backendReady: Promise<void> | null = null;
let model: BasicPitch | null = null;

async function ensureBackend() {
  if (!backendReady) {
    backendReady = (async () => {
      // The WebGL backend crashes with a Metal shader error on modern iPhones
      // and iPads, so pin WASM everywhere rather than debugging per-device.
      setWasmPaths("/tfjs-wasm/");
      await tf.setBackend("wasm");
      await tf.ready();
    })();
  }
  return backendReady;
}

export async function warmUp() {
  await ensureBackend();
  model ??= new BasicPitch(MODEL_URL);
}

export interface TranscribeOptions {
  /** raise to keep fewer, more certain note starts */
  onsetThreshold: number;
  frameThreshold: number;
  /** shortest note to keep, in seconds */
  minNoteSeconds: number;
  onProgress?: (fraction: number) => void;
}

export const DEFAULT_TRANSCRIBE: Omit<TranscribeOptions, "onProgress"> = {
  onsetThreshold: 0.4,
  frameThreshold: 0.3,
  minNoteSeconds: 0.12,
};

export async function transcribe(
  buffer: AudioBuffer,
  options: Partial<TranscribeOptions> = {}
): Promise<Note[]> {
  const opt = { ...DEFAULT_TRANSCRIBE, ...options };
  await ensureBackend();
  model ??= new BasicPitch(MODEL_URL);

  const mono = await resampleMono(buffer, MODEL_RATE);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await model.evaluateModel(
    mono,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => opt.onProgress?.(Math.max(0, Math.min(1, p)))
  );

  const notes = noteFramesToTime(
    outputToNotesPoly(
      frames,
      onsets,
      opt.onsetThreshold,
      opt.frameThreshold,
      // this argument is a frame count in the JS port and milliseconds in the
      // Python one — passing milliseconds here silently drops every note
      Math.max(1, Math.round(opt.minNoteSeconds * FRAME_RATE)),
      true,
      MAX_HZ,
      MIN_HZ
    )
  );

  return notes.map((n) => ({
    start: n.startTimeSeconds,
    end: n.startTimeSeconds + n.durationSeconds,
    pitch: n.pitchMidi,
    confidence: Math.max(0, Math.min(1, n.amplitude)),
  }));
}

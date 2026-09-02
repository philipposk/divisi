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

/**
 * Pick a backend that can actually run this model.
 *
 * WASM is tried last on purpose: tfjs 3.x's WASM backend hands Basic Pitch's
 * graph a tensor with no dtype and dies with "Unknown dtype undefined", so it
 * is only a fallback for browsers with no WebGL at all.
 */
async function ensureBackend() {
  backendReady ??= (async () => {
    setWasmPaths("/tfjs-wasm/");
    for (const backend of ["webgl", "cpu", "wasm"] as const) {
      try {
        if (await tf.setBackend(backend)) {
          await tf.ready();
          return;
        }
      } catch {
        // try the next one
      }
    }
    throw new Error("No usable TensorFlow backend in this browser.");
  })();
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

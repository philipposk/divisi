/**
 * Getting audio back out — as MP3s to email round, or a zip of the lot.
 *
 * MP3 rather than WAV on purpose: these files get mailed to a choir and side
 * loaded onto whatever device each singer owns, and half of those devices are
 * a decade old.
 */

import { Mp3Encoder } from "@breezystack/lamejs";
import { downloadZip } from "client-zip";

import { openFile, type LoadedProject } from "./project";

const BITRATE = 160;

export function encodeMp3(samples: Float32Array, sampleRate: number): Blob {
  const encoder = new Mp3Encoder(1, sampleRate, BITRATE);
  const block = 1152;
  const chunks: Uint8Array[] = [];

  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  for (let i = 0; i < pcm.length; i += block) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, Math.min(i + block, pcm.length)));
    if (buf.length) chunks.push(new Uint8Array(buf));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));

  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

/** Sum stems at the gains currently showing on the mixer. */
export function mixStems(sources: { data: Float32Array; gain: number }[]): Float32Array {
  const length = sources.reduce((m, s) => Math.max(m, s.data.length), 0);
  const out = new Float32Array(length);
  for (const s of sources) {
    if (s.gain === 0) continue;
    for (let i = 0; i < s.data.length; i++) out[i] += s.data[i] * s.gain;
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.98) {
    const g = 0.98 / peak;
    for (let i = 0; i < length; i++) out[i] *= g;
  }
  return out;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // give the download a beat to start before the URL goes away
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Zip every ready-made mix the kitchen produced. Streams, so big folders are fine. */
export async function downloadAllMixes(project: LoadedProject) {
  const entries: { name: string; input: Blob }[] = [];
  for (const m of project.manifest.mixes) {
    const blob = await openFile(project, m.file);
    if (blob) entries.push({ name: m.file.split("/").pop()!, input: blob });
  }

  if (!entries.length) throw new Error("No ready-made mixes in this project.");

  const blob = await downloadZip(entries).blob();
  saveBlob(blob, `${project.manifest.slug}-practice-tracks.zip`);
}

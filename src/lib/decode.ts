/** Getting audio files into memory as mono samples at the context's rate. */

export async function decodeFile(ctx: BaseAudioContext, file: File | Blob): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  return ctx.decodeAudioData(bytes);
}

export function downmix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i];
  }
  const scale = 1 / buffer.numberOfChannels;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/**
 * Basic Pitch only accepts 22.05 kHz mono and throws on anything else, so this
 * runs before every transcription.
 */
export async function resampleMono(buffer: AudioBuffer, rate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === rate && buffer.numberOfChannels === 1) return buffer;
  const length = Math.max(1, Math.ceil((buffer.duration || 0) * rate));
  const off = new OfflineAudioContext(1, length, rate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

/** Peaks for the waveform, when the kitchen did not precompute them. */
export function computePeaks(data: Float32Array, points = 3000): number[] {
  if (!data.length) return [];
  const bucket = Math.max(1, Math.floor(data.length / points));
  const out: number[] = [];
  let top = 1e-6;
  for (let i = 0; i + bucket <= data.length; i += bucket) {
    let peak = 0;
    for (let j = i; j < i + bucket; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    out.push(peak);
    if (peak > top) top = peak;
  }
  return out.map((v) => Math.round((v / top) * 1000) / 1000);
}

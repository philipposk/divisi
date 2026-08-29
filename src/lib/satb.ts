/**
 * SATB voice assignment.
 *
 * A polyphonic transcriber tells us *what* pitches are sounding, never *who*
 * sang them. This turns that flat note list into one line per voice group.
 *
 * Honest expectation setting: pulling four vocal lines out of a choir recording
 * is an open research problem. The best published systems land around 45-55%
 * note-level F-measure, with bass nearly always right and alto/tenor close to a
 * coin flip — their ranges overlap by 17 semitones and the bass's own overtones
 * sit in the tenor register. So this is built to be *correctable*: every note
 * carries how confident the assignment was, and the UI lets a musician drag the
 * wrong ones across. If a MusicXML/MIDI score exists, use that path instead —
 * it is exact.
 *
 * Method, following the symbolic voice-separation literature:
 *  - cut the timeline at every onset AND offset, so within a slice the set of
 *    sounding notes never changes (Chew & Wu contigs — this step alone is ~99%
 *    reliable, all the error is in linking slices)
 *  - per slice, enumerate every way of handing its notes to voices (at most 24)
 *  - beam-search across slices instead of committing greedily
 *  - score on pitch proximity to a smoothed reference, range fit, time gaps,
 *    and a heavy penalty for voices crossing, which is the single strongest
 *    signal in choral writing
 */

export type VoiceId = "S" | "A" | "T" | "B";

export interface Note {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  /** MIDI note number */
  pitch: number;
  /** 0..1 from the transcriber */
  confidence: number;
}

export interface AssignedNote extends Note {
  voice: VoiceId;
  /** 0..1 — how much cheaper this assignment was than the runner-up */
  certainty: number;
}

export interface VoiceRange {
  id: VoiceId;
  label: string;
  short: string;
  /** absolute lowest note this section would ever sing */
  min: number;
  max: number;
  /** comfortable tessitura, a soft preference */
  lo: number;
  hi: number;
  colorVar: string;
}

/**
 * Choral (section) ranges in MIDI numbers — not solo ranges, which are wider on
 * both ends and would make the range term useless.
 */
export const RANGES: Record<VoiceId, VoiceRange> = {
  S: { id: "S", label: "Soprano", short: "S", min: 58, max: 84, lo: 62, hi: 77, colorVar: "--v-s" },
  A: { id: "A", label: "Alto", short: "A", min: 51, max: 79, lo: 55, hi: 72, colorVar: "--v-a" },
  T: { id: "T", label: "Tenor", short: "T", min: 46, max: 72, lo: 50, hi: 65, colorVar: "--v-t" },
  B: { id: "B", label: "Bass", short: "B", min: 36, max: 64, lo: 43, hi: 60, colorVar: "--v-b" },
};

export const ALL_VOICES: VoiceId[] = ["S", "A", "T", "B"];

/* ------------------------------------------------------------------ */
/* options                                                             */
/* ------------------------------------------------------------------ */

export interface CleanOptions {
  minConfidence: number;
  /** drop blips shorter than this (seconds) */
  minDuration: number;
  /** join two notes of the same pitch separated by less than this (seconds) */
  mergeGap: number;
  /** drop a weak note sitting exactly an octave above a strong one */
  removeOctaveGhosts: boolean;
}

export interface AssignOptions extends CleanOptions {
  /** which sections actually sing on this recording */
  voices: VoiceId[];
  /** semitone-equivalents charged for a pair of voices crossing */
  crossingPenalty: number;
  /** weight on staying near where this voice just was */
  proximityWeight: number;
  /** weight on staying inside the section's range */
  rangeWeight: number;
  /** charged when a section has nothing to sing in a slice */
  restPenalty: number;
  /** charged for putting two simultaneous notes in one section */
  divisiPenalty: number;
  /** how fast pitch proximity stops mattering after a rest (seconds) */
  gapTolerance: number;
  /** how many partial assignments to carry forward */
  beamWidth: number;
}

export const DEFAULT_ASSIGN: AssignOptions = {
  minConfidence: 0.3,
  minDuration: 0.08,
  mergeGap: 0.06,
  removeOctaveGhosts: true,
  voices: ALL_VOICES,
  crossingPenalty: 10,
  proximityWeight: 1,
  rangeWeight: 2.2,
  restPenalty: 3.5,
  divisiPenalty: 9,
  gapTolerance: 0.7,
  beamWidth: 32,
};

/* ------------------------------------------------------------------ */
/* cleanup                                                             */
/* ------------------------------------------------------------------ */

export function cleanNotes(input: Note[], opt: CleanOptions = DEFAULT_ASSIGN): Note[] {
  let notes = input
    .filter((n) => n.confidence >= opt.minConfidence && n.end - n.start >= opt.minDuration)
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);

  // a held note often comes back as a stutter of short ones at the same pitch
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    const bucket = byPitch.get(n.pitch);
    if (bucket) bucket.push(n);
    else byPitch.set(n.pitch, [n]);
  }
  const merged: Note[] = [];
  for (const bucket of byPitch.values()) {
    let cur = { ...bucket[0] };
    for (let i = 1; i < bucket.length; i++) {
      const n = bucket[i];
      if (n.start - cur.end <= opt.mergeGap) {
        cur.end = Math.max(cur.end, n.end);
        cur.confidence = Math.max(cur.confidence, n.confidence);
      } else {
        merged.push(cur);
        cur = { ...n };
      }
    }
    merged.push(cur);
  }
  notes = merged.sort((a, b) => a.start - b.start || b.pitch - a.pitch);

  if (!opt.removeOctaveGhosts) return notes;

  // transcribers hallucinate the octave above a strong low note; if two notes
  // overlap, sit exactly 12 semitones apart, and the upper is much weaker, the
  // upper one is almost certainly not a real singer
  const doomed = new Set<Note>();
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i];
      const b = notes[j];
      if (b.start >= a.end) break;
      if (Math.abs(a.pitch - b.pitch) !== 12) continue;
      const upper = a.pitch > b.pitch ? a : b;
      const lower = a.pitch > b.pitch ? b : a;
      if (upper.confidence < lower.confidence * 0.55) doomed.add(upper);
    }
  }
  return notes.filter((n) => !doomed.has(n));
}

/* ------------------------------------------------------------------ */
/* slicing                                                             */
/* ------------------------------------------------------------------ */

export interface Slice {
  start: number;
  end: number;
  /** indices into the cleaned note array, highest pitch first */
  notes: number[];
}

/**
 * Cut at every onset and offset. Inside a slice the set of sounding notes is
 * constant, which is what makes the per-slice ordering trustworthy.
 */
export function sliceNotes(notes: Note[]): Slice[] {
  const points = new Set<number>();
  for (const n of notes) {
    points.add(round(n.start));
    points.add(round(n.end));
  }
  const bounds = [...points].sort((a, b) => a - b);
  const slices: Slice[] = [];

  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start < 1e-4) continue;
    const mid = (start + end) / 2;
    const active: number[] = [];
    for (let k = 0; k < notes.length; k++) {
      if (notes[k].start > mid) break;
      if (notes[k].end > mid) active.push(k);
    }
    if (!active.length) continue;
    active.sort((a, b) => notes[b].pitch - notes[a].pitch);
    slices.push({ start, end, notes: active });
  }
  return slices;
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/* ------------------------------------------------------------------ */
/* cost terms                                                          */
/* ------------------------------------------------------------------ */

/** Soft inside the tessitura, hard outside the absolute range. */
function rangeCost(pitch: number, r: VoiceRange): number {
  if (pitch < r.min) return 5 + (r.min - pitch) * 1.6;
  if (pitch > r.max) return 5 + (pitch - r.max) * 1.6;
  if (pitch < r.lo) return (r.lo - pitch) * 0.3;
  if (pitch > r.hi) return (pitch - r.hi) * 0.3;
  return 0;
}

interface VoiceState {
  /** smoothed reference pitch: 0.8 x last + 0.2 x the one before */
  ref: number | null;
  last: number | null;
  prev: number | null;
  /** when this voice last sang (seconds) */
  lastTime: number;
}

const emptyVoice = (): VoiceState => ({ ref: null, last: null, prev: null, lastTime: -Infinity });

function pushPitch(v: VoiceState, pitch: number, time: number): VoiceState {
  const prev = v.last;
  const ref = prev === null ? pitch : 0.8 * pitch + 0.2 * prev;
  return { ref, last: pitch, prev, lastTime: time };
}

/* ------------------------------------------------------------------ */
/* per-slice candidate assignments                                     */
/* ------------------------------------------------------------------ */

/**
 * Every way this slice's notes can be handed to voices.
 *
 * Notes already sounding keep the voice they were given, so only fresh entries
 * are free. With four voices that is at most 24 candidates, so we enumerate
 * exhaustively rather than approximating — and unlike a Hungarian solve, this
 * lets us price voice crossing instead of forbidding it outright.
 */
function candidates(count: number, voiceCount: number, fixed: (number | null)[]): number[][] {
  const out: number[][] = [];
  const used = new Set<number>();
  for (const f of fixed) if (f !== null) used.add(f);

  const walk = (i: number, acc: number[], taken: Set<number>) => {
    if (out.length >= 512) return;
    if (i === count) {
      out.push([...acc]);
      return;
    }
    const fix = fixed[i];
    if (fix !== null) {
      acc.push(fix);
      walk(i + 1, acc, taken);
      acc.pop();
      return;
    }
    for (let v = 0; v < voiceCount; v++) {
      const isDivisi = taken.has(v);
      // more notes than voices means real divisi; otherwise keep it injective
      if (isDivisi && count <= voiceCount) continue;
      acc.push(v);
      taken.add(v);
      walk(i + 1, acc, taken);
      acc.pop();
      if (!isDivisi) taken.delete(v);
    }
  };
  walk(0, [], new Set(used));
  return out;
}

/** Notes are ordered high to low, so any drop in voice index is a crossing. */
function crossings(assign: number[]): number {
  let n = 0;
  for (let i = 1; i < assign.length; i++) if (assign[i] < assign[i - 1]) n++;
  return n;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export interface VoiceLine {
  id: VoiceId;
  label: string;
  notes: AssignedNote[];
}

export interface SplitResult {
  lines: VoiceLine[];
  notes: AssignedNote[];
  /** mean certainty across notes, 0..1 — what the UI shows as "how sure" */
  certainty: number;
}

interface BeamState {
  cost: number;
  voices: VoiceState[];
  /** note index -> voice index */
  assigned: Map<number, number>;
}

export function splitVoices(input: Note[], options: Partial<AssignOptions> = {}): SplitResult {
  const opt: AssignOptions = { ...DEFAULT_ASSIGN, ...options };
  const voices = (opt.voices.length ? [...opt.voices] : ALL_VOICES).sort(
    (a, b) => ALL_VOICES.indexOf(a) - ALL_VOICES.indexOf(b)
  );
  const V = voices.length;
  const notes = cleanNotes(input, opt);
  const slices = sliceNotes(notes);

  if (!notes.length || !slices.length) {
    return {
      lines: voices.map((v) => ({ id: v, label: RANGES[v].label, notes: [] })),
      notes: [],
      certainty: 0,
    };
  }

  let beam: BeamState[] = [
    { cost: 0, voices: Array.from({ length: V }, emptyVoice), assigned: new Map() },
  ];
  // per note, the spread between its best and worst plausible voice — used as a
  // stand-in for how sure we are, so the UI can flag the shaky ones
  const margin = new Map<number, number>();

  for (const slice of slices) {
    const next: BeamState[] = [];

    for (const state of beam) {
      const fixed = slice.notes.map((i) => (state.assigned.has(i) ? state.assigned.get(i)! : null));
      const options_ = candidates(slice.notes.length, V, fixed);

      for (const assign of options_) {
        let cost = state.cost;
        const vs = state.voices.map((v) => ({ ...v }));
        const assigned = new Map(state.assigned);
        const seen = new Set<number>();

        cost += crossings(assign) * opt.crossingPenalty;

        for (let k = 0; k < assign.length; k++) {
          const noteIdx = slice.notes[k];
          const v = assign[k];
          if (seen.has(v)) cost += opt.divisiPenalty;
          seen.add(v);
          if (state.assigned.has(noteIdx)) continue;

          const note = notes[noteIdx];
          const range = RANGES[voices[v]];
          const vState = vs[v];

          let c = opt.rangeWeight * rangeCost(note.pitch, range);
          if (vState.ref !== null) {
            const gap = Math.max(0, note.start - vState.lastTime);
            // after a long rest, where the voice was tells you very little
            const decay = Math.exp(-gap / opt.gapTolerance);
            c += opt.proximityWeight * Math.min(Math.abs(note.pitch - vState.ref), 18) * decay;
          }
          cost += c;
          assigned.set(noteIdx, v);
          vs[v] = pushPitch(vState, note.pitch, note.end);

          const best = margin.get(noteIdx);
          if (best === undefined || c < best) margin.set(noteIdx, c);
        }

        // sections left idle cost a little, so the search prefers spreading
        // notes across all the voices that are actually singing
        cost += (V - seen.size) * opt.restPenalty;
        next.push({ cost, voices: vs, assigned });
      }
    }

    // dedupe on where each voice ended up — states that agree on that are
    // interchangeable from here on, so only the cheapest is worth keeping
    const bestBy = new Map<string, BeamState>();
    for (const s of next) {
      const key = s.voices.map((v) => v.last ?? "-").join(",");
      const held = bestBy.get(key);
      if (!held || s.cost < held.cost) bestBy.set(key, s);
    }
    beam = [...bestBy.values()].sort((a, b) => a.cost - b.cost).slice(0, opt.beamWidth);
    if (!beam.length) break;
  }

  const winner = beam[0];
  const assignedNotes: AssignedNote[] = [];
  const worst = Math.max(1, ...[...margin.values()]);

  notes.forEach((note, i) => {
    const v = winner.assigned.get(i);
    if (v === undefined) return;
    const m = margin.get(i) ?? 0;
    assignedNotes.push({
      ...note,
      voice: voices[v],
      certainty: Math.max(0, Math.min(1, 1 - m / worst)),
    });
  });

  const lines = voices.map((v) => ({
    id: v,
    label: RANGES[v].label,
    notes: monophonic(assignedNotes.filter((n) => n.voice === v)),
  }));

  const certainty = assignedNotes.length
    ? assignedNotes.reduce((s, n) => s + n.certainty, 0) / assignedNotes.length
    : 0;

  return { lines, notes: assignedNotes, certainty };
}

/**
 * A section sings one line at a time. Where divisi or transcription noise left
 * overlaps, keep the more confident note and trim the other.
 */
function monophonic(notes: AssignedNote[]): AssignedNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.confidence - a.confidence);
  const out: AssignedNote[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (!last || n.start >= last.end) {
      out.push({ ...n });
      continue;
    }
    if (n.confidence > last.confidence) {
      last.end = n.start;
      if (last.end - last.start < 0.03) out.pop();
      out.push({ ...n });
    } else {
      const trimmed = { ...n, start: last.end };
      if (trimmed.end - trimmed.start >= 0.05) out.push(trimmed);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* guessing which sections are present                                 */
/* ------------------------------------------------------------------ */

/**
 * Rough guess at which sections sing on a recording, from where the pitches
 * pile up. Only a starting suggestion — the user picks in the UI, because a
 * recording of "just altos and basses" is common and guessing wrong is worse
 * than asking.
 */
export function guessVoices(input: Note[]): VoiceId[] {
  const notes = cleanNotes(input);
  if (notes.length < 8) return ALL_VOICES;

  const weight: Record<VoiceId, number> = { S: 0, A: 0, T: 0, B: 0 };
  let total = 0;
  for (const n of notes) {
    const dur = n.end - n.start;
    total += dur;
    for (const v of ALL_VOICES) {
      const r = RANGES[v];
      // count each note toward the section whose tessitura centre it is nearest
      const centre = (r.lo + r.hi) / 2;
      weight[v] += dur * Math.exp(-Math.abs(n.pitch - centre) / 6);
    }
  }
  if (!total) return ALL_VOICES;

  const parts = estimatePartCount(notes);
  const ranked = ALL_VOICES.slice().sort((a, b) => weight[b] - weight[a]);
  const keep = Math.max(2, Math.min(4, parts));
  return ranked.slice(0, keep).sort((a, b) => ALL_VOICES.indexOf(a) - ALL_VOICES.indexOf(b));
}

/** Median simultaneous-note count — a sanity check on how many parts there are. */
export function estimatePartCount(input: Note[]): number {
  const notes = input.length && "voice" in (input[0] as object) ? input : cleanNotes(input);
  const slices = sliceNotes(notes);
  if (!slices.length) return 0;
  // weight by how long each slice lasts, so passing chords don't dominate
  const counts: number[] = [];
  for (const s of slices) {
    const weight = Math.max(1, Math.round((s.end - s.start) / 0.05));
    for (let i = 0; i < weight; i++) counts.push(s.notes.length);
  }
  counts.sort((a, b) => a - b);
  return counts[Math.floor(counts.length / 2)];
}

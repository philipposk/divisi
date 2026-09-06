/**
 * The four voice groups, and the shared vocabulary for talking about them.
 *
 * Ranges are choral (section) ranges in MIDI numbers, not solo ranges — solo
 * ranges are wider at both ends and would be misleading here. They exist mostly
 * so the UI can say something sensible about who sings what.
 */

export type VoiceId = "S" | "A" | "T" | "B";

export interface VoiceRange {
  id: VoiceId;
  label: string;
  short: string;
  /** lowest note this section would normally be asked for */
  min: number;
  max: number;
  /** comfortable tessitura */
  lo: number;
  hi: number;
  colorVar: string;
}

export const RANGES: Record<VoiceId, VoiceRange> = {
  S: { id: "S", label: "Soprano", short: "S", min: 58, max: 84, lo: 62, hi: 77, colorVar: "--v-s" },
  A: { id: "A", label: "Alto", short: "A", min: 51, max: 79, lo: 55, hi: 72, colorVar: "--v-a" },
  T: { id: "T", label: "Tenor", short: "T", min: 46, max: 72, lo: 50, hi: 65, colorVar: "--v-t" },
  B: { id: "B", label: "Bass", short: "B", min: 36, max: 64, lo: 43, hi: 60, colorVar: "--v-b" },
};

/** Top to bottom, which is the order everything else assumes. */
export const ALL_VOICES: VoiceId[] = ["S", "A", "T", "B"];

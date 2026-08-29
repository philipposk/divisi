export function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Speed as a musician would say it, not as a float. */
export function fmtRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function fmtSemitones(n: number): string {
  if (n === 0) return "original key";
  const dir = n > 0 ? "up" : "down";
  const abs = Math.abs(n);
  return `${dir} ${abs} semitone${abs === 1 ? "" : "s"}`;
}

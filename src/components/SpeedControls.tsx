"use client";

import { fmtRate, fmtSemitones } from "@/lib/format";

interface Props {
  rate: number;
  semitones: number;
  onRate: (rate: number) => void;
  onSemitones: (n: number) => void;
}

const PRESETS = [0.5, 0.6, 0.75, 0.9, 1];

const chip = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm transition ${
    active
      ? "bg-[var(--accent)] text-black"
      : "border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
  }`;

export default function SpeedControls({ rate, semitones, onRate, onSemitones }: Props) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label htmlFor="rate" className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
            Speed
          </label>
          <span className="font-mono text-sm tabular-nums">{fmtRate(rate)}</span>
        </div>
        <input
          id="rate"
          type="range"
          min={0.4}
          max={1.25}
          step={0.01}
          value={rate}
          onChange={(e) => onRate(Number(e.target.value))}
          className="w-full"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p} className={chip(Math.abs(rate - p) < 0.005)} onClick={() => onRate(p)}>
              {fmtRate(p)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          The pitch stays put — slowing down will not flatten anybody.
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label htmlFor="key" className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
            Key
          </label>
          <span className="font-mono text-sm tabular-nums">{fmtSemitones(semitones)}</span>
        </div>
        <input
          id="key"
          type="range"
          min={-6}
          max={6}
          step={1}
          value={semitones}
          onChange={(e) => onSemitones(Number(e.target.value))}
          className="w-full"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button className={chip(semitones === 0)} onClick={() => onSemitones(0)}>
            Original
          </button>
          <button className={chip(false)} onClick={() => onSemitones(semitones - 1)}>
            −1
          </button>
          <button className={chip(false)} onClick={() => onSemitones(semitones + 1)}>
            +1
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          For when the choir sings it a tone down from the recording.
        </p>
      </div>
    </div>
  );
}

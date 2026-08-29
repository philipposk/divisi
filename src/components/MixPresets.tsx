"use client";

import { RANGES, type VoiceId } from "@/lib/satb";

export type MixMode = "predominant" | "solo" | "balanced" | "split";

const MODES: { id: MixMode; label: string; blurb: string }[] = [
  { id: "predominant", label: "My part on top", blurb: "the recording, with your line lifted over it" },
  { id: "solo", label: "My part alone", blurb: "just your line — rough, but good for learning notes" },
  { id: "balanced", label: "Whole choir", blurb: "the recording as it was" },
  { id: "split", label: "Split ears", blurb: "your line left, the choir right" },
];

interface Props {
  available: VoiceId[];
  myPart: VoiceId | null;
  mode: MixMode;
  onPart: (part: VoiceId | null) => void;
  onMode: (mode: MixMode) => void;
}

export default function MixPresets({ available, myPart, mode, onPart, onMode }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--fg-muted)]">I sing</p>
        <div className="flex flex-wrap gap-2">
          {available.map((id) => {
            const range = RANGES[id];
            const active = myPart === id;
            return (
              <button
                key={id}
                onClick={() => onPart(active ? null : id)}
                style={
                  active
                    ? { background: `var(${range.colorVar})`, color: "#07070a" }
                    : { borderColor: `color-mix(in srgb, var(${range.colorVar}) 45%, transparent)` }
                }
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition active:scale-95 ${
                  active ? "" : "border text-[var(--fg)] hover:bg-white/5"
                }`}
              >
                {range.label}
              </button>
            );
          })}
          {!available.length && (
            <p className="text-sm text-[var(--fg-muted)]">
              No separated parts in this project yet — the transport and looping still work.
            </p>
          )}
        </div>
      </div>

      {myPart && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--fg-muted)]">Hear it as</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => onMode(m.id)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  mode === m.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-white/5"
                }`}
              >
                <span className="block text-sm">{m.label}</span>
                <span className="block text-xs text-[var(--fg-muted)]">{m.blurb}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

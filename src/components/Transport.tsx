"use client";

import { fmtTime } from "@/lib/format";

interface Props {
  playing: boolean;
  position: number;
  duration: number;
  loop: [number, number] | null;
  onToggle: () => void;
  onNudge: (seconds: number) => void;
  onSetLoopEdge: (edge: 0 | 1) => void;
  onNudgeLoopEdge: (edge: 0 | 1, delta: number) => void;
  onClearLoop: () => void;
  onLoopLastBar: () => void;
}

const btn =
  "rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--fg)] transition hover:border-[var(--border-strong)] hover:bg-white/5 active:scale-95 disabled:opacity-40";

export default function Transport({
  playing,
  position,
  duration,
  loop,
  onToggle,
  onNudge,
  onSetLoopEdge,
  onNudgeLoopEdge,
  onClearLoop,
  onLoopLastBar,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onToggle}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-black transition active:scale-95"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg width="18" height="20" viewBox="0 0 18 20" fill="currentColor" aria-hidden>
              <rect x="1" y="1" width="5" height="18" rx="1.5" />
              <rect x="12" y="1" width="5" height="18" rx="1.5" />
            </svg>
          ) : (
            <svg width="18" height="20" viewBox="0 0 18 20" fill="currentColor" aria-hidden>
              <path d="M2 1.6a1 1 0 0 1 1.5-.87l12 8.4a1 1 0 0 1 0 1.74l-12 8.4A1 1 0 0 1 2 18.4z" />
            </svg>
          )}
        </button>

        <button className={btn} onClick={() => onNudge(-5)} aria-label="Back 5 seconds">
          −5s
        </button>
        <button className={btn} onClick={() => onNudge(5)} aria-label="Forward 5 seconds">
          +5s
        </button>

        <span className="ml-1 font-mono text-sm tabular-nums text-[var(--fg-muted)]">
          {fmtTime(position)} / {fmtTime(duration)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">Loop</span>
        <button className={btn} onClick={() => onSetLoopEdge(0)} title="Start the loop here (key: [)">
          Set A
        </button>
        <button className={btn} onClick={() => onSetLoopEdge(1)} title="End the loop here (key: ])">
          Set B
        </button>
        <button className={btn} onClick={onLoopLastBar} title="Loop the four seconds you just heard">
          Loop last 4s
        </button>

        {loop ? (
          <>
            <span className="rounded-lg border border-[var(--border)] px-3 py-2 font-mono text-xs tabular-nums">
              {fmtTime(loop[0])} → {fmtTime(loop[1])}
            </span>
            <div className="flex items-center gap-1">
              <button className={btn} onClick={() => onNudgeLoopEdge(0, -0.1)}>
                A−
              </button>
              <button className={btn} onClick={() => onNudgeLoopEdge(0, 0.1)}>
                A+
              </button>
              <button className={btn} onClick={() => onNudgeLoopEdge(1, -0.1)}>
                B−
              </button>
              <button className={btn} onClick={() => onNudgeLoopEdge(1, 0.1)}>
                B+
              </button>
            </div>
            <button className={btn} onClick={onClearLoop}>
              Clear
            </button>
          </>
        ) : (
          <span className="text-xs text-[var(--fg-muted)]">off — drag on the waveform to set one</span>
        )}
      </div>
    </div>
  );
}

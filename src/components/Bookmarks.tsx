"use client";

import { useState } from "react";

import { fmtTime } from "@/lib/format";
import type { Bookmark } from "@/lib/project";

interface Props {
  bookmarks: Bookmark[];
  position: number;
  onAdd: (label: string, time: number) => void;
  onRemove: (id: string) => void;
  onJump: (time: number) => void;
  onLoopBetween: (a: number, b: number) => void;
}

/**
 * Named markers the director drops in — "Letter B", "the tricky bit". Beats
 * automatic bar detection because it works on any recording, including the ones
 * with a fermata in the middle and someone coughing.
 */
export default function Bookmarks({
  bookmarks,
  position,
  onAdd,
  onRemove,
  onJump,
  onLoopBetween,
}: Props) {
  const [label, setLabel] = useState("");
  const sorted = [...bookmarks].sort((a, b) => a.time - b.time);

  const add = () => {
    onAdd(label.trim() || fmtTime(position), position);
    setLabel("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            e.stopPropagation();
          }}
          placeholder={`Name this spot (${fmtTime(position)})`}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none placeholder:text-[var(--fg-muted)] focus:border-[var(--border-strong)]"
        />
        <button
          onClick={add}
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-sm transition hover:bg-white/5"
        >
          Mark
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-[var(--fg-muted)]">
          Nothing marked yet. Mark two spots and you can loop between them in one click.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((b, i) => (
            <li key={b.id} className="flex items-center gap-2">
              <button
                onClick={() => onJump(b.time)}
                className="flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
              >
                <span className="font-mono text-xs tabular-nums text-[var(--fg-muted)]">
                  {fmtTime(b.time)}
                </span>
                <span className="truncate text-sm">{b.label}</span>
              </button>
              {i < sorted.length - 1 && (
                <button
                  onClick={() => onLoopBetween(b.time, sorted[i + 1].time)}
                  title={`Loop from here to "${sorted[i + 1].label}"`}
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--fg-muted)] transition hover:bg-white/5"
                >
                  Loop →
                </button>
              )}
              <button
                onClick={() => onRemove(b.id)}
                aria-label={`Remove ${b.label}`}
                className="rounded-md px-2 py-1 text-[var(--fg-muted)] transition hover:text-[var(--fg)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import type { MixerChannel } from "@/lib/player";

interface Props {
  channels: MixerChannel[];
  onVolume: (id: string, v: number) => void;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onPan: (id: string, v: number) => void;
}

const small =
  "rounded-md border px-2 py-1 text-[11px] uppercase tracking-wide transition hover:bg-white/5";

export default function Mixer({ channels, onVolume, onMute, onSolo, onPan }: Props) {
  return (
    <div className="flex flex-col divide-y divide-[var(--border)]">
      {channels.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-3 py-3">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: c.color }}
            aria-hidden
          />
          <span className="w-28 shrink-0 text-sm">{c.label}</span>

          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={c.volume}
            onChange={(e) => onVolume(c.id, Number(e.target.value))}
            disabled={c.muted}
            aria-label={`${c.label} volume`}
            className="min-w-[8rem] flex-1"
            style={{ ["--track-color" as string]: c.color }}
          />
          <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--fg-muted)]">
            {Math.round(c.volume * 100)}
          </span>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-[var(--fg-muted)]">
              <span className="sr-only sm:not-sr-only">Pan</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={c.pan}
                onChange={(e) => onPan(c.id, Number(e.target.value))}
                aria-label={`${c.label} pan`}
                className="w-20"
              />
            </label>
            <button
              onClick={() => onMute(c.id)}
              className={small}
              style={{
                borderColor: c.muted ? c.color : "var(--border)",
                color: c.muted ? c.color : "var(--fg-muted)",
              }}
            >
              Mute
            </button>
            <button
              onClick={() => onSolo(c.id)}
              className={small}
              style={{
                borderColor: c.soloed ? c.color : "var(--border)",
                color: c.soloed ? c.color : "var(--fg-muted)",
              }}
            >
              Solo
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

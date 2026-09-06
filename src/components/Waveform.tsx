"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Bookmark } from "@/lib/project";

interface Props {
  peaks: number[];
  duration: number;
  position: number;
  loop: [number, number] | null;
  bookmarks: Bookmark[];
  onSeek: (time: number) => void;
  onLoopChange: (loop: [number, number] | null) => void;
}

/** A drag shorter than this is a click, i.e. a seek rather than a loop. */
const DRAG_SLOP = 5;

export default function Waveform({
  peaks,
  duration,
  position,
  loop,
  bookmarks,
  onSeek,
  onLoopChange,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; t0: number; t1: number } | null>(null);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = wrap.current;
      if (!el || !duration) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration]
  );

  /* ---- drawing ---- */
  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;

    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth;
    const h = box.clientHeight;
    el.width = w * dpr;
    el.height = h * dpr;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const active = drag ? ([Math.min(drag.t0, drag.t1), Math.max(drag.t0, drag.t1)] as const) : loop;

    if (active && duration) {
      ctx.fillStyle = "rgba(199, 242, 91, 0.14)";
      const x = (active[0] / duration) * w;
      ctx.fillRect(x, 0, ((active[1] - active[0]) / duration) * w, h);
    }

    const mid = h / 2;
    if (peaks.length) {
      const step = w / peaks.length;
      const barW = Math.max(1, step * 0.8);
      const playedX = duration ? (position / duration) * w : 0;
      for (let i = 0; i < peaks.length; i++) {
        const x = i * step;
        const amp = Math.max(1, peaks[i] * (h / 2 - 2));
        ctx.fillStyle = x <= playedX ? "rgba(199, 242, 91, 0.85)" : "rgba(255, 255, 255, 0.28)";
        ctx.fillRect(x, mid - amp, barW, amp * 2);
      }
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, mid - 1, w, 2);
    }

    for (const b of bookmarks) {
      if (!duration) break;
      const x = (b.time / duration) * w;
      ctx.fillStyle = "rgba(111, 215, 242, 0.9)";
      ctx.fillRect(x - 1, 0, 2, h);
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x, 8);
      ctx.closePath();
      ctx.fill();
    }

    if (duration) {
      const x = (position / duration) * w;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 1, 0, 2, h);
    }
  }, [peaks, duration, position, loop, bookmarks, drag]);

  /* ---- redraw on resize ---- */
  useEffect(() => {
    const onResize = () => setDrag((d) => (d ? { ...d } : null));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // some pointers cannot be captured; dragging still works without it
    }
    const t = timeAt(e.clientX);
    setDrag({ x0: e.clientX, t0: t, t1: t });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, t1: timeAt(e.clientX) });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const moved = Math.abs(e.clientX - drag.x0);
    if (moved < DRAG_SLOP) {
      onSeek(drag.t0);
    } else {
      const a = Math.min(drag.t0, drag.t1);
      const b = Math.max(drag.t0, drag.t1);
      onLoopChange(b - a > 0.25 ? [a, b] : null);
      onSeek(a);
    }
    setDrag(null);
  };

  return (
    <div
      ref={wrap}
      className="relative h-28 w-full cursor-crosshair touch-none select-none rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] sm:h-36"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      <canvas ref={canvas} className="h-full w-full" />
      {!loop && !drag && (
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-[var(--fg-muted)]">
          click to jump · drag to loop a section
        </p>
      )}
    </div>
  );
}

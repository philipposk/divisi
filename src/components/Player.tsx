"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Bookmarks from "@/components/Bookmarks";
import Mixer from "@/components/Mixer";
import MixPresets, { type MixMode } from "@/components/MixPresets";
import SpeedControls from "@/components/SpeedControls";
import Transport from "@/components/Transport";
import Waveform from "@/components/Waveform";

import { computePeaks, decodeFile, downmix } from "@/lib/decode";
import { downloadAllMixes, encodeMp3, mixStems, saveBlob } from "@/lib/export";
import {
  PracticePlayer,
  type MixerChannel,
  type PlayerState,
  type StemInput,
} from "@/lib/player";
import {
  loadSession,
  openFile,
  saveSession,
  type Bookmark,
  type LoadedProject,
} from "@/lib/project";
import { ALL_VOICES, RANGES, guessVoices, splitVoices, type VoiceId } from "@/lib/satb";
import { renderLine } from "@/lib/synth";
import { transcribe } from "@/lib/transcribe";

interface Props {
  project: LoadedProject;
  onClose: () => void;
}

interface Loaded {
  original: Float32Array;
  parts: Partial<Record<VoiceId, Float32Array>>;
  accompaniment: Float32Array | null;
  guides: Partial<Record<VoiceId, Float32Array>>;
  sampleRate: number;
  duration: number;
}

type Stage =
  | { kind: "loading"; message: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const card = "glass rounded-2xl p-5 sm:p-6";
const heading = "mb-4 text-xs uppercase tracking-wide text-[var(--fg-muted)]";

export default function Player({ project, onClose }: Props) {
  const manifest = project.manifest;

  const ctxRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<PracticePlayer | null>(null);
  const audioRef = useRef<Loaded | null>(null);
  const sourceBufferRef = useRef<AudioBuffer | null>(null);

  const [stage, setStage] = useState<Stage>({ kind: "loading", message: "Opening the recording" });
  const [state, setState] = useState<PlayerState | null>(null);
  const [channels, setChannels] = useState<MixerChannel[]>([]);
  const [peaks, setPeaks] = useState<number[]>(manifest.peaks ?? []);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(manifest.bookmarks ?? []);
  const [myPart, setMyPart] = useState<VoiceId | null>(null);
  const [mixMode, setMixMode] = useState<MixMode>("predominant");
  const [finding, setFinding] = useState<{ active: boolean; message: string; percent: number }>({
    active: false,
    message: "",
    percent: 0,
  });
  const [findingNote, setFindingNote] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /* build the audio graph                                             */
  /* ---------------------------------------------------------------- */

  const buildPlayer = useCallback(async () => {
    const loaded = audioRef.current;
    const ctx = ctxRef.current;
    if (!loaded || !ctx) return;

    const previous = playerRef.current?.state;
    playerRef.current?.destroy();

    const stems: StemInput[] = [
      {
        id: "original",
        label: "Whole choir",
        color: "rgba(255,255,255,0.75)",
        data: loaded.original,
        gain: 1,
      },
    ];

    for (const v of ALL_VOICES) {
      const data = loaded.parts[v];
      if (!data) continue;
      stems.push({
        id: v,
        label: RANGES[v].label,
        color: `var(${RANGES[v].colorVar})`,
        data,
        gain: 0,
      });
    }

    for (const v of ALL_VOICES) {
      const data = loaded.guides[v];
      if (!data) continue;
      stems.push({
        id: `guide-${v}`,
        label: `${RANGES[v].label} — guide tone`,
        color: `var(${RANGES[v].colorVar})`,
        data,
        gain: 0,
      });
    }

    if (loaded.accompaniment) {
      stems.push({
        id: "accompaniment",
        label: "Accompaniment",
        color: "rgba(160,160,175,0.9)",
        data: loaded.accompaniment,
        gain: 0,
      });
    }

    const player = await PracticePlayer.create(ctx, stems);
    playerRef.current = player;
    player.subscribe((s) => {
      setState(s);
      setChannels(player.mixer);
    });

    if (previous) {
      player.setRate(previous.rate);
      player.setSemitones(previous.semitones);
      if (previous.loop) player.setLoop(previous.loop[0], previous.loop[1]);
      player.seek(previous.position);
    } else {
      const saved = loadSession(manifest.slug);
      if (saved.rate) player.setRate(saved.rate);
      if (saved.semitones) player.setSemitones(saved.semitones);
      if (saved.loop) player.setLoop(saved.loop[0], saved.loop[1]);
      // reopening a piece you played to the end should not leave you parked on
      // the last frame with a play button that appears to do nothing
      if (saved.position && saved.position < player.state.duration - 2) {
        player.seek(saved.position);
      }
      if (saved.bookmarks?.length) setBookmarks(saved.bookmarks);
      if (saved.myPart) setMyPart(saved.myPart);
    }
    setChannels(player.mixer);
  }, [manifest.slug]);

  /* ---------------------------------------------------------------- */
  /* decode everything once                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const ctx = new AudioContext();
        ctxRef.current = ctx;

        const originalFile = await openFile(project, manifest.original);
        if (!originalFile) throw new Error(`Missing ${manifest.original} in that folder.`);

        setStage({ kind: "loading", message: "Opening the recording" });
        const originalBuffer = await decodeFile(ctx, originalFile);
        if (cancelled) return;
        sourceBufferRef.current = originalBuffer;
        const original = downmix(originalBuffer);

        const parts: Partial<Record<VoiceId, Float32Array>> = {};
        for (const p of manifest.parts) {
          const file = await openFile(project, p.stem);
          if (!file) continue;
          setStage({ kind: "loading", message: `Opening the ${p.label.toLowerCase()} track` });
          const buf = await decodeFile(ctx, file);
          if (cancelled) return;
          parts[p.id] = downmix(buf);
        }

        let accompaniment: Float32Array | null = null;
        const accompFile = await openFile(project, manifest.accompaniment);
        if (accompFile) {
          setStage({ kind: "loading", message: "Opening the accompaniment" });
          const buf = await decodeFile(ctx, accompFile);
          if (cancelled) return;
          accompaniment = downmix(buf);
        }

        audioRef.current = {
          original,
          parts,
          accompaniment,
          guides: {},
          sampleRate: ctx.sampleRate,
          duration: originalBuffer.duration,
        };

        if (!manifest.peaks?.length) setPeaks(computePeaks(original));

        setStage({ kind: "loading", message: "Setting up the mixer" });
        await buildPlayer();
        if (cancelled) return;
        setStage({ kind: "ready" });
      } catch (e) {
        if (!cancelled) {
          setStage({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
    // rebuilding on every buildPlayer identity change would re-decode the audio
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  /* ---------------------------------------------------------------- */
  /* mix presets                                                       */
  /* ---------------------------------------------------------------- */

  const availableParts = useMemo(() => {
    const loaded = audioRef.current;
    const ids = new Set<VoiceId>();
    for (const p of manifest.parts) ids.add(p.id);
    if (loaded) for (const v of ALL_VOICES) if (loaded.guides[v]) ids.add(v);
    return ALL_VOICES.filter((v) => ids.has(v));
  }, [manifest.parts, channels]);

  const applyMix = useCallback((part: VoiceId | null, mode: MixMode) => {
    const player = playerRef.current;
    const loaded = audioRef.current;
    if (!player || !loaded) return;

    player.setSolo(null);
    const hasStem = (v: VoiceId) => !!loaded.parts[v];
    const mineIds = part ? [hasStem(part) ? part : null, `guide-${part}`].filter(Boolean) : [];

    for (const ch of player.mixer) {
      const mine = mineIds.includes(ch.id);
      const isOriginal = ch.id === "original";
      const isAccomp = ch.id === "accompaniment";
      let volume = 0;
      let pan = 0;

      if (!part || mode === "balanced") {
        volume = isOriginal ? 1 : 0;
      } else if (mode === "predominant") {
        // the recording keeps playing underneath, which is what buries any
        // separation artefacts in your own line
        volume = isOriginal ? 0.5 : mine ? (ch.id.startsWith("guide-") ? 0.5 : 1.4) : 0;
        if (isAccomp) volume = 0.5;
      } else if (mode === "solo") {
        volume = mine ? (ch.id.startsWith("guide-") ? 0.9 : 1.2) : 0;
      } else if (mode === "split") {
        volume = isOriginal ? 1 : mine ? 1.3 : 0;
        pan = isOriginal ? 0.9 : mine ? -0.9 : 0;
      }

      // with a real separated stem the guide tone is a distraction, so it only
      // comes up when there is nothing better
      if (ch.id.startsWith("guide-") && part && hasStem(part) && mode !== "solo") volume = 0;

      player.setVolume(ch.id, volume);
      player.setPan(ch.id, pan);
    }
    setChannels(player.mixer);
  }, []);

  useEffect(() => {
    if (stage.kind === "ready") applyMix(myPart, mixMode);
  }, [myPart, mixMode, stage.kind, applyMix]);

  /* ---------------------------------------------------------------- */
  /* persistence                                                       */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!state) return;
    const id = setTimeout(
      () =>
        saveSession(manifest.slug, {
          position: state.position,
          rate: state.rate,
          semitones: state.semitones,
          loop: state.loop,
          myPart,
          bookmarks,
        }),
      600
    );
    return () => clearTimeout(id);
  }, [state, myPart, bookmarks, manifest.slug]);

  /* ---------------------------------------------------------------- */
  /* keyboard                                                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const player = playerRef.current;
      if (!player) return;
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          void player.toggle();
          break;
        case "ArrowLeft":
          player.nudge(e.shiftKey ? -1 : -5);
          break;
        case "ArrowRight":
          player.nudge(e.shiftKey ? 1 : 5);
          break;
        case "[":
          setLoopEdge(0);
          break;
        case "]":
          setLoopEdge(1);
          break;
        case "l":
        case "L":
          player.clearLoop();
          break;
        case "1":
        case "2":
        case "3":
        case "4": {
          const v = ALL_VOICES[Number(e.key) - 1];
          if (availableParts.includes(v)) setMyPart((cur) => (cur === v ? null : v));
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableParts]);

  /* ---------------------------------------------------------------- */
  /* actions                                                           */
  /* ---------------------------------------------------------------- */

  const setLoopEdge = (edge: 0 | 1) => {
    const player = playerRef.current;
    if (!player) return;
    const s = player.state;
    const cur = s.loop ?? [0, s.duration];
    const next: [number, number] = edge === 0 ? [s.position, cur[1]] : [cur[0], s.position];
    if (next[1] - next[0] < 0.25) {
      // setting B before A is almost always a mis-tap, so extend rather than
      // silently doing nothing
      player.setLoop(Math.min(next[0], next[1]), Math.min(next[0], next[1]) + 2);
    } else {
      player.setLoop(next[0], next[1]);
    }
  };

  const findParts = async () => {
    const loaded = audioRef.current;
    const buffer = sourceBufferRef.current;
    const player = playerRef.current;
    if (!loaded || !buffer || !player) return;

    playerRef.current?.pause();
    setFinding({ active: true, message: "Listening for the notes", percent: 0 });
    setFindingNote(null);

    try {
      const notes = await transcribe(buffer, {
        onProgress: (p) =>
          setFinding({ active: true, message: "Listening for the notes", percent: p * 0.7 }),
      });

      setFinding({ active: true, message: "Working out who sang what", percent: 0.75 });
      await new Promise((r) => setTimeout(r, 0));

      const voices = manifest.parts.length
        ? manifest.parts.map((p) => p.id)
        : guessVoices(notes);
      const result = splitVoices(notes, { voices });

      setFinding({ active: true, message: "Making the guide tones", percent: 0.9 });
      await new Promise((r) => setTimeout(r, 0));

      const guides: Partial<Record<VoiceId, Float32Array>> = {};
      for (const line of result.lines) {
        if (!line.notes.length) continue;
        guides[line.id] = renderLine(line.notes, loaded.duration, loaded.sampleRate);
      }
      loaded.guides = guides;

      await buildPlayer();
      setMyPart((cur) => cur ?? result.lines.find((l) => l.notes.length)?.id ?? null);

      const found = result.lines.filter((l) => l.notes.length).map((l) => l.label);
      setFindingNote(
        `Found ${found.length} line${found.length === 1 ? "" : "s"} (${found.join(", ")}). ` +
          `Roughly ${Math.round(result.certainty * 100)}% of the notes went somewhere confident — ` +
          `treat it as a sketch, not a score.`
      );
    } catch (e) {
      // the message alone is rarely enough to debug a tfjs failure
      console.error("[divisi] part finding failed", e);
      setFindingNote(`Could not work out the parts: ${e instanceof Error ? e.message : e}`);
    } finally {
      setFinding({ active: false, message: "", percent: 0 });
    }
  };

  const downloadCurrentMix = () => {
    const loaded = audioRef.current;
    const player = playerRef.current;
    if (!loaded || !player) return;

    const byId = new Map<string, Float32Array>([["original", loaded.original]]);
    for (const v of ALL_VOICES) {
      if (loaded.parts[v]) byId.set(v, loaded.parts[v]!);
      if (loaded.guides[v]) byId.set(`guide-${v}`, loaded.guides[v]!);
    }
    if (loaded.accompaniment) byId.set("accompaniment", loaded.accompaniment);

    const sources = player.mixer
      .filter((c) => !c.muted && c.volume > 0 && byId.has(c.id))
      .map((c) => ({ data: byId.get(c.id)!, gain: c.volume }));
    if (!sources.length) return;

    const blob = encodeMp3(mixStems(sources), loaded.sampleRate);
    const suffix = myPart ? `-${RANGES[myPart].label.toLowerCase()}` : "";
    saveBlob(blob, `${manifest.slug}${suffix}.mp3`);
  };

  /* ---------------------------------------------------------------- */
  /* render                                                            */
  /* ---------------------------------------------------------------- */

  if (stage.kind === "error") {
    return (
      <div className={`${card} mx-auto max-w-lg text-center`}>
        <p className="text-[var(--fg)]">{stage.message}</p>
        <button
          onClick={onClose}
          className="mt-4 rounded-xl border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-white/5"
        >
          Try another file
        </button>
      </div>
    );
  }

  if (stage.kind === "loading" || !state) {
    return (
      <div className={`${card} mx-auto max-w-lg text-center`}>
        <p className="pulsing">{stage.kind === "loading" ? stage.message : "Loading"}…</p>
      </div>
    );
  }

  const hasSeparatedParts = manifest.parts.length > 0;
  const hasGuides = ALL_VOICES.some((v) => audioRef.current?.guides[v]);
  const hasReadyMixes = manifest.mixes.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">{manifest.title}</h1>
          <p className="text-sm text-[var(--fg-muted)]">
            {hasSeparatedParts
              ? `${manifest.parts.length} separated parts`
              : "No separated parts — transport, slow-down and looping still work"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-white/5"
        >
          Open something else
        </button>
      </header>

      <Waveform
        peaks={peaks}
        duration={state.duration}
        position={state.position}
        loop={state.loop}
        bookmarks={bookmarks}
        onSeek={(t) => playerRef.current?.seek(t)}
        onLoopChange={(l) =>
          l ? playerRef.current?.setLoop(l[0], l[1]) : playerRef.current?.clearLoop()
        }
      />

      <div className={card}>
        <Transport
          playing={state.playing}
          position={state.position}
          duration={state.duration}
          loop={state.loop}
          onToggle={() => void playerRef.current?.toggle()}
          onNudge={(s) => playerRef.current?.nudge(s)}
          onSetLoopEdge={setLoopEdge}
          onNudgeLoopEdge={(edge, delta) => {
            const player = playerRef.current;
            if (!player) return;
            const cur = player.state.loop ?? [0, player.state.duration];
            const next: [number, number] = [...cur];
            next[edge] += delta;
            player.setLoop(next[0], next[1]);
          }}
          onClearLoop={() => playerRef.current?.clearLoop()}
          onLoopLastBar={() => {
            const player = playerRef.current;
            if (!player) return;
            const end = player.state.position;
            player.setLoop(Math.max(0, end - 4), end);
            player.seek(Math.max(0, end - 4));
          }}
        />
      </div>

      <div className={card}>
        <SpeedControls
          rate={state.rate}
          semitones={state.semitones}
          onRate={(r) => playerRef.current?.setRate(r)}
          onSemitones={(n) => playerRef.current?.setSemitones(n)}
        />
      </div>

      <div className={card}>
        <MixPresets
          available={availableParts}
          myPart={myPart}
          mode={mixMode}
          onPart={setMyPart}
          onMode={setMixMode}
        />

        {!hasSeparatedParts && (
          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <p className="text-sm">
              This recording has not been split yet.{" "}
              {hasGuides ? "Guide tones are loaded." : "I can have a go at picking out the lines."}
            </p>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              In the browser this listens for the notes and plays each part back as a plain tone —
              useful for checking an entry, and wrong often enough that you should not trust it over
              the score. For proper separated voices, run the recording through the kitchen script on
              a Mac.
            </p>
            <button
              onClick={findParts}
              disabled={finding.active}
              className="mt-3 rounded-xl border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-white/5 disabled:opacity-50"
            >
              {finding.active ? `${finding.message}…` : hasGuides ? "Try again" : "Find the parts"}
            </button>
            {finding.active && (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-[var(--accent)] transition-all"
                  style={{ width: `${Math.round(finding.percent * 100)}%` }}
                />
              </div>
            )}
            {findingNote && <p className="mt-3 text-xs text-[var(--fg-muted)]">{findingNote}</p>}
          </div>
        )}
      </div>

      <div className={card}>
        <p className={heading}>Mixer</p>
        <Mixer
          channels={channels}
          onVolume={(id, v) => {
            playerRef.current?.setVolume(id, v);
            setChannels(playerRef.current!.mixer);
          }}
          onMute={(id) => {
            playerRef.current?.toggleMute(id);
            setChannels(playerRef.current!.mixer);
          }}
          onSolo={(id) => {
            playerRef.current?.setSolo(id);
            setChannels(playerRef.current!.mixer);
          }}
          onPan={(id, v) => {
            playerRef.current?.setPan(id, v);
            setChannels(playerRef.current!.mixer);
          }}
        />
      </div>

      <div className={card}>
        <p className={heading}>Marks</p>
        <Bookmarks
          bookmarks={bookmarks}
          position={state.position}
          onAdd={(label, time) =>
            setBookmarks((b) => [...b, { id: `${time}-${label}`, label, time }])
          }
          onRemove={(id) => setBookmarks((b) => b.filter((x) => x.id !== id))}
          onJump={(t) => playerRef.current?.seek(t)}
          onLoopBetween={(a, b) => {
            playerRef.current?.setLoop(a, b);
            playerRef.current?.seek(a);
          }}
        />
      </div>

      <div className={`${card} flex flex-wrap items-center gap-3`}>
        <p className={`${heading} mb-0`}>Take it away</p>
        <button
          onClick={downloadCurrentMix}
          className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-white/5"
        >
          Download this mix as MP3
        </button>
        {hasReadyMixes && (
          <button
            onClick={() => void downloadAllMixes(project)}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-white/5"
          >
            Download all {manifest.mixes.length} ready-made tracks
          </button>
        )}
      </div>

      <p className="text-center text-xs text-[var(--fg-muted)]">
        space play · ← → skip 5s (shift for 1s) · [ ] set loop · L clear loop · 1-4 pick your part
      </p>
    </div>
  );
}

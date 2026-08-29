"use client";

import { useEffect, useState } from "react";

import Dropzone from "@/components/Dropzone";
import Player from "@/components/Player";
import { readProject, readProjectFromUrl, type LoadedProject } from "@/lib/project";

export default function Home() {
  const [project, setProject] = useState<LoadedProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ?project=<url to a published folder> opens straight into the player, so a
  // director can put one link in an email and be done
  useEffect(() => {
    const url = new URLSearchParams(location.search).get("project");
    if (!url) return;
    setBusy(true);
    readProjectFromUrl(url)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, []);

  const open = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      setProject(await readProject(files));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setProject(null);
    if (location.search) history.replaceState(null, "", location.pathname);
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
      {project ? (
        <Player project={project} onClose={close} />
      ) : (
        <div className="flex flex-col gap-8">
          <header className="text-center">
            <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">Divisi</h1>
            <p className="mt-3 text-lg text-[var(--fg-muted)]">
              Practice tracks for choirs. Hear your own line, slow it down, loop the hard bar.
            </p>
          </header>

          <Dropzone onFiles={open} busy={busy} />

          {busy && <p className="pulsing text-center text-sm">Opening…</p>}
          {error && (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-center text-sm">
              {error}
            </p>
          )}

          <section className="grid gap-4 sm:grid-cols-3">
            <Feature title="Slow it down">
              Down to 40% speed with the pitch held exactly where it was. Nobody goes flat.
            </Feature>
            <Feature title="Loop the hard bar">
              Drag across the waveform to loop a section, then nudge the edges a tenth of a second at
              a time.
            </Feature>
            <Feature title="Your part on top">
              The recording keeps playing underneath while your section is lifted over it — the way
              choirs have rehearsed for decades.
            </Feature>
          </section>

          <section className="glass rounded-2xl p-5 text-sm leading-relaxed sm:p-6">
            <h2 className="mb-2 font-medium">What this can and cannot do</h2>
            <p className="text-[var(--fg-muted)]">
              Pulling four clean voices out of one choir recording is not a solved problem, and
              anyone who tells you otherwise is selling something. What works well is putting{" "}
              <em>your</em> line clearly on top of the real recording — you will still hear the
              section next to you underneath, and that turns out to be fine, because that is how
              rehearsal recordings have always sounded.
            </p>
            <p className="mt-3 text-[var(--fg-muted)]">
              Alto comes out least cleanly — it sits inside the soprano and tenor ranges at both
              ends. Bass comes out best. Drop a plain recording in and everything except the
              separation works straight away.
            </p>
            <p className="mt-3 text-[var(--fg-muted)]">
              Nothing is uploaded. Every file stays on this computer.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] p-4">
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <p className="text-sm text-[var(--fg-muted)]">{children}</p>
    </div>
  );
}

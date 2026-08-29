"use client";

import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  busy?: boolean;
}

/**
 * Two ways in: a project folder from the kitchen, or plain audio files. Folder
 * drops need the directory-entry API because a dropped folder arrives as one
 * entry rather than a list of files.
 */
export default function Dropzone({ onFiles, busy }: Props) {
  const [over, setOver] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const walk = async (entry: FileSystemEntry, out: File[]): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej)
      );
      // preserve the path so the manifest's relative references still resolve
      Object.defineProperty(file, "webkitRelativePath", {
        value: entry.fullPath.replace(/^\//, ""),
      });
      out.push(file);
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej)
      );
      if (!batch.length) break;
      for (const e of batch) await walk(e, out);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const items = [...e.dataTransfer.items];
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (entries.length) {
      const out: File[] = [];
      for (const entry of entries) await walk(entry, out);
      if (out.length) return onFiles(out);
    }
    onFiles([...e.dataTransfer.files]);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`glass glow-ring rounded-2xl p-8 text-center transition sm:p-12 ${
        over ? "border-[var(--accent)] bg-[var(--accent-soft)]" : ""
      }`}
    >
      <p className="text-lg">Drop a recording or a project folder here</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--fg-muted)]">
        Nothing is uploaded. The audio is opened straight off this computer and stays here.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-black transition active:scale-95 disabled:opacity-50"
        >
          Choose audio files
        </button>
        <button
          disabled={busy}
          onClick={() => folderInput.current?.click()}
          className="rounded-xl border border-[var(--border)] px-5 py-2.5 text-sm transition hover:bg-white/5 active:scale-95 disabled:opacity-50"
        >
          Choose a project folder
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => e.target.files && onFiles([...e.target.files])}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        multiple
        // @ts-expect-error non-standard, but it is the only way to pick a folder
        webkitdirectory=""
        directory=""
        onChange={(e) => e.target.files && onFiles([...e.target.files])}
      />
    </div>
  );
}

/**
 * Reading what the kitchen produced.
 *
 * A project is just a folder: a manifest, the stems, and the ready-to-email
 * mixes. Nothing is uploaded anywhere — the browser opens the folder off the
 * disk and keeps the audio in memory. That is also why Google Drive is not an
 * input here: Drive refuses cross-origin reads outright, so the workflow is
 * download the folder, then open it.
 */

import type { VoiceId } from "./voices";

export interface ProjectPart {
  id: VoiceId;
  label: string;
  /** path relative to the project folder */
  stem: string;
}

export interface ProjectMix {
  part: VoiceId | null;
  kind: "predominant" | "split-ears" | "part-only" | "accompaniment";
  file: string;
}

export interface Bookmark {
  id: string;
  label: string;
  /** seconds */
  time: number;
}

export interface ProjectManifest {
  version: number;
  title: string;
  slug: string;
  source?: string;
  duration: number;
  createdAt?: string;
  original: string;
  accompaniment: string | null;
  parts: ProjectPart[];
  mixes: ProjectMix[];
  peaks: number[];
  bookmarks: Bookmark[];
}

export interface LoadedProject {
  manifest: ProjectManifest;
  /** relative path -> the actual file on disk; empty for projects loaded by URL */
  files: Map<string, File>;
  /** where to fetch relative paths from, when the project came off the web */
  baseUrl: string | null;
  /** true when we invented the manifest from loose audio files */
  improvised: boolean;
}

const AUDIO_RE = /\.(wav|mp3|m4a|aac|ogg|opus|flac|aiff?|webm)$/i;

export const isAudioFile = (f: File) => AUDIO_RE.test(f.name);

/** Strip the top-level folder the picker prepends, so paths match the manifest. */
function relativePath(file: File, stripRoot: string | null): string {
  const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  if (stripRoot && raw.startsWith(stripRoot + "/")) return raw.slice(stripRoot.length + 1);
  return raw;
}

function commonRoot(files: File[]): string | null {
  const paths = files
    .map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath)
    .filter((p): p is string => !!p && p.includes("/"));
  if (!paths.length) return null;
  const first = paths[0].split("/")[0];
  return paths.every((p) => p.split("/")[0] === first) ? first : null;
}

const titleFromName = (name: string) =>
  name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Untitled";

const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .toLowerCase() || "untitled";

/**
 * Turn whatever was dropped into a project.
 *
 * A kitchen folder loads exactly as it was built. Loose audio files still work:
 * they become a manifest with no parts, so the transport, slow-down and looping
 * all function immediately.
 */
export async function readProject(input: File[]): Promise<LoadedProject> {
  const root = commonRoot(input);
  const files = new Map<string, File>();
  for (const f of input) files.set(relativePath(f, root), f);

  const manifestFile = [...files.entries()].find(([p]) => p.endsWith("project.json"));
  if (manifestFile) {
    const text = await manifestFile[1].text();
    const manifest = JSON.parse(text) as ProjectManifest;
    // a manifest written by an older kitchen may be missing newer fields
    manifest.bookmarks ??= [];
    manifest.peaks ??= [];
    manifest.mixes ??= [];
    manifest.parts ??= [];
    return { manifest, files, baseUrl: null, improvised: false };
  }

  const audio = input.filter(isAudioFile);
  if (!audio.length) throw new Error("No audio in there. Drop a project folder or some audio files.");

  // Longest file wins as "the recording" — in a folder of takes and fragments
  // that is nearly always the full piece.
  const main = audio.reduce((a, b) => (b.size > a.size ? b : a));
  const title = titleFromName(main.name);

  return {
    improvised: true,
    files,
    baseUrl: null,
    manifest: {
      version: 1,
      title,
      slug: slugify(title),
      duration: 0,
      original: relativePath(main, root),
      accompaniment: null,
      parts: [],
      mixes: [],
      peaks: [],
      bookmarks: [],
    },
  };
}

export function fileFor(project: LoadedProject, path: string | null): File | undefined {
  if (!path) return undefined;
  const direct = project.files.get(path);
  if (direct) return direct;
  // fall back to matching on filename, for folders that got reorganised
  const name = path.split("/").pop()!;
  for (const [p, f] of project.files) if (p.endsWith("/" + name) || p === name) return f;
  return undefined;
}

/** Resolve a path in the manifest to actual bytes, from disk or over the web. */
export async function openFile(
  project: LoadedProject,
  path: string | null
): Promise<Blob | undefined> {
  if (!path) return undefined;
  const local = fileFor(project, path);
  if (local) return local;
  if (!project.baseUrl) return undefined;
  const res = await fetch(new URL(path, project.baseUrl).toString());
  if (!res.ok) return undefined;
  return res.blob();
}

export function urlFor(project: LoadedProject, path: string): string | null {
  return project.baseUrl ? new URL(path, project.baseUrl).toString() : null;
}

/**
 * Load a project the director published somewhere — an object store, a static
 * host, anything that serves the folder with permissive CORS. Google Drive is
 * not one of those: it refuses cross-origin reads outright, so a Drive link has
 * to be downloaded first and then opened as a folder.
 */
export async function readProjectFromUrl(manifestUrl: string): Promise<LoadedProject> {
  const url = new URL(manifestUrl, typeof location === "undefined" ? undefined : location.href);
  if (!/project\.json$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/?$/, "/") + "project.json";
  }

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    throw new Error(
      `Could not reach ${url.host}. If that is a Google Drive link it will not work — Drive blocks other sites from reading files. Download the folder and open it instead.`
    );
  }
  if (!res.ok) throw new Error(`${url.toString()} returned ${res.status}.`);

  const manifest = (await res.json()) as ProjectManifest;
  manifest.bookmarks ??= [];
  manifest.peaks ??= [];
  manifest.mixes ??= [];
  manifest.parts ??= [];

  return {
    manifest,
    files: new Map(),
    baseUrl: url.toString().replace(/project\.json$/, ""),
    improvised: false,
  };
}

/* ------------------------------------------------------------------ */
/* remembering where you were                                          */
/* ------------------------------------------------------------------ */

export interface SessionState {
  position: number;
  rate: number;
  semitones: number;
  loop: [number, number] | null;
  myPart: VoiceId | null;
  bookmarks: Bookmark[];
}

const KEY = (slug: string) => `divisi:session:${slug}`;

export function loadSession(slug: string): Partial<SessionState> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY(slug)) || "{}");
  } catch {
    return {};
  }
}

export function saveSession(slug: string, state: Partial<SessionState>) {
  if (typeof localStorage === "undefined") return;
  try {
    const merged = { ...loadSession(slug), ...state };
    localStorage.setItem(KEY(slug), JSON.stringify(merged));
  } catch {
    /* private browsing, or the quota is full — not worth interrupting anyone */
  }
}

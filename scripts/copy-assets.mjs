#!/usr/bin/env node
// Copies the Basic Pitch model (audio -> notes) and the tfjs WASM binaries into
// /public so everything is served from our own origin. No CDN, no cross-origin
// fetches, and the app keeps working offline once it has been loaded.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pub = join(root, "public");
const nm = join(root, "node_modules");

// signalsmith-stretch builds its AudioWorklet by stringifying a function and
// handing the text to addModule(). A bundler that rewrites that function's
// source — Turbopack and webpack both do — leaves module-loader identifiers in
// the string that do not exist inside the worklet scope, and the worklet dies on
// load. Serving the untouched file and importing it at runtime sidesteps that.
const files = [
  {
    from: join(nm, "signalsmith-stretch/SignalsmithStretch.mjs"),
    to: join(pub, "vendor/signalsmith-stretch.mjs"),
  },
];

const dirs = [
  { from: join(nm, "@spotify/basic-pitch/model"), to: join(pub, "models/basic-pitch") },
  {
    from: join(nm, "@tensorflow/tfjs-backend-wasm/dist"),
    to: join(pub, "tfjs-wasm"),
    only: (f) => f.endsWith(".wasm"),
  },
];

for (const job of dirs) {
  if (!existsSync(job.from)) {
    console.warn(`[assets] missing ${job.from} — run install first`);
    continue;
  }
  await rm(job.to, { recursive: true, force: true });
  await mkdir(job.to, { recursive: true });
  if (job.only) {
    for (const f of await readdir(job.from)) {
      if (job.only(f)) await cp(join(job.from, f), join(job.to, f));
    }
  } else {
    await cp(job.from, job.to, { recursive: true });
  }
  console.log(`[assets] ${job.from.replace(root + "/", "")} -> ${job.to.replace(root + "/", "")}`);
}

for (const job of files) {
  if (!existsSync(job.from)) {
    console.warn(`[assets] missing ${job.from} — run install first`);
    continue;
  }
  await mkdir(dirname(job.to), { recursive: true });
  await cp(job.from, job.to);
  console.log(`[assets] ${job.from.replace(root + "/", "")} -> ${job.to.replace(root + "/", "")}`);
}

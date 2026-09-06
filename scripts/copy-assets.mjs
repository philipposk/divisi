#!/usr/bin/env node
// Copies the untouched Signalsmith Stretch module into /public so it is served
// from our own origin and reaches the AudioWorklet exactly as published.
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

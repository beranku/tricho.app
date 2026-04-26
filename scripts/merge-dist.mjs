#!/usr/bin/env node
// Merge per-package builds into a single deployable dist/ at the repo root.
//
// Inputs (must already be built):
//   web/dist/   — marketing site (Astro static output)
//   app/dist/   — PWA shell (Astro + vite-pwa output, base: '/app/')
//   shared/    — manifest, thin SW, icons, OG images
//   _headers   — Cloudflare Pages per-path headers
//   _redirects — Cloudflare Pages SPA fallback + trailing-slash rewrite
//
// Output:
//   dist/                       (cleared then populated)
//   dist/                       <- web/dist/**          (marketing surface)
//   dist/app/                   <- app/dist/**          (PWA shell at /app/)
//   dist/manifest.webmanifest   <- shared/manifest.webmanifest
//   dist/sw.js                  <- shared/sw.js
//   dist/icons/                 <- shared/icons/**
//   dist/og/                    <- shared/og/**
//   dist/_headers               <- _headers
//   dist/_redirects             <- _redirects
//
// Failure modes:
//   - missing input directory                  -> exit 1, name the missing dir
//   - path collision between web and app trees -> exit 1, name the colliding path
//
// No external deps; Node 22+ built-ins only.

import { rm, mkdir, cp, copyFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB_DIST = join(ROOT, 'web', 'dist');
const APP_DIST = join(ROOT, 'app', 'dist');
const SHARED = join(ROOT, 'shared');
const HEADERS = join(ROOT, '_headers');
const REDIRECTS = join(ROOT, '_redirects');
const OUT = join(ROOT, 'dist');

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function walk(dir, base = dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, base, acc);
    else acc.push(relative(base, full));
  }
  return acc;
}

function fail(msg) {
  process.stderr.write(`merge-dist: ${msg}\n`);
  process.exit(1);
}

async function require(path, label) {
  if (!(await exists(path))) fail(`required input missing: ${label} (${path})`);
}

async function main() {
  await require(WEB_DIST, 'web/dist');
  await require(APP_DIST, 'app/dist');
  await require(join(SHARED, 'manifest.webmanifest'), 'shared/manifest.webmanifest');
  await require(join(SHARED, 'sw.js'), 'shared/sw.js');
  await require(join(SHARED, 'icons'), 'shared/icons');
  await require(HEADERS, '_headers');
  await require(REDIRECTS, '_redirects');

  // Collision detection: any web file whose relative path starts with `app/`
  // would be overwritten when we copy app/dist -> dist/app. Equivalent test:
  // does web/dist/app/ exist? If so, name the colliding paths and abort.
  const webFiles = await walk(WEB_DIST);
  const collisions = webFiles.filter((p) => p === 'app' || p.startsWith('app/') || p.startsWith('app\\'));
  if (collisions.length > 0) {
    fail(`collision: web/dist contains paths under /app/* which would be overwritten by app/dist:\n  ${collisions.join('\n  ')}`);
  }
  // Manifest, sw.js, icons/, og/ from shared override anything web emitted at
  // those paths. Marketing index.html MUST always come from web — assert by
  // confirming web emitted index.html (we copy web first; nothing overwrites).
  if (!webFiles.includes('index.html')) fail('web/dist/index.html missing — landing page did not build');

  // 1. Reset output
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 2. web/dist -> dist/
  await cp(WEB_DIST, OUT, { recursive: true });

  // 3. app/dist -> dist/app/
  await cp(APP_DIST, join(OUT, 'app'), { recursive: true });

  // 4. shared/manifest.webmanifest -> dist/manifest.webmanifest
  await copyFile(join(SHARED, 'manifest.webmanifest'), join(OUT, 'manifest.webmanifest'));

  // 5. shared/sw.js -> dist/sw.js
  await copyFile(join(SHARED, 'sw.js'), join(OUT, 'sw.js'));

  // 6. shared/icons -> dist/icons
  await cp(join(SHARED, 'icons'), join(OUT, 'icons'), { recursive: true });

  // 6b. shared/og -> dist/og (default OG image; per-post images already in web/dist)
  if (await exists(join(SHARED, 'og'))) {
    await cp(join(SHARED, 'og'), join(OUT, 'og'), { recursive: true, force: false, errorOnExist: false });
  }

  // 7. _headers + _redirects
  await copyFile(HEADERS, join(OUT, '_headers'));
  await copyFile(REDIRECTS, join(OUT, '_redirects'));

  // Summary
  const files = await walk(OUT);
  let totalBytes = 0;
  for (const rel of files) totalBytes += (await stat(join(OUT, rel))).size;
  process.stdout.write(`merge-dist: ${files.length} files, ${(totalBytes / 1024).toFixed(1)} KiB total\n`);
}

main().catch((err) => fail(err?.stack || String(err)));

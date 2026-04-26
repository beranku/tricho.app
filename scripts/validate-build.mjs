#!/usr/bin/env node
// Validate the merged dist/ before deploy.
//
// Asserts (fail-loud, exit 1 with the failed assertion named):
//   1. dist/index.html exists
//   2. dist/index.html contains <link rel="manifest" href="/manifest.webmanifest">
//   3. dist/index.html contains a script that registers /sw.js
//   4. dist/app/index.html exists
//   5. dist/sw.js exists and matches shared/sw.js byte length
//   6. dist/app/sw.js exists
//   7. dist/manifest.webmanifest parses; start_url and scope are /app/
//   8. dist/_headers + dist/_redirects exist
//   9. dist/sitemap.xml exists
//
// No external deps; Node 22+ built-ins only.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist');
const SHARED = join(ROOT, 'shared');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}
async function size(path) { return (await stat(path)).size; }
async function read(path) { return readFile(path, 'utf8'); }

async function main() {
  // 1
  const indexExists = await exists(join(OUT, 'index.html'));
  check('dist/index.html exists', indexExists);

  if (indexExists) {
    const html = await read(join(OUT, 'index.html'));
    // 2
    check(
      'dist/index.html links /manifest.webmanifest',
      /<link\s+[^>]*rel=["']manifest["'][^>]*href=["']\/manifest\.webmanifest["']/.test(html) ||
        /<link\s+[^>]*href=["']\/manifest\.webmanifest["'][^>]*rel=["']manifest["']/.test(html),
    );
    // 3
    check(
      'dist/index.html registers /sw.js (root scope)',
      /serviceWorker[\s\S]*register\(\s*["']\/sw\.js["']/.test(html),
    );
  }

  // 4
  check('dist/app/index.html exists', await exists(join(OUT, 'app', 'index.html')));

  // 5
  const swExists = await exists(join(OUT, 'sw.js'));
  check('dist/sw.js exists', swExists);
  if (swExists) {
    const distSwSize = await size(join(OUT, 'sw.js'));
    const sharedSwSize = await size(join(SHARED, 'sw.js'));
    check('dist/sw.js matches shared/sw.js byte length', distSwSize === sharedSwSize, `dist=${distSwSize} shared=${sharedSwSize}`);
  }

  // 6
  check('dist/app/sw.js exists', await exists(join(OUT, 'app', 'sw.js')));

  // 7
  const manifestExists = await exists(join(OUT, 'manifest.webmanifest'));
  check('dist/manifest.webmanifest exists', manifestExists);
  if (manifestExists) {
    let manifest;
    try {
      manifest = JSON.parse(await read(join(OUT, 'manifest.webmanifest')));
      check('dist/manifest.webmanifest parses as JSON', true);
    } catch (e) {
      check('dist/manifest.webmanifest parses as JSON', false, e.message);
    }
    if (manifest) {
      check('manifest.start_url === /app/', manifest.start_url === '/app/', JSON.stringify(manifest.start_url));
      check('manifest.scope === /app/', manifest.scope === '/app/', JSON.stringify(manifest.scope));
    }
  }

  // 8
  check('dist/_headers exists', await exists(join(OUT, '_headers')));
  check('dist/_redirects exists', await exists(join(OUT, '_redirects')));

  // 9 — Astro's sitemap integration emits sitemap-index.xml + sitemap-N.xml,
  //     not sitemap.xml. Either the index or any sitemap-*.xml satisfies it.
  const hasSitemapIndex = await exists(join(OUT, 'sitemap-index.xml'));
  const hasSitemap0 = await exists(join(OUT, 'sitemap-0.xml'));
  check('dist/sitemap-index.xml or sitemap-0.xml exists', hasSitemapIndex || hasSitemap0);

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    process.stdout.write(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `  (${c.detail})` : ''}\n`);
  }
  if (failed.length > 0) {
    process.stderr.write(`\nvalidate-build: ${failed.length} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stdout.write(`\nvalidate-build: all ${checks.length} assertions passed\n`);
}

main().catch((err) => {
  process.stderr.write(`validate-build: ${err?.stack || err}\n`);
  process.exit(1);
});

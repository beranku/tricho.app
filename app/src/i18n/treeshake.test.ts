/**
 * Tree-shake budget — counts distinct `m.<key>(` references in the
 * shipped client chunks under `dist/_astro/`. Bundles every locale's
 * translation per key, so message count = catalog usage × #locales.
 *
 * The point of Paraglide is that islands import only the messages they
 * use. This test asserts that's still true: the largest island chunk
 * doesn't reference more than `MAX_MESSAGES_PER_BUNDLE` distinct keys.
 *
 * The test is a no-op if `dist/` doesn't exist (i.e. `npm run build`
 * was not run before the test). CI runs `build` first; locally,
 * developers see a skip rather than a false failure.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST_ASTRO = resolve(__dirname, '../../dist/_astro');
const MAX_MESSAGES_PER_BUNDLE = 80;

describe('paraglide tree-shake budget', () => {
  if (!existsSync(DIST_ASTRO)) {
    it.skip('skipped — `npm run build` not run', () => {
      /* skip */
    });
    return;
  }

  it('no built chunk references more than MAX_MESSAGES_PER_BUNDLE message keys', () => {
    const offenders: { file: string; count: number; sample: string[] }[] = [];

    for (const name of readdirSync(DIST_ASTRO)) {
      if (!name.endsWith('.js')) continue;
      const full = join(DIST_ASTRO, name);
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      const src = readFileSync(full, 'utf8');
      // Paraglide emits per-message functions named after the key. Look
      // for distinct names of the form `<key>(...)` where <key> appears
      // in the import section. A loose proxy: count occurrences of
      // `_<locale>:` (per-key locale switch) — this is what Paraglide's
      // bundle layout uses internally.
      const keyMatches = src.match(/from"\.\/messages\/[a-zA-Z0-9_]+\.js"/g) ?? [];
      const distinct = new Set(keyMatches);
      if (distinct.size > MAX_MESSAGES_PER_BUNDLE) {
        offenders.push({
          file: name,
          count: distinct.size,
          sample: Array.from(distinct).slice(0, 5),
        });
      }
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});

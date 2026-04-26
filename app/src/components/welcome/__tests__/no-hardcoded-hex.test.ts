/**
 * Design-system lint extension for the welcome wizard subtree. Same
 * contract as `src/components/astro/__tests__/no-hardcoded-hex.test.ts`,
 * but scans `.tsx` (React) instead of `.astro`.
 *
 * Allowed: `currentColor` SVGs that don't actually contain hex, the
 * Google brand-coloured logo segments (mandated brand colours), and the
 * QR canvas's pure black/white pair (scanner contrast is independent of
 * theme — see `Step3DownloadQr` for the rationale).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

const ALLOWED_SUBSTRINGS = [
  // Google brand colours for the OAuth button logo. Brand-mandated, not
  // tokens (see ui-design-system spec).
  '#4285F4', '#34A853', '#FBBC05', '#EA4335',
  // QR canvas pure white / pure ink — required for scanner contrast at
  // any theme. Documented in welcome.css and Step3DownloadQr.
  '#FFFFFF', '#FFFFFE', '#1C1917',
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe('design-system lint (welcome subtree): no stray hex literals', () => {
  it('every welcome .tsx uses var(--token), not raw hex', () => {
    const violations: string[] = [];
    for (const file of walk(ROOT)) {
      if (!file.endsWith('.tsx')) continue;
      // Skip test files themselves.
      if (file.endsWith('.test.tsx') || file.endsWith('.component.test.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      let scrubbed = src;
      for (const allow of ALLOWED_SUBSTRINGS) {
        scrubbed = scrubbed.split(allow).join('');
      }
      const matches = scrubbed.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (matches && matches.length > 0) {
        violations.push(`${file}: ${matches.join(', ')}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

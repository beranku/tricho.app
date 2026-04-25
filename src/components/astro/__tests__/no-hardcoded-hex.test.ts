/**
 * Design-system lint: components MUST consume design tokens (var(--ink), …),
 * not raw hex colour literals. Allow-list covers SVG `fill="currentColor"`,
 * the four legitimate hex sources (token files, layout meta tags, status-bar
 * dynamic island chrome on iOS), and intentional gradient-interior hexes
 * in the cam preview that are explicitly device-camera-photo-like.
 *
 * See ui-prototype/tricho-north-star.md §3.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

const ALLOWED_FILES = new Set<string>([
  // Tokens are the only place hex literals live.
  '../../styles/tokens.css',
  '../../styles/base.css',
  '../../styles/typography.css',
  '../../styles/global.css',
  '../../styles/legacy.css',
]);

// SVG fill/stroke `#1A1714` for the iOS dynamic island is an
// intentional non-token (it's the iPhone island, not the design system).
const ALLOWED_SUBSTRINGS = [
  '#1A1714', // iOS dynamic island
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe('design-system: no hard-coded hex outside tokens', () => {
  it('every astro component uses var(--token), not raw hex', () => {
    const violations: string[] = [];
    for (const file of walk(ROOT)) {
      if (!file.endsWith('.astro')) continue;
      const src = readFileSync(file, 'utf8');
      // Strip allowed substrings before scanning.
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

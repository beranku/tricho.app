/**
 * i18n lint: no Czech-diacritic literals in `src/components/**` or
 * `src/pages/**` outside of allow-listed files / lines marked with the
 * `// @i18n-allow` opt-out marker.
 *
 * Czech diacritics have ~zero false-positive rate against English UI
 * strings, so this is a cheap, accurate proxy for "you forgot to call
 * `m.<key>()`". Spec source: i18n-foundation/spec.md.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOTS = [
  resolve(__dirname, '../components'),
  resolve(__dirname, '../pages'),
  resolve(__dirname, '../layouts'),
];

const SCAN_EXTENSIONS = new Set(['.tsx', '.astro']);
const SKIP_SUFFIXES = ['.test.tsx', '.component.test.tsx', '.test.ts'];

const CZECH_DIACRITIC = /[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]/;

const ALLOWED_FILES = new Set<string>([
  // The offline page intentionally embeds Czech fallback strings inside
  // its frontmatter `fallbacks` object — they're applied at runtime by an
  // inline script when the user's persisted locale is `cs`.
  'pages/offline.astro',
]);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function stripComments(src: string): string {
  // Remove block comments (/* ... */) and HTML comments (<!-- ... -->),
  // including their content, so we don't flag Czech inside JSDoc.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Remove single-line `// ...` comments. We don't try to parse strings;
  // any `//` outside a string is a comment, and Czech literals in a real
  // string would still trip the diacritic regex.
  return out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('<!--')
  );
}

describe('i18n: no Czech literals outside message catalogs', () => {
  it('every UI file uses m.<key>(), not inline Czech', () => {
    const violations: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (!Array.from(SCAN_EXTENSIONS).some((ext) => file.endsWith(ext))) continue;
        if (SKIP_SUFFIXES.some((s) => file.endsWith(s))) continue;
        const rel = file.split('/src/')[1] ?? file;
        if (ALLOWED_FILES.has(rel)) continue;

        const raw = readFileSync(file, 'utf8');
        const stripped = stripComments(raw);
        const rawLines = raw.split('\n');
        const strippedLines = stripped.split('\n');
        let allowNext = false;
        for (let i = 0; i < strippedLines.length; i++) {
          const original = rawLines[i] ?? '';
          if (original.includes('@i18n-allow')) {
            allowNext = true;
            continue;
          }
          if (allowNext) {
            allowNext = false;
            continue;
          }
          if (isCommentLine(original)) continue;
          if (CZECH_DIACRITIC.test(strippedLines[i] ?? '')) {
            violations.push(`${rel}:${i + 1}: ${original.trim()}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('i18n: message catalog parity', () => {
  it('every key in en.json exists in cs.json and vice versa', () => {
    const en = JSON.parse(
      readFileSync(resolve(__dirname, 'messages/en.json'), 'utf8'),
    ) as Record<string, unknown>;
    const cs = JSON.parse(
      readFileSync(resolve(__dirname, 'messages/cs.json'), 'utf8'),
    ) as Record<string, unknown>;

    const enKeys = Object.keys(en).filter((k) => !k.startsWith('$'));
    const csKeys = Object.keys(cs).filter((k) => !k.startsWith('$'));

    const missingFromCs = enKeys.filter((k) => !(k in cs));
    const missingFromEn = csKeys.filter((k) => !(k in en));

    expect(missingFromCs, `Keys missing from cs.json: ${missingFromCs.join(', ')}`).toEqual([]);
    expect(missingFromEn, `Keys missing from en.json: ${missingFromEn.join(', ')}`).toEqual([]);
  });
});

describe('i18n: locale registry parity with inlang config', () => {
  it('LOCALES tuple matches project.inlang/settings.json', async () => {
    const settings = JSON.parse(
      readFileSync(resolve(__dirname, '../../project.inlang/settings.json'), 'utf8'),
    ) as { baseLocale: string; locales: string[] };
    const { LOCALES, DEFAULT_LOCALE } = await import('./config');

    expect(settings.locales).toEqual([...LOCALES]);
    expect(settings.baseLocale).toEqual(DEFAULT_LOCALE);
  });
});

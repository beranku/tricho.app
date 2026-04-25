/**
 * Locale registry — single source of truth for what languages the app supports.
 *
 * Adding a locale:
 *   1. Add the BCP-47 code to LOCALES (keep the order: default first).
 *   2. Add `src/i18n/messages/<code>.json` with every key from `en.json`.
 *   3. (Optional) Add `src/lib/format/<code>/` if formatting differs from English.
 *   4. Update `project.inlang/settings.json` `locales` array to match.
 *
 * The Paraglide compiler reads `project.inlang/settings.json`; a Vitest
 * test asserts the two lists stay in lock-step.
 */
export const LOCALES = ['en', 'cs'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = LOCALES[0];

/** Self-name displayed in the language picker; one per locale. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  cs: 'Čeština',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Resolve a host locale tag (e.g. "cs-CZ", "en-US") to a registered Locale,
 * stripping the region. Returns null if no match — callers fall back to
 * DEFAULT_LOCALE.
 */
export function resolveHostLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const bare = tag.split('-')[0]?.toLowerCase();
  return isLocale(bare) ? bare : null;
}

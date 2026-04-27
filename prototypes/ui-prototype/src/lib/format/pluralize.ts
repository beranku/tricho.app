/**
 * Czech pluralization (1 / 2-4 / 5+).
 *
 * Usage:
 *   pluralize(1, ['klient', 'klienti', 'klientů'])  // "klient"
 *   pluralize(3, ['klient', 'klienti', 'klientů'])  // "klienti"
 *   pluralize(5, ['klient', 'klienti', 'klientů'])  // "klientů"
 *   pluralize(0, ['klient', 'klienti', 'klientů'])  // "klientů"
 */
export function pluralize(count: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(count);
  if (abs === 1) return forms[0];
  if (abs >= 2 && abs <= 4) return forms[1];
  return forms[2];
}

/**
 * Convenience helper — combines count + form.
 *   pluralizeCount(3, ['klient', 'klienti', 'klientů']) // "3 klienti"
 */
export function pluralizeCount(count: number, forms: readonly [string, string, string]): string {
  return `${count} ${pluralize(count, forms)}`;
}

/** Common forms used throughout UI */
export const PLURAL_CLIENT = ['klient', 'klienti', 'klientů'] as const;
export const PLURAL_PHOTO = ['fotka', 'fotky', 'fotek'] as const;
export const PLURAL_MINUTE = ['minuta', 'minuty', 'minut'] as const;
export const PLURAL_HOUR = ['hodina', 'hodiny', 'hodin'] as const;
export const PLURAL_VISIT = ['návštěva', 'návštěvy', 'návštěv'] as const;
export const PLURAL_CHANGE = ['změna', 'změny', 'změn'] as const;

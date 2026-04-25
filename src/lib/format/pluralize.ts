/**
 * Czech pluralization — three forms:
 *   n === 1            → form[0]   ("klient")
 *   n in {2, 3, 4}     → form[1]   ("klienti")
 *   else (incl. 0/neg) → form[2]   ("klientů")
 *
 * Pure: no Intl, no host locale. Same input → same output across browsers,
 * Node test runners, and time zones.
 */
export function pluralize(n: number, forms: readonly [string, string, string]): string {
  if (n === 1) return forms[0];
  if (n >= 2 && n <= 4 && Number.isInteger(n)) return forms[1];
  return forms[2];
}

/**
 * English pluralization — two forms:
 *   n === 1            → form[0]   ("client")
 *   else (incl. 0/neg) → form[1]   ("clients") — for 2-tuple input
 *                       → form[2]   for 3-tuple input (Czech-shape compat)
 *
 * Accepting both shapes lets call sites pass a per-locale tuple sourced
 * from the message catalog. New code SHOULD pass 2-tuples under English.
 */
export function pluralize(
  n: number,
  forms:
    | readonly [string, string]
    | readonly [string, string, string],
): string {
  if (n === 1) return forms[0];
  return forms.length === 3 ? forms[2] : forms[1];
}

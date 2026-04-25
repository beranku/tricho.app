/**
 * Czech date formatter — "Dnes" / "Zítra" / "Včera" / "22. dubna" / full form.
 * Pure: no Intl, no host locale. Idempotent on calendar boundaries.
 *
 * Uses NBSP (U+00A0) between the day number and the month name.
 */

const MONTHS_GENITIVE = [
  'ledna', 'února', 'března', 'dubna', 'května', 'června',
  'července', 'srpna', 'září', 'října', 'listopadu', 'prosince',
] as const;

const WEEKDAYS = [
  'neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota',
] as const;

const NBSP = ' ';

export interface FormatDateOptions {
  /** Include weekday prefix: "čtvrtek 24. dubna 2026". Default false. */
  full?: boolean;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDelta(date: Date, today: Date): number {
  const a = startOfDay(date).getTime();
  const b = startOfDay(today).getTime();
  return Math.round((a - b) / 86_400_000);
}

export function formatDate(date: Date | number, today: Date | number, options: FormatDateOptions = {}): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const t = typeof today === 'number' ? new Date(today) : today;

  if (options.full) {
    const wd = WEEKDAYS[d.getDay()];
    return `${wd} ${d.getDate()}.${NBSP}${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
  }

  const delta = dayDelta(d, t);
  if (delta === 0) return 'Dnes';
  if (delta === 1) return 'Zítra';
  if (delta === -1) return 'Včera';

  return `${d.getDate()}.${NBSP}${MONTHS_GENITIVE[d.getMonth()]}`;
}

/**
 * Returns the Czech weekday name with a capitalised first letter,
 * for use as a kicker label ("Pátek", "Sobota", …).
 */
export function formatWeekdayKicker(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const wd = WEEKDAYS[d.getDay()];
  return wd.charAt(0).toUpperCase() + wd.slice(1);
}

/**
 * Czech date formatting helpers.
 * Contract: never produces "22.04.", always "22. dubna".
 * Uses Intl.DateTimeFormat with 'cs-CZ' locale.
 */

const MONTH_GENITIVE: Record<number, string> = {
  0: 'ledna',
  1: 'února',
  2: 'března',
  3: 'dubna',
  4: 'května',
  5: 'června',
  6: 'července',
  7: 'srpna',
  8: 'září',
  9: 'října',
  10: 'listopadu',
  11: 'prosince'
};

const WEEKDAY_NOMINATIVE: Record<number, string> = {
  0: 'Neděle',
  1: 'Pondělí',
  2: 'Úterý',
  3: 'Středa',
  4: 'Čtvrtek',
  5: 'Pátek',
  6: 'Sobota'
};

/**
 * Format date as "22. dubna" (day + month genitive, no year).
 * Used for day-header-today and day-dividers.
 */
export function formatShortDate(date: Date): string {
  const day = date.getDate();
  const monthName = MONTH_GENITIVE[date.getMonth()];
  return `${day}.\u00a0${monthName}`;
}

/**
 * Format date as "čtvrtek 24. dubna 2026" — full form for detail headers.
 */
export function formatFullDate(date: Date): string {
  const weekday = WEEKDAY_NOMINATIVE[date.getDay()]!.toLowerCase();
  const day = date.getDate();
  const monthName = MONTH_GENITIVE[date.getMonth()];
  const year = date.getFullYear();
  return `${weekday} ${day}. ${monthName} ${year}`;
}

/**
 * Context-aware day kicker: "Dnes" / "Zítra" / "Včera" / weekday name.
 * For dividers in daily schedule — input is the target date.
 *
 * Rules:
 * - Today → "Dnes"
 * - Tomorrow → "Zítra"
 * - Yesterday → "Včera"
 * - Within past 7 days or next 7 days → weekday name (Pátek, Sobota…)
 * - Otherwise → weekday name (could be enhanced later with date)
 */
export function formatDayKicker(date: Date, now: Date = new Date()): string {
  const targetDay = startOfDay(date);
  const today = startOfDay(now);
  const diffMs = targetDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Dnes';
  if (diffDays === 1) return 'Zítra';
  if (diffDays === -1) return 'Včera';

  return WEEKDAY_NOMINATIVE[date.getDay()]!;
}

/**
 * Returns true if the two dates fall on the same calendar day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Start of day (00:00:00.000).
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * End of day (23:59:59.999).
 */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

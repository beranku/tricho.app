/**
 * English date formatter — "Today" / "Tomorrow" / "Yesterday" / "Apr 22"
 * / full form "Friday, Apr 25". Pure: no Intl, no host locale.
 *
 * Regular space between month abbreviation and day; `, ` between weekday
 * and rest in the full form.
 */

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

export interface FormatDateOptions {
  /** Include weekday prefix: "Friday, Apr 25". Default false. */
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

export function formatDate(
  date: Date | number,
  today: Date | number,
  options: FormatDateOptions = {},
): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const t = typeof today === 'number' ? new Date(today) : today;

  if (options.full) {
    const wd = WEEKDAYS[d.getDay()];
    return `${wd}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  }

  const delta = dayDelta(d, t);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';

  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** English weekday name (Title Case), for use as a kicker label. */
export function formatWeekdayKicker(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return WEEKDAYS[d.getDay()];
}

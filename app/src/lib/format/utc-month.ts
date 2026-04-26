/**
 * Pure, deterministic UTC month-key formatter. Used to bucket photo docs into
 * calendar months for backup grouping. Always UTC so the same `takenAt` always
 * maps to the same bucket regardless of the device's local timezone.
 */

export function formatUtcMonth(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) {
    throw new Error('formatUtcMonth: invalid timestamp');
  }
  const d = new Date(timestampMs);
  const yyyy = d.getUTCFullYear();
  const mm = d.getUTCMonth() + 1; // 1-12
  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY_RE.test(value);
}

/** Returns "YYYY-MM" for the calendar month immediately preceding the given timestamp (UTC). */
export function previousUtcMonth(timestampMs: number): string {
  const d = new Date(timestampMs);
  // Move to first day of current month, then subtract one day → previous month.
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 1);
  return formatUtcMonth(prev.getTime());
}

/** Returns the timestamp (UTC ms) at the start of the YYYY-MM month. */
export function monthKeyToStartTimestamp(monthKey: string): number {
  if (!isValidMonthKey(monthKey)) throw new Error(`invalid monthKey: ${monthKey}`);
  const [yyyy, mm] = monthKey.split('-').map(Number);
  return Date.UTC(yyyy, mm - 1, 1);
}

/** Returns the timestamp (UTC ms) at the start of the month AFTER YYYY-MM. */
export function monthKeyToEndTimestamp(monthKey: string): number {
  if (!isValidMonthKey(monthKey)) throw new Error(`invalid monthKey: ${monthKey}`);
  const [yyyy, mm] = monthKey.split('-').map(Number);
  return Date.UTC(yyyy, mm, 1);
}

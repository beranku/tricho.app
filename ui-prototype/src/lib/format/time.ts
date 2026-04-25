/**
 * Czech time formatting helpers.
 * Always HH:MM 24-hour format, never AM/PM.
 */

/**
 * Format time as "09:10" or "16:30".
 */
export function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Format time range as "10:30 – 11:15" (en-dash, thin spaces).
 */
export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)}\u2009–\u2009${formatTime(end)}`;
}

/**
 * Countdown until a future time — returns "zbývá 45 min", "zbývá 1 h 15 min".
 * Returns null if target is in the past.
 */
export function formatRemaining(targetTime: Date, now: Date = new Date()): string | null {
  const diffMs = targetTime.getTime() - now.getTime();
  if (diffMs <= 0) return null;

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `zbývá ${minutes} min`;
  if (minutes === 0) return `zbývá ${hours}\u00a0h`;
  return `zbývá ${hours}\u00a0h ${minutes}\u00a0min`;
}

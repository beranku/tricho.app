/**
 * Czech short-form duration: "35 min", "2 h", "1 h 35 min", "celý den".
 * Regular space (not non-breaking) between number and unit.
 *
 * Pure (no Intl). 24h ± 30min collapses to "celý den".
 */
const MIN = 60_000;
const HOUR = 60 * MIN;

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;

  // All-day sentinel.
  if (Math.abs(ms - 24 * HOUR) <= 30 * MIN) return 'celý den';

  if (ms < HOUR) {
    const minutes = Math.round(ms / MIN);
    return `${minutes} min`;
  }

  const totalMin = Math.round(ms / MIN);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

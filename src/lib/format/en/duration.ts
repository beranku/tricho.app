/**
 * English short-form duration: "35 min", "2 h", "1 h 35 min", "all day".
 * Regular space between number and unit. 24h ± 30min collapses to "all day".
 */
const MIN = 60_000;
const HOUR = 60 * MIN;

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;

  if (Math.abs(ms - 24 * HOUR) <= 30 * MIN) return 'all day';

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

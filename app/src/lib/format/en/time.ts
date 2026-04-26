/**
 * 24h zero-padded time formatter — "09:10", "16:30".
 * English shares the Czech 24h convention for parity (no AM/PM).
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatTime(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

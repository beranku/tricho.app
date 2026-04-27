/**
 * Format free-slot duration: "volno 35 min", "volno 1 h 45 min",
 * "volno 3 h", "celý den volno".
 */
export function formatFreeSlot(durationMinutes: number): string {
  // Celodenní
  if (durationMinutes >= 60 * 8) return 'celý den volno';

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (hours === 0) return `volno ${minutes}\u00a0min`;
  if (minutes === 0) return `volno ${hours}\u00a0h`;
  return `volno ${hours}\u00a0h ${minutes}\u00a0min`;
}

/**
 * Service duration rendered in chip — "45 min", "1 h 30 min"
 */
export function formatServiceDuration(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (hours === 0) return `${minutes}\u00a0min`;
  if (minutes === 0) return `${hours}\u00a0h`;
  return `${hours}\u00a0h ${minutes}\u00a0min`;
}

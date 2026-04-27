/**
 * Appointment status — drives slot visual variant.
 * - upcoming: regular slot (Fraunces, full color)
 * - active: currently in progress (teal tint background, teal text)
 * - done: completed (dimmed with copper check mark)
 * - cancelled: crossed out (not in prototype yet)
 */
export type AppointmentStatus = 'upcoming' | 'active' | 'done' | 'cancelled';

/**
 * Service categories — determine chips shown in client detail.
 */
export type ServiceCategory =
  | 'konzultace'
  | 'diagnostika'
  | 'trichologicky-zakrok'
  | 'barveni'
  | 'strih'
  | 'melir';

/**
 * A single appointment / slot in the daily schedule.
 * Combines time, client, and services. Stored in IndexedDB.
 */
export interface Appointment {
  /** UUID v4 */
  id: string;
  /** FK → Client.id */
  clientId: string;
  /** ISO datetime — start time */
  startAt: string;
  /** ISO datetime — expected end */
  endAt: string;
  /** Current status */
  status: AppointmentStatus;
  /** List of applied services */
  services: ServiceCategory[];
  /** Free-form note visible in slot sub-text */
  note?: string;
  /** ISO datetime — last modified (sync) */
  updatedAt: string;
}

/**
 * Derived "free" slot shown between appointments.
 * Not stored — computed from gaps between Appointments.
 */
export interface FreeSlot {
  /** ISO datetime — start of free period */
  startAt: string;
  /** Duration in minutes */
  durationMinutes: number;
}

/** Union for what goes into the daily list */
export type DailySlot =
  | { kind: 'appointment'; data: Appointment }
  | { kind: 'free'; data: FreeSlot };

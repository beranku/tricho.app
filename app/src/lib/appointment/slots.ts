/**
 * Free-slot synthesis. Walks an appointment list within a single day and emits
 * a chronological, mixed list of real appointments and synthetic free slots
 * for any gap ≥ minGapMinutes within business hours.
 *
 * Free slots are not persisted: they are derived from the absence of a real
 * appointment, so changing business hours doesn't require a data migration.
 */
import type { AppointmentData } from '../../db/types';

const MIN = 60_000;

export interface BusinessHours {
  /** Unix ms — start of business hours for the day. */
  start: number;
  /** Unix ms — end of business hours for the day (exclusive). */
  end: number;
}

export interface FreeSlot {
  kind: 'free';
  startAt: number;
  endAt: number;
}

export interface AppointmentSlot {
  kind: 'appointment';
  appointment: AppointmentData & { id: string };
}

export type ScheduleSlot = AppointmentSlot | FreeSlot;

export interface SynthesizeOptions {
  minGapMinutes?: number;
}

export function synthesizeSlots(
  appointments: ReadonlyArray<AppointmentData & { id: string }>,
  hours: BusinessHours,
  options: SynthesizeOptions = {},
): ScheduleSlot[] {
  const minGap = (options.minGapMinutes ?? 15) * MIN;

  const sorted = [...appointments]
    .filter((a) => a.endAt > hours.start && a.startAt < hours.end)
    .sort((a, b) => a.startAt - b.startAt);

  const out: ScheduleSlot[] = [];
  let cursor = hours.start;

  for (const appt of sorted) {
    if (appt.startAt - cursor >= minGap) {
      out.push({ kind: 'free', startAt: cursor, endAt: appt.startAt });
    }
    out.push({ kind: 'appointment', appointment: appt });
    cursor = Math.max(cursor, appt.endAt);
  }

  if (hours.end - cursor >= minGap) {
    out.push({ kind: 'free', startAt: cursor, endAt: hours.end });
  }

  return out;
}

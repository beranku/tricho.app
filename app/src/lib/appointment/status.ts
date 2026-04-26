/**
 * Derive an appointment's effective status from time, with the persisted
 * `status` field as a one-way override toward `done`.
 *
 *   now < startAt           → 'scheduled'
 *   startAt ≤ now < endAt   → 'active'
 *   now ≥ endAt             → 'done'
 *   persisted status 'done' → 'done' (user explicitly closed it)
 */
import type { AppointmentData, AppointmentStatus } from '../../db/types';

export function currentStatus(appt: Pick<AppointmentData, 'startAt' | 'endAt' | 'status'>, now: number): AppointmentStatus {
  if (appt.status === 'done') return 'done';
  if (now < appt.startAt) return 'scheduled';
  if (now < appt.endAt) return 'active';
  return 'done';
}

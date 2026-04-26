/**
 * Pure-function unit tests for the appointment helpers.
 *
 * Spec source: openspec/specs/appointment-data/spec.md.
 */
import { describe, expect, it } from 'vitest';
import { currentStatus } from './status';
import { synthesizeSlots, type BusinessHours } from './slots';
import { validateAppointmentData, type AppointmentData } from '../../db/types';

const MIN = 60_000;
const HOUR = 60 * MIN;

const day0 = new Date(2026, 3, 25, 0, 0).getTime();
const businessHours: BusinessHours = {
  start: day0 + 8 * HOUR,
  end: day0 + 18 * HOUR,
};

function appt(start: number, end: number, status: AppointmentData['status'] = 'scheduled'): AppointmentData & { id: string } {
  return {
    id: `appointment:${start}`,
    customerId: `customer:${start}`,
    startAt: start,
    endAt: end,
    status,
    serviceLabel: 'Diagnostika',
    createdAt: 0,
  };
}

describe('currentStatus', () => {
  it('scheduled before start', () => {
    expect(currentStatus({ startAt: 100, endAt: 200, status: 'scheduled' }, 50)).toBe('scheduled');
  });

  it('active inside the interval', () => {
    expect(currentStatus({ startAt: 100, endAt: 200, status: 'scheduled' }, 150)).toBe('active');
  });

  it('done after the interval', () => {
    expect(currentStatus({ startAt: 100, endAt: 200, status: 'scheduled' }, 250)).toBe('done');
  });

  it('persisted done wins over time', () => {
    expect(currentStatus({ startAt: 100, endAt: 200, status: 'done' }, 50)).toBe('done');
  });
});

describe('synthesizeSlots', () => {
  it('emits a free slot at the start of the day if first appointment is later', () => {
    const slots = synthesizeSlots(
      [appt(businessHours.start + HOUR, businessHours.start + 2 * HOUR)],
      businessHours,
    );
    expect(slots[0]?.kind).toBe('free');
    expect((slots[0] as { startAt: number }).startAt).toBe(businessHours.start);
  });

  it('emits a free slot between appointments when gap >= minGapMinutes', () => {
    const slots = synthesizeSlots(
      [
        appt(businessHours.start + HOUR, businessHours.start + 2 * HOUR),
        appt(businessHours.start + 3 * HOUR, businessHours.start + 4 * HOUR),
      ],
      businessHours,
    );
    const free = slots.filter((s) => s.kind === 'free');
    // Day-start free + between-appts free + day-end free.
    expect(free.length).toBeGreaterThanOrEqual(2);
  });

  it('suppresses gaps below the threshold', () => {
    const a = appt(businessHours.start, businessHours.start + HOUR);
    const b = appt(businessHours.start + HOUR + 5 * MIN, businessHours.start + 2 * HOUR);
    const slots = synthesizeSlots([a, b], businessHours, { minGapMinutes: 15 });
    // No free slot for the 5-minute gap between a and b.
    const between = slots.filter((s, i) => i > 0 && i < slots.length - 1 && s.kind === 'free');
    expect(between.length).toBe(0);
  });

  it('sorts unsorted input by startAt', () => {
    const a = appt(businessHours.start + 4 * HOUR, businessHours.start + 5 * HOUR);
    const b = appt(businessHours.start + 1 * HOUR, businessHours.start + 2 * HOUR);
    const slots = synthesizeSlots([a, b], businessHours);
    const apptSlots = slots.filter((s) => s.kind === 'appointment');
    expect(apptSlots[0]?.kind).toBe('appointment');
    expect(apptSlots.map((s) => (s as { appointment: { id: string } }).appointment.id)).toEqual([
      b.id,
      a.id,
    ]);
  });
});

describe('validateAppointmentData', () => {
  it('rejects inverted intervals', () => {
    expect(() =>
      validateAppointmentData({
        customerId: 'c',
        startAt: 100,
        endAt: 100,
        status: 'scheduled',
        serviceLabel: 'x',
        createdAt: 0,
      }),
    ).toThrow(/endAt must be > startAt/);
  });

  it('rejects bad status', () => {
    expect(() =>
      validateAppointmentData({
        customerId: 'c',
        startAt: 100,
        endAt: 200,
        status: 'whatever',
        serviceLabel: 'x',
        createdAt: 0,
      }),
    ).toThrow();
  });

  it('rejects empty customerId', () => {
    expect(() =>
      validateAppointmentData({
        customerId: '',
        startAt: 100,
        endAt: 200,
        status: 'scheduled',
        serviceLabel: 'x',
        createdAt: 0,
      }),
    ).toThrow();
  });

  it('accepts well-formed data', () => {
    expect(() =>
      validateAppointmentData({
        customerId: 'c',
        startAt: 100,
        endAt: 200,
        status: 'scheduled',
        serviceLabel: 'Diagnostika',
        createdAt: 0,
      }),
    ).not.toThrow();
  });
});

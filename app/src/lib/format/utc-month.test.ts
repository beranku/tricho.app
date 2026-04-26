import { describe, it, expect } from 'vitest';
import {
  formatUtcMonth,
  isValidMonthKey,
  previousUtcMonth,
  monthKeyToStartTimestamp,
  monthKeyToEndTimestamp,
} from './utc-month';

describe('formatUtcMonth', () => {
  it('produces YYYY-MM in UTC', () => {
    expect(formatUtcMonth(Date.UTC(2026, 3, 25, 10, 30))).toBe('2026-04');
    expect(formatUtcMonth(Date.UTC(2024, 0, 1))).toBe('2024-01');
    expect(formatUtcMonth(Date.UTC(2024, 11, 31, 23, 59))).toBe('2024-12');
  });

  it('uses UTC, not local timezone', () => {
    // 2026-04-30T23:30 UTC is still April in UTC; in a +02:00 zone it is May 1
    // local. Helper must be UTC, so result stays April.
    expect(formatUtcMonth(Date.UTC(2026, 3, 30, 23, 30))).toBe('2026-04');
  });

  it('throws on invalid input', () => {
    expect(() => formatUtcMonth(NaN)).toThrow();
    expect(() => formatUtcMonth(Infinity)).toThrow();
  });
});

describe('isValidMonthKey', () => {
  it('accepts valid keys', () => {
    expect(isValidMonthKey('2026-04')).toBe(true);
    expect(isValidMonthKey('2000-01')).toBe(true);
    expect(isValidMonthKey('9999-12')).toBe(true);
  });

  it('rejects invalid keys', () => {
    expect(isValidMonthKey('2026-13')).toBe(false);
    expect(isValidMonthKey('2026-00')).toBe(false);
    expect(isValidMonthKey('26-04')).toBe(false);
    expect(isValidMonthKey('2026-4')).toBe(false);
    expect(isValidMonthKey('not a month')).toBe(false);
    expect(isValidMonthKey(123)).toBe(false);
    expect(isValidMonthKey(null)).toBe(false);
  });
});

describe('previousUtcMonth', () => {
  it('returns the month before', () => {
    expect(previousUtcMonth(Date.UTC(2026, 3, 15))).toBe('2026-03');
    expect(previousUtcMonth(Date.UTC(2026, 0, 1))).toBe('2025-12');
  });

  it('handles last day of month boundary', () => {
    expect(previousUtcMonth(Date.UTC(2026, 4, 1))).toBe('2026-04');
  });
});

describe('monthKeyToStartTimestamp / monthKeyToEndTimestamp', () => {
  it('round-trips with formatUtcMonth', () => {
    const monthKey = '2026-04';
    const start = monthKeyToStartTimestamp(monthKey);
    expect(formatUtcMonth(start)).toBe(monthKey);
    const end = monthKeyToEndTimestamp(monthKey);
    expect(end - start).toBe(30 * 86400 * 1000);
  });

  it('rejects malformed keys', () => {
    expect(() => monthKeyToStartTimestamp('invalid')).toThrow();
    expect(() => monthKeyToEndTimestamp('2026-13')).toThrow();
  });
});

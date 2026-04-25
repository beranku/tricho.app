/**
 * Pure-function tests for Czech formatting helpers.
 *
 * Spec source: openspec/specs/czech-formatting/spec.md.
 */
import { describe, expect, it } from 'vitest';
import { formatDate, formatWeekdayKicker } from './date';
import { formatTime } from './time';
import { formatDuration } from './duration';
import { pluralize } from './pluralize';

const NBSP = ' ';

describe('formatDate', () => {
  const today = new Date(2026, 3, 25); // 2026-04-25

  it('returns Dnes for the same day', () => {
    expect(formatDate(new Date(2026, 3, 25, 14, 30), today)).toBe('Dnes');
  });

  it('returns Zítra for the next day', () => {
    expect(formatDate(new Date(2026, 3, 26), today)).toBe('Zítra');
  });

  it('returns Včera for the previous day', () => {
    expect(formatDate(new Date(2026, 3, 24), today)).toBe('Včera');
  });

  it('returns "8. května" for a future date in another month', () => {
    expect(formatDate(new Date(2026, 4, 8), today)).toBe(`8.${NBSP}května`);
  });

  it('returns full form when opts.full is true', () => {
    // 2026-04-24 is a Friday.
    expect(formatDate(new Date(2026, 3, 24), today, { full: true })).toBe(
      `pátek 24.${NBSP}dubna 2026`,
    );
  });
});

describe('formatWeekdayKicker', () => {
  it('capitalises the weekday name', () => {
    // 2026-04-24 is a Friday.
    expect(formatWeekdayKicker(new Date(2026, 3, 24))).toBe('Pátek');
  });
});

describe('formatTime', () => {
  it('zero-pads single-digit hours', () => {
    const d = new Date(2026, 3, 25, 9, 10);
    expect(formatTime(d)).toBe('09:10');
  });

  it('zero-pads single-digit minutes', () => {
    const d = new Date(2026, 3, 25, 16, 5);
    expect(formatTime(d)).toBe('16:05');
  });

  it('does not emit AM/PM markers', () => {
    const d = new Date(2026, 3, 25, 22, 0);
    expect(formatTime(d)).toBe('22:00');
  });
});

describe('formatDuration', () => {
  it('formats minutes when under an hour', () => {
    expect(formatDuration(35 * 60_000)).toBe('35 min');
  });

  it('formats whole hours', () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe('2 h');
  });

  it('formats compound durations', () => {
    expect(formatDuration(60 * 60_000 + 55 * 60_000)).toBe('1 h 55 min');
  });

  it('collapses 24h to "celý den"', () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe('celý den');
  });

  it('treats 23h45m as "celý den" (within ±30min)', () => {
    expect(formatDuration(23 * 60 * 60_000 + 45 * 60_000)).toBe('celý den');
  });

  it('clamps negative durations to "0 min"', () => {
    expect(formatDuration(-1000)).toBe('0 min');
  });
});

describe('pluralize', () => {
  const klient = ['klient', 'klienti', 'klientů'] as const;

  it('one → form 0', () => {
    expect(pluralize(1, klient)).toBe('klient');
  });

  it('two/three/four → form 1', () => {
    expect(pluralize(2, klient)).toBe('klienti');
    expect(pluralize(3, klient)).toBe('klienti');
    expect(pluralize(4, klient)).toBe('klienti');
  });

  it('five+ → form 2', () => {
    expect(pluralize(5, klient)).toBe('klientů');
    expect(pluralize(142, klient)).toBe('klientů');
  });

  it('zero → form 2', () => {
    expect(pluralize(0, klient)).toBe('klientů');
  });

  it('negative → form 2', () => {
    expect(pluralize(-3, klient)).toBe('klientů');
  });
});

describe('purity (host-locale independence)', () => {
  it('does not depend on Intl', () => {
    // Save & remove Intl temporarily; helpers must keep working.
    const originalIntl = globalThis.Intl;
    try {
      // @ts-expect-error — intentional ablation
      globalThis.Intl = undefined;
      const today = new Date(2026, 3, 25);
      expect(formatDate(new Date(2026, 4, 8), today)).toBe(`8.${NBSP}května`);
      expect(formatTime(new Date(2026, 3, 25, 9, 10))).toBe('09:10');
      expect(formatDuration(35 * 60_000)).toBe('35 min');
      expect(pluralize(3, ['a', 'b', 'c'])).toBe('b');
    } finally {
      globalThis.Intl = originalIntl;
    }
  });
});

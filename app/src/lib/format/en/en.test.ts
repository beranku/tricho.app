/**
 * Pure-function tests for the English formatting helpers.
 *
 * Spec source: openspec/changes/i18n-multilocale-support/specs/english-formatting/spec.md.
 */
import { describe, expect, it } from 'vitest';
import { formatDate, formatWeekdayKicker } from './date';
import { formatTime } from './time';
import { formatDuration } from './duration';
import { pluralize } from './pluralize';

describe('en/formatDate', () => {
  const today = new Date(2026, 3, 25); // Saturday 2026-04-25

  it('returns Today for the same day', () => {
    expect(formatDate(new Date(2026, 3, 25, 14, 30), today)).toBe('Today');
  });

  it('returns Tomorrow for the next day', () => {
    expect(formatDate(new Date(2026, 3, 26), today)).toBe('Tomorrow');
  });

  it('returns Yesterday for the previous day', () => {
    expect(formatDate(new Date(2026, 3, 24), today)).toBe('Yesterday');
  });

  it('returns "May 8" for a future date in another month', () => {
    expect(formatDate(new Date(2026, 4, 8), today)).toBe('May 8');
  });

  it('returns full form when opts.full is true', () => {
    expect(formatDate(new Date(2026, 3, 25), today, { full: true })).toBe('Saturday, Apr 25');
  });
});

describe('en/formatWeekdayKicker', () => {
  it('returns the Title-Case weekday name', () => {
    expect(formatWeekdayKicker(new Date(2026, 3, 24))).toBe('Friday');
  });
});

describe('en/formatTime', () => {
  it('zero-pads single-digit hours', () => {
    expect(formatTime(new Date(2026, 3, 25, 9, 10))).toBe('09:10');
  });

  it('zero-pads single-digit minutes', () => {
    expect(formatTime(new Date(2026, 3, 25, 16, 5))).toBe('16:05');
  });

  it('does not emit AM/PM markers', () => {
    expect(formatTime(new Date(2026, 3, 25, 22, 0))).toBe('22:00');
  });
});

describe('en/formatDuration', () => {
  it('formats minutes when under an hour', () => {
    expect(formatDuration(35 * 60_000)).toBe('35 min');
  });

  it('formats whole hours', () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe('2 h');
  });

  it('formats compound durations', () => {
    expect(formatDuration(60 * 60_000 + 55 * 60_000)).toBe('1 h 55 min');
  });

  it('collapses 24h to "all day"', () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe('all day');
  });

  it('treats 23h45m as "all day" (within ±30min)', () => {
    expect(formatDuration(23 * 60 * 60_000 + 45 * 60_000)).toBe('all day');
  });

  it('clamps negative durations to "0 min"', () => {
    expect(formatDuration(-1000)).toBe('0 min');
  });
});

describe('en/pluralize', () => {
  const client = ['client', 'clients'] as const;

  it('one → form 0', () => {
    expect(pluralize(1, client)).toBe('client');
  });

  it('two+ → form 1', () => {
    expect(pluralize(2, client)).toBe('clients');
    expect(pluralize(3, client)).toBe('clients');
    expect(pluralize(142, client)).toBe('clients');
  });

  it('zero → form 1', () => {
    expect(pluralize(0, client)).toBe('clients');
  });

  it('negative → form 1', () => {
    expect(pluralize(-3, client)).toBe('clients');
  });

  it('Czech 3-tuple input picks index 2 for non-1 (compat path)', () => {
    expect(pluralize(3, ['client', 'clients-2-4', 'clients-5+'])).toBe('clients-5+');
  });
});

describe('en/purity (host-locale independence)', () => {
  it('does not depend on Intl', () => {
    const originalIntl = globalThis.Intl;
    try {
      // @ts-expect-error — intentional ablation
      globalThis.Intl = undefined;
      const today = new Date(2026, 3, 25);
      expect(formatDate(new Date(2026, 4, 8), today)).toBe('May 8');
      expect(formatTime(new Date(2026, 3, 25, 9, 10))).toBe('09:10');
      expect(formatDuration(35 * 60_000)).toBe('35 min');
      expect(pluralize(3, ['a', 'b'])).toBe('b');
    } finally {
      globalThis.Intl = originalIntl;
    }
  });
});

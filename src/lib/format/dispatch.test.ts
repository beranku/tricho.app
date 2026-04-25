/**
 * Dispatch tests — verify that `src/lib/format/index.ts` routes to the
 * correct per-locale module based on the active locale, and that the
 * dispatch layer itself adds no per-helper logic beyond delegation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatDate,
  formatTime,
  formatDuration,
  formatWeekdayKicker,
  pluralize,
} from './index';
import { setLocale, __resetLocaleRuntimeForTests } from '../../i18n/runtime';

describe('format dispatcher', () => {
  beforeEach(() => {
    __resetLocaleRuntimeForTests();
  });

  afterEach(() => {
    __resetLocaleRuntimeForTests();
  });

  describe('with locale = en', () => {
    beforeEach(() => setLocale('en'));

    it('formatDate uses English implementation', () => {
      const today = new Date(2026, 3, 25);
      expect(formatDate(today, today)).toBe('Today');
      expect(formatDate(new Date(2026, 4, 8), today)).toBe('May 8');
    });

    it('formatTime is identical across locales', () => {
      expect(formatTime(new Date(2026, 3, 25, 9, 10))).toBe('09:10');
    });

    it('formatDuration uses English sentinel', () => {
      expect(formatDuration(24 * 60 * 60_000)).toBe('all day');
    });

    it('formatWeekdayKicker returns English name', () => {
      expect(formatWeekdayKicker(new Date(2026, 3, 24))).toBe('Friday');
    });

    it('pluralize accepts a 2-tuple', () => {
      expect(pluralize(1, ['client', 'clients'])).toBe('client');
      expect(pluralize(5, ['client', 'clients'])).toBe('clients');
    });
  });

  describe('with locale = cs', () => {
    beforeEach(() => setLocale('cs'));

    it('formatDate uses Czech implementation', () => {
      const today = new Date(2026, 3, 25);
      expect(formatDate(today, today)).toBe('Dnes');
      expect(formatDate(new Date(2026, 4, 8), today)).toBe(`8. května`);
    });

    it('formatDuration uses Czech sentinel', () => {
      expect(formatDuration(24 * 60 * 60_000)).toBe('celý den');
    });

    it('formatWeekdayKicker returns Czech name', () => {
      expect(formatWeekdayKicker(new Date(2026, 3, 24))).toBe('Pátek');
    });

    it('pluralize accepts a 3-tuple and uses three-form rule', () => {
      const klient = ['klient', 'klienti', 'klientů'] as const;
      expect(pluralize(1, klient)).toBe('klient');
      expect(pluralize(3, klient)).toBe('klienti');
      expect(pluralize(5, klient)).toBe('klientů');
    });

    it('pluralize coerces 2-tuple to 3-tuple by repeating the second form', () => {
      expect(pluralize(3, ['client', 'clients'])).toBe('clients');
      expect(pluralize(5, ['client', 'clients'])).toBe('clients');
    });
  });

  it('switching locale changes formatDate output without args change', () => {
    const today = new Date(2026, 3, 25);
    setLocale('en');
    const enResult = formatDate(today, today);
    setLocale('cs');
    const csResult = formatDate(today, today);
    expect(enResult).toBe('Today');
    expect(csResult).toBe('Dnes');
  });
});

/**
 * Locale-aware format helpers — public API.
 *
 * Reads the active locale from the i18n runtime at each call. Each helper
 * dispatches to the matching `src/lib/format/<locale>/` implementation.
 * Per-locale modules MUST be pure (no `Intl.*`, no host-locale read), so
 * `(locale, ...args) → string` is byte-deterministic across runtimes.
 *
 * Adding a new locale: drop `src/lib/format/<code>/{date,time,duration,
 * pluralize}.ts` plus an `index.ts` re-export, then add a branch below.
 */
import { getLocale } from '../../i18n/runtime';
import * as cs from './cs';
import * as en from './en';

import type { FormatDateOptions as CsFormatDateOptions } from './cs/date';

export type FormatDateOptions = CsFormatDateOptions;

function impl() {
  switch (getLocale()) {
    case 'cs':
      return cs;
    case 'en':
    default:
      return en;
  }
}

export function formatDate(
  date: Date | number,
  today: Date | number,
  options?: FormatDateOptions,
): string {
  return impl().formatDate(date, today, options);
}

export function formatWeekdayKicker(date: Date | number): string {
  return impl().formatWeekdayKicker(date);
}

export function formatTime(date: Date | number): string {
  return impl().formatTime(date);
}

export function formatDuration(ms: number): string {
  return impl().formatDuration(ms);
}

export function pluralize(
  n: number,
  forms:
    | readonly [string, string]
    | readonly [string, string, string],
): string {
  // Czech demands a 3-tuple; English accepts both. Coerce a 2-tuple up to
  // 3 by repeating the "other" form for the cs branch.
  const csForms: readonly [string, string, string] =
    forms.length === 3 ? forms : [forms[0], forms[1], forms[1]];
  return getLocale() === 'cs' ? cs.pluralize(n, csForms) : en.pluralize(n, forms);
}

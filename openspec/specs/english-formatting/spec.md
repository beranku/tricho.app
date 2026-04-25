# english-formatting Specification

## Purpose
English-locale outputs for the four pure formatting helpers (`formatDate`, `formatTime`, `formatDuration`, `pluralize`). Mirror of `czech-formatting` for `en`; selected at runtime by the locale-aware dispatcher in `i18n-foundation`. New capability introduced by the i18n-multilocale-support change.

## Requirements
### Requirement: English date formatter follows US conventions

`formatDate(date, today, opts?)` under locale `en` MUST return:
- `Today` when `date` and `today` are the same calendar day.
- `Tomorrow` when `date` is the day after `today`.
- `Yesterday` when `date` is the day before `today`.
- `MMM D` (e.g. `Apr 22`) for any date within `[today − 6d, today + 6d]` excluding the above three. Month names use the three-letter English abbreviations (`Jan`, `Feb`, `Mar`, `Apr`, `May`, `Jun`, `Jul`, `Aug`, `Sep`, `Oct`, `Nov`, `Dec`).
- `dddd, MMM D` (e.g. `Friday, Apr 25`) only for "complete-format" callers explicitly opted in via `opts.full === true`. Day-of-week names: `Monday`, `Tuesday`, …, `Sunday`.

A regular space (not non-breaking) MUST separate the month abbreviation from the day number; in the full form, a comma + space MUST separate the weekday from the rest.

#### Scenario: Today

- **GIVEN** `today = 2026-04-25`
- **WHEN** `formatDate(2026-04-25, today)` is called under locale `en`
- **THEN** the result is `Today`

#### Scenario: Future day shows month

- **GIVEN** `today = 2026-04-25`
- **WHEN** `formatDate(2026-05-08, today)` is called under locale `en`
- **THEN** the result is `May 8`

#### Scenario: Full form includes weekday

- **GIVEN** `today = 2026-04-25` (a Saturday)
- **WHEN** `formatDate(2026-04-25, today, { full: true })` is called under locale `en`
- **THEN** the result is `Saturday, Apr 25`

### Requirement: English time formatter is 24-hour zero-padded

`formatTime(date)` under locale `en` MUST return `HH:mm` with both fields zero-padded (`09:10`, `16:30`). It MUST NOT emit AM/PM markers. (Tricho is a salon-scheduling tool; appointment times are always shown 24-hour for parity across locales and to avoid 12:00 AM/PM ambiguity at midnight.)

#### Scenario: Single-digit hour is padded

- **GIVEN** a date at `09:10` local time
- **WHEN** `formatTime` is called under locale `en`
- **THEN** the result is exactly `09:10`

### Requirement: English duration uses compact short forms

`formatDuration(ms)` under locale `en` MUST return:
- `X min` for durations under 60 minutes (`35 min`).
- `Y h` for whole-hour durations under 24 hours (`2 h`, `3 h`).
- `Y h Z min` for compound durations under 24 hours (`1 h 35 min`).
- `all day` for exactly `24 h ± 30 min` (sentinel for the all-day case, lower-case to match the Czech `celý den` register).

A regular space (not non-breaking) MUST separate the number and the unit. Units are lower-case (`min`, `h`); both English and Czech use the same unit symbols, only the all-day sentinel differs.

#### Scenario: Compound

- **WHEN** `formatDuration(6_900_000)` is called under locale `en` (1 h 55 min)
- **THEN** the result is `1 h 55 min`

#### Scenario: All-day sentinel

- **WHEN** `formatDuration(86_400_000)` is called under locale `en` (exactly 24 h)
- **THEN** the result is `all day`

### Requirement: English pluralization handles two forms

`pluralize(n, [one, other])` under locale `en` MUST select the form by English pluralization rules:
- `n === 1` → `one`
- otherwise (including `0`, `2+`, negatives) → `other`

The English forms array MUST be a 2-tuple `[one, other]`. If a 3-tuple is passed (the Czech shape), the implementation MUST select index 0 for `n === 1` and index 2 (the `manyOther` form, which is the closest English `other` analog) otherwise — this allows shared call sites to pass a single tuple per locale via the message-catalog system. New code SHOULD pass a 2-tuple under English to avoid the compatibility branch.

#### Scenario: One client

- **WHEN** `pluralize(1, ['client', 'clients'])` is called under locale `en`
- **THEN** the result is `client`

#### Scenario: Three clients

- **WHEN** `pluralize(3, ['client', 'clients'])` is called under locale `en`
- **THEN** the result is `clients`

#### Scenario: Zero clients

- **WHEN** `pluralize(0, ['client', 'clients'])` is called under locale `en`
- **THEN** the result is `clients`

#### Scenario: Czech 3-tuple under English uses other-form for n != 1

- **WHEN** `pluralize(3, ['client', 'clients-2-4', 'clients-5+'])` is called under locale `en`
- **THEN** the result is `clients-5+` (index 2)

### Requirement: English helpers are pure and host-locale-independent

The four helpers MUST NOT call `Intl.*`, MUST NOT read host locale, MUST NOT depend on `Date.prototype.toLocaleString`. Identical inputs MUST produce identical outputs across browsers, time zones, and Node test runners — the same purity contract `czech-formatting` enforces.

#### Scenario: Vitest runs identical to Chrome

- **GIVEN** the same `(date, today)` pair under Vitest (Node, default `process.env.LANG`) and Chrome (locale-set-to-Czech)
- **WHEN** `formatDate` runs in both with `getLocale() === 'en'` mocked
- **THEN** the strings are byte-identical

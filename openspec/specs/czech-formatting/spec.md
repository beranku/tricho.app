# czech-formatting Specification

## Purpose
TBD - created by archiving change prototype-ui-integration. Update Purpose after archive.
## Requirements
### Requirement: Date formatting follows Czech conventions

`formatDate(date, today)` MUST return:
- `Dnes` when `date` and `today` are the same calendar day.
- `Zítra` when `date` is the day after `today`.
- `Včera` when `date` is the day before `today`.
- `D. mmmm` (e.g. `22. dubna`) for any date within `[today − 6d, today + 6d]` excluding the above three.
- `dddd D. mmmm` (e.g. `pátek 25. dubna`) only for "complete-format" callers explicitly opted in.

The non-breaking space (U+00A0) MUST be used between the day number and the month name (`22. dubna`).

#### Scenario: Today

- **GIVEN** `today = 2026-04-25`
- **WHEN** `formatDate(2026-04-25, today)` is called
- **THEN** the result is `Dnes`

#### Scenario: Future day shows month

- **GIVEN** `today = 2026-04-25`
- **WHEN** `formatDate(2026-05-08, today)` is called
- **THEN** the result is `8. května`

### Requirement: Time formatting is 24h zero-padded

`formatTime(date)` MUST return `HH:mm` with both fields zero-padded (`09:10`, `16:30`). It MUST NOT emit AM/PM markers.

#### Scenario: Single-digit hour is padded

- **GIVEN** a date at `09:10` local time
- **WHEN** `formatTime` is called
- **THEN** the result is exactly `09:10`

### Requirement: Duration formatting uses Czech short forms

`formatDuration(ms)` MUST return:
- `X min` for durations under 60 minutes (`35 min`).
- `Y h` for whole-hour durations under 24 hours (`2 h`, `3 h`).
- `Y h Z min` for compound durations under 24 hours (`1 h 35 min`).
- `celý den` for exactly `24 h ± 30 min` (sentinel for "all-day").

A regular space (not non-breaking) is used between the number and the unit.

#### Scenario: Compound

- **WHEN** `formatDuration(6_900_000)` is called  (1h 55min)
- **THEN** the result is `1 h 55 min`

#### Scenario: Whole hour

- **WHEN** `formatDuration(7_200_000)` is called  (2h)
- **THEN** the result is `2 h`

### Requirement: Pluralization handles three Czech forms

`pluralize(n, [one, fewMany, manyOther])` MUST select the form by Czech pluralization rules:
- `n === 1` → `one`
- `n in 2..4` → `fewMany`
- otherwise → `manyOther`

Negative numbers and zero MUST follow the `manyOther` form.

#### Scenario: One client

- **WHEN** `pluralize(1, ['klient', 'klienti', 'klientů'])` is called
- **THEN** the result is `klient`

#### Scenario: Three clients

- **WHEN** `pluralize(3, ['klient', 'klienti', 'klientů'])` is called
- **THEN** the result is `klienti`

#### Scenario: Zero clients

- **WHEN** `pluralize(0, ['klient', 'klienti', 'klientů'])` is called
- **THEN** the result is `klientů`

### Requirement: Helpers are pure and host-locale-independent

The four helpers MUST NOT call `Intl.*`, MUST NOT read host locale, MUST NOT depend on `Date.prototype.toLocaleString`. Identical inputs MUST produce identical outputs across browsers, time zones, and Node test runners.

#### Scenario: Vitest runs identical to Chrome

- **GIVEN** the same `(date, today)` pair under Vitest (Node, en-US locale) and Chrome (Czech locale)
- **WHEN** `formatDate` runs in both
- **THEN** the strings are byte-identical


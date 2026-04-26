## ADDED Requirements

### Requirement: Step-card primitive expresses locked / active / done states

The system MUST provide a step-card primitive (consumed by the welcome wizard, available to any future stepwise UI) whose visual state is selected by `data-state="locked" | "active" | "done"`. Each state MUST resolve as follows:

- `locked`: opacity `0.62`, background `var(--surface-2)`, marker is a geometric lock SVG in `var(--ink-4)`, body is collapsed.
- `active`: opacity `1.0`, background `var(--surface)`, border `1px solid var(--copper-border)`, marker is the step number rendered in Geist tabular nums in `var(--copper-mid)`, body is expanded.
- `done`: opacity `0.5`, background `var(--surface-2)`, no shadow, marker is a hand-drawn copper check (the same idiom as the slot-done check from `Hand-drawn vocabulary is restricted to three uses`), body is collapsed.

The `done` state MUST be visually more recessed than the `locked` state — i.e., `done` opacity MUST be lower than `locked` opacity — to express past/present/future hierarchy. Components MUST NOT introduce a fourth state or override these opacity values.

#### Scenario: Locked card resolves the locked tokens
- **GIVEN** a `<StepCard>` with `data-state="locked"`
- **WHEN** the element is inspected
- **THEN** computed `opacity` is `0.62`
- **AND** computed `background-color` resolves to `var(--surface-2)`
- **AND** the marker slot contains a geometric lock SVG with `currentColor` of `var(--ink-4)`

#### Scenario: Active card resolves the active tokens
- **GIVEN** a `<StepCard>` with `data-state="active"`
- **WHEN** the element is inspected
- **THEN** computed `opacity` is `1.0`
- **AND** computed `border-color` resolves to `var(--copper-border)`
- **AND** the marker text resolves `font-family` starting with `Geist`
- **AND** the marker text has `font-variant-numeric: tabular-nums`

#### Scenario: Done card is more recessed than locked
- **GIVEN** a page with one `<StepCard data-state="done">` and one `<StepCard data-state="locked">`
- **WHEN** both are inspected
- **THEN** the `done` card's computed opacity is strictly less than the `locked` card's

### Requirement: Stage gradients and paper-grain blend tokens defined per theme

The system MUST expose `--paper-blend`, `--paper-opacity`, `--stage-gradient-1`, and `--stage-gradient-2` as CSS custom properties on `:root` and `:root[data-theme="dark"]`. `--paper-blend` MUST resolve to `multiply` in light mode and `screen` in dark mode so the paper-grain overlay tints the cream surface in light mode and lightens the espresso surface in dark mode rather than blacking it out.

#### Scenario: Paper-blend differs per theme
- **GIVEN** a page rendered in light mode and the same page in dark mode
- **WHEN** the resolved `--paper-blend` value is read
- **THEN** the light-mode value is `multiply`
- **AND** the dark-mode value is `screen`

#### Scenario: Stage gradient tokens are present in both themes
- **GIVEN** the global stylesheet
- **WHEN** the cascade is inspected on `:root` and `:root[data-theme="dark"]`
- **THEN** both define `--stage-gradient-1` and `--stage-gradient-2`
- **AND** neither resolves to an empty string

## MODIFIED Requirements

### Requirement: Typography roles are fixed per font family

The system MUST use:
- **Fraunces** for narrative content (client names, dates, slot times, headings, step titles, brand wordmark name).
- **Geist** for functional UI (chips, kickers, sub-text, numerics, step markers, OAuth button labels, the `.APP` brand suffix, monospace fingerprints via Geist Mono).
- **Patrick Hand** for prose annotations (free-slot label, camera hint, notes, Step 1 install hints, the welcome sub-line).
- **Caveat** for short hand-written annotations of an emotional or warning register — including the allergen badge, the data-loss warnings in the welcome wizard ("Tvůj klíč. Bez něj data neobnovíš.", "Tady už pokračovat nemůžeš…"), and the final-state welcome message ("Vítej v zápisníku.").

A component MUST NOT swap a typography role for stylistic preference. Numeric runs (times, dates, counts, prices, temperatures, step numbers) MUST set `font-variant-numeric: tabular-nums`.

#### Scenario: Slot uses correct typography

- **GIVEN** a `<Slot>` rendering time `09:10`, name `Jana Nováková`, sub `Diagnostika`
- **WHEN** the slot is mounted
- **THEN** the time element resolves `font-family` starting with `Fraunces`
- **AND** the name element resolves `font-family` starting with `Fraunces`
- **AND** the sub element resolves `font-family` starting with `Geist`
- **AND** the time element has `font-variant-numeric: tabular-nums`

#### Scenario: Welcome wizard warning uses Caveat
- **GIVEN** the welcome wizard rendered at Step 3 new-flow `qr` substep
- **WHEN** the amber data-loss warning above the QR is inspected
- **THEN** its resolved `font-family` starts with `Caveat`
- **AND** its resolved `color` is `var(--amber)`

#### Scenario: Final-state welcome message uses Caveat
- **GIVEN** the welcome wizard rendered in `currentStep === 'final'`
- **WHEN** the "Vítej v zápisníku." element is inspected
- **THEN** its resolved `font-family` starts with `Caveat`
- **AND** its resolved `color` is `var(--copper)`

#### Scenario: Step number uses Geist with tabular nums
- **GIVEN** a `<StepCard data-state="active">` with step number `2`
- **WHEN** the marker element is inspected
- **THEN** its resolved `font-family` starts with `Geist`
- **AND** it has `font-variant-numeric: tabular-nums`

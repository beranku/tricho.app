# ui-design-system Specification

## Purpose
TBD - created by archiving change prototype-ui-integration. Update Purpose after archive.
## Requirements
### Requirement: Design tokens defined as CSS custom properties on `:root`

The system MUST expose all colour, surface, ink, and effect values as CSS custom properties on `:root`, with a parallel set under `:root[data-theme="dark"]`. Components MUST consume tokens (`var(--ink)`, `var(--surface)`, …) and MUST NOT hard-code colour values.

#### Scenario: Theme toggling swaps every consumer

- **GIVEN** a page that renders `<Slot>`, `<DetailCard>`, and `<Chip>` components
- **WHEN** `data-theme="dark"` is applied to `<html>`
- **THEN** every component's resolved background, border, and text colour changes to its dark-mode value
- **AND** no element retains a light-mode hex value in its computed style

#### Scenario: Hard-coded colour is a violation

- **GIVEN** a component file under `src/components/`
- **WHEN** the file contains a hex literal (`#[0-9A-Fa-f]{3,8}`) outside of font/SVG `fill="currentColor"` or token-definition files
- **THEN** the design-system lint check (Vitest unit) MUST fail

### Requirement: Paper-grain texture is fixed-position and never disabled

The paper-grain SVG noise overlay MUST be present on every page via the global layout, MUST use `mix-blend-mode: var(--paper-blend)` and `opacity: var(--paper-opacity)`, MUST be `pointer-events: none`, and MUST NOT be removable by component-level toggles.

#### Scenario: Layout renders paper-grain

- **GIVEN** a route rendered through `Layout.astro`
- **WHEN** the page is loaded
- **THEN** a `paper-grain` element exists inside the document body
- **AND** its computed `pointer-events` is `none`
- **AND** its `background-image` references the SVG-noise data URI from `--paper-grain`

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

### Requirement: Hand-drawn vocabulary is restricted to three uses

Hand-drawn SVGs (ballpoint stroke 1.6–2.4, copper or copper-mid colour, opacity 0.85, round caps/joins) MUST be limited to:
1. Day-header weather sun glyph.
2. Slot-done check mark.
3. Slot-free `+` glyph (Caveat-rendered).

All other UI glyphs MUST be geometric (uniform stroke, `currentColor`, no irregular paths). Adding a fourth hand-drawn use is a spec change.

#### Scenario: Hamburger menu is geometric

- **GIVEN** the chrome-buttons layer rendered on Phone A
- **WHEN** the menu glyph SVG is inspected
- **THEN** it consists of three straight horizontal lines with `stroke-linecap: round`
- **AND** its colour resolves to `var(--ink-2)`
- **AND** the SVG contains no irregular path commands

### Requirement: Fonts are self-hosted and offline-available

The four font families (Fraunces, Geist, Caveat, Patrick Hand) MUST be served from `public/fonts/` via `@font-face` declarations in the global stylesheet. The build MUST NOT load fonts from `fonts.googleapis.com` or any other third-party CDN at runtime. Font subsetting MUST cover Latin + Czech diacritics at a minimum.

#### Scenario: No third-party font requests at runtime

- **GIVEN** a fresh PWA build served from a host with no network bridge to `fonts.googleapis.com`
- **WHEN** any page is loaded
- **THEN** every `font-display` font load resolves against `/fonts/...` on the same origin
- **AND** no request is made to `fonts.googleapis.com` or `fonts.gstatic.com`

#### Scenario: Czech diacritics render

- **GIVEN** a `<Slot>` with name `Jiří Žák`
- **WHEN** the slot is mounted
- **THEN** the text renders without `.notdef` boxes for `ř` or `Ž`

### Requirement: Universal transition timing

State-change animations (background, colour, border, opacity) MUST use `0.22s cubic-bezier(0.4, 0, 0.2, 1)` unless explicitly excepted. Allowed exceptions: bottom-sheet open/close (`0.32s`), desktop hover (`0.15s`).

#### Scenario: Default transition matches the system

- **GIVEN** a `<Chip>` with hover state
- **WHEN** the user hovers (desktop)
- **THEN** the resolved `transition-timing-function` is `cubic-bezier(0.4, 0, 0.2, 1)`
- **AND** the resolved `transition-duration` is `0.15s` or `0.22s`

### Requirement: Light-mode is the default theme on first paint

The HTML root MUST render with `data-theme="light"` (or absent) by default during static SSR. Dark theme MUST only be applied client-side once the persisted preference is read.

#### Scenario: Static HTML ships in light mode

- **GIVEN** the production build output
- **WHEN** an Astro page's HTML is inspected without executing client JS
- **THEN** `<html>` has no `data-theme="dark"` attribute

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


## ADDED Requirements

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
- **Fraunces** for narrative content (client names, dates, slot times, headings).
- **Geist** for functional UI (chipy, kickers, sub-text, numerics).
- **Patrick Hand** for prose annotations (free-slot label, camera hint, notes).
- **Caveat** for short hand-written annotations (allergen badge).

A component MUST NOT swap a typography role for stylistic preference. Numeric runs (times, dates, counts, prices, temperatures) MUST set `font-variant-numeric: tabular-nums`.

#### Scenario: Slot uses correct typography

- **GIVEN** a `<Slot>` rendering time `09:10`, name `Jana Nováková`, sub `Diagnostika`
- **WHEN** the slot is mounted
- **THEN** the time element resolves `font-family` starting with `Fraunces`
- **AND** the name element resolves `font-family` starting with `Fraunces`
- **AND** the sub element resolves `font-family` starting with `Geist`
- **AND** the time element has `font-variant-numeric: tabular-nums`

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

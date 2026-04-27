## ADDED Requirements

### Requirement: Landing page composes the production sections from the prototype

The marketing landing at `/` MUST compose, in this order: a sticky `<Header>`, a `<Hero>`, a "01 — Two screens" section, a "02 — Story" section, a "03 — Privacy" section, a "04 — Pricing" section, a "05 — Voices" section, a "06 — FAQ" section, a `<FinalCta>`, and a `<Footer>`. No other top-level sections (logo bar, newsletter signup, blog teaser) MAY appear on the landing page. Each numbered section MUST render a section header with its `01`–`06` ordinal in `Geist Mono` and an `<h2>` in `Fraunces`. Section 03 ("Privacy") MUST NOT render a section sub-line — the design intentionally omits it.

#### Scenario: Sections render in the locked order
- **GIVEN** the production build of `/`
- **WHEN** the rendered HTML is parsed
- **THEN** `<header>`, `<section>` elements for sections 01–06, the final-CTA section, and `<footer>` appear in the order Header, Hero, 01, 02, 03, 04, 05, 06, FinalCta, Footer

#### Scenario: Privacy section deliberately omits the section sub
- **GIVEN** the rendered Privacy section
- **WHEN** the section header is parsed
- **THEN** it contains the `<h2>` "Co ti řekne klientka, zůstane *mezi vámi*."
- **AND** it does not contain a `.section-sub` element

### Requirement: Landing-page copy is sourced verbatim from the locked Czech copy module

All visible Czech copy on the landing page MUST come from `web/src/content/landing.ts`, which is a verbatim mirror of `prototypes/landing-page-prototype/COPY.md`. Components MUST NOT inline marketing strings. The page `<title>` MUST be `Tricho.app — Karta klientky, která si pamatuje za tebe`. The `<meta name="description">` MUST be `Aplikace pro samostatné tricholožky a kadeřnice. Anamnéza, alergeny, fotky pokožky, historie návštěv — všechno na jednom místě, v telefonu. Šifrované, offline, zdarma.`. The `<html lang>` attribute MUST be `cs`.

#### Scenario: Title and description match the locked copy
- **GIVEN** the landing page builds
- **WHEN** the `<head>` is parsed
- **THEN** `<title>` is exactly `Tricho.app — Karta klientky, která si pamatuje za tebe`
- **AND** `<meta name="description">` content matches the description string above
- **AND** `<html lang="cs">` is set

#### Scenario: A future copy edit is one-file
- **GIVEN** an editor wants to change the hero lede
- **WHEN** they edit `web/src/content/landing.ts` and rebuild
- **THEN** the rendered hero shows the new lede
- **AND** no `.astro` component file needed editing

### Requirement: Landing page exposes a theme toggle that respects user preference and persists choice

The landing page MUST render a `<ThemeToggle>` button in the sticky header with `aria-label="Přepnout motiv"`. Clicking the toggle MUST flip `data-theme` between `light` (no attribute or attribute value `light`) and `dark` on `<html>`, and MUST persist the choice to `localStorage['tricho-theme']`. On first visit (no stored value), the page MUST honour `prefers-color-scheme: dark` and apply dark mode without a flash of unstyled content. The first-paint theme decision MUST happen in a blocking inline `<script>` in `<head>` so that no light-flash occurs before dark theme applies.

#### Scenario: Stored dark theme survives reload without FOUC
- **GIVEN** `localStorage['tricho-theme']` is `'dark'`
- **WHEN** the page is loaded
- **THEN** `<html data-theme="dark">` is set before any CSS paints
- **AND** the page renders in dark mode immediately

#### Scenario: User with prefers-color-scheme: dark sees dark mode by default
- **GIVEN** the visitor has not toggled the theme before
- **AND** the operating system is in dark mode
- **WHEN** the page is loaded
- **THEN** the page renders in dark mode

#### Scenario: Toggle click flips and persists
- **GIVEN** the page is currently in light mode
- **WHEN** the user clicks the theme-toggle button
- **THEN** `<html data-theme="dark">` is set
- **AND** `localStorage['tricho-theme']` is `'dark'`
- **AND** all colours rebind to the dark palette via CSS variables (no per-component branching)

### Requirement: FAQ accordion uses native details/summary with single-open behavior

The FAQ section MUST render exactly the eight questions from `landing.ts`, each as a `<details><summary>...</summary>...</details>` so the accordion is keyboard-accessible and works with JavaScript disabled. With JavaScript enabled, opening one item MUST close the others ("single-open"). The accordion script MUST NOT block initial render and MUST NOT exceed ~10 lines of JS.

#### Scenario: All eight questions render
- **GIVEN** the FAQ section
- **WHEN** the rendered HTML is parsed
- **THEN** there are exactly 8 `<details class="faq-item">` elements
- **AND** their `<summary>` text matches the eight questions in `landing.ts`

#### Scenario: Items are operable without JavaScript
- **GIVEN** JavaScript is disabled
- **WHEN** the user clicks a `<summary>`
- **THEN** the corresponding `<details>` toggles open

#### Scenario: Opening one closes the others
- **GIVEN** JavaScript is enabled
- **AND** FAQ item 3 is open
- **WHEN** the user opens FAQ item 5
- **THEN** item 5 is open
- **AND** item 3 is closed

### Requirement: Landing-page mockups are pure HTML/CSS, not raster images

The two phone mockups (Diář in the hero + TwoScreens, Karta klientky in TwoScreens) MUST be implemented as semantic HTML composed via `<PhoneFrame>`, `<PhoneStatusBar>`, `<PhoneSlot>`, `<ContentDiar>`, and `<ContentKartaKlientky>` components, styled with CSS using design tokens. They MUST NOT be served as PNG/JPEG/WebP. Mockup colours MUST flip with the theme via CSS variables, not via swapped image assets. The mockups MUST display the schedule entries and client-card data exactly as specified in `COPY.md` (times, names, alergen tags, history items).

#### Scenario: No raster mockup is shipped
- **GIVEN** the production build of the landing page
- **WHEN** the network requests are inspected
- **THEN** no image request whose path contains `phone`, `mockup`, `diar`, or `karta` is served as PNG/JPEG/WebP

#### Scenario: Mockups invert in dark mode
- **GIVEN** the page is in dark mode
- **WHEN** the phone frame is inspected
- **THEN** the `--phone-frame` and `--phone-frame-border` token values match the dark-theme palette

### Requirement: Landing page extends the brand token palette without breaking PWA token parity

`web/src/styles/tokens.css` MUST add the following CSS variables in light and dark variants: `--cream`, `--cream-2`, `--line-2`, `--ink-3-soft`, `--ink-4-soft`, `--teal-200`, `--teal-600`, `--teal-700`, `--teal-900`, `--copper-deep`, `--copper-soft`, `--copper-50`, `--radius-ctrl`, `--paper-grain`. The PWA shell at `/app/` MUST NOT be affected by this change because it owns an independent copy of `tokens.css` under `app/src/styles/`. Within `web/`, color tokens that already existed (`--bg`, `--surface`, `--ink`, `--copper`, `--copper-mid`, `--phone-frame`, etc.) MUST keep their current hex values so other marketing pages (`/about`, `/pricing`, `/legal/**`) render visually identical to before. The shared `--radius-card` variable MAY be bumped from `14px` to `18px` to match the landing prototype's card radii — this is the only existing token whose value changes, and it produces a minor cosmetic shift in legal-page warning boxes. Components MUST consume tokens (`var(--ink-2)`); raw hex literals outside `tokens.css` are a violation.

#### Scenario: Existing color tokens in web/ are unchanged
- **GIVEN** the diff against `main`
- **WHEN** the changed lines in `web/src/styles/tokens.css` are inspected
- **THEN** every pre-existing color variable (`--bg`, `--surface`, `--ink`, `--ink-2..4`, `--copper`, `--copper-mid`, `--phone-frame`, `--phone-frame-border`, `--teal`, `--teal-strong`, `--teal-tint`, `--teal-border`, etc.) retains its pre-change hex value

#### Scenario: PWA tokens are not touched
- **GIVEN** the diff against `main`
- **WHEN** `app/src/styles/tokens.css` is inspected
- **THEN** there are no edits to that file in this change

#### Scenario: Dark theme covers all new tokens
- **GIVEN** `:root[data-theme="dark"]` block in `web/src/styles/tokens.css`
- **WHEN** the new variables added under `:root` are enumerated
- **THEN** every one of them has a corresponding override under `:root[data-theme="dark"]`

### Requirement: Landing page does not introduce client-side JavaScript beyond the theme toggle and FAQ accordion

The landing page MUST NOT ship any client-side JavaScript framework (React, Vue, Svelte islands, etc.). Beyond the inline scripts already in `Base.astro` (service-worker registration, install-banner reveal, launch-app reveal) and the inline FOUC theme-init in `<head>`, the only additional JavaScript MUST be: the click handler in `<ThemeToggle>` and the `toggle` listener in `<Faq>`. The aggregate compressed JavaScript bytes shipped to the client MUST stay below the existing 50 KB budget set by `marketing-site`.

#### Scenario: No framework runtime is shipped
- **GIVEN** the production build
- **WHEN** the JS files in `dist/` are inspected
- **THEN** no React, Vue, Svelte, or hydration runtime is present

#### Scenario: Inline-script lines are bounded
- **GIVEN** the rendered `index.html`
- **WHEN** the inline `<script>` blocks are counted
- **THEN** the new theme toggle init + click handler total ≤ 25 lines of source
- **AND** the FAQ accordion handler totals ≤ 10 lines of source

### Requirement: Landing-page CTA placements all link to the PWA shell

The "Začít zdarma" call-to-action MUST appear in 4 locations: the sticky header, the hero, the Free pricing block, and the final-CTA section. Every instance MUST link to `/app/` (the PWA shell). No other primary CTAs MAY be added on the landing page.

#### Scenario: All CTA instances target /app/
- **GIVEN** the rendered landing page
- **WHEN** every `<a>` whose visible text is `Začít zdarma` is enumerated
- **THEN** there are exactly 4 such links
- **AND** each one's `href` is `/app/`

### Requirement: Landing page preserves the existing install-banner and launch-app affordances

The landing page MUST continue to render the `<InstallBanner>` (hidden by default, revealed by `Base.astro` only on iOS Safari in browser mode and not previously dismissed) and the `<LaunchAppLink>` (hidden by default, revealed only when `display-mode: standalone`). These components MUST remain unmodified by this change beyond, optionally, repositioning them within the new layout.

#### Scenario: Install banner is still hidden by default in the new layout
- **GIVEN** the rebuilt landing page on a non-iOS visitor
- **WHEN** the rendered HTML is parsed
- **THEN** `[data-install-banner]` is present with the `hidden` attribute

#### Scenario: Launch-app link is still hidden by default
- **GIVEN** the rebuilt landing page in browser mode
- **WHEN** the rendered HTML is parsed
- **THEN** `[data-launch-app]` is present with the `hidden` attribute

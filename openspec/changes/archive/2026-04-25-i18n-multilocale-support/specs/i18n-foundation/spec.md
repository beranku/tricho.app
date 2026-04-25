## ADDED Requirements

### Requirement: Locale registry is the single source of truth

The set of supported locales MUST be declared in exactly one place: `src/i18n/config.ts`, exporting a `const LOCALES` tuple typed as `readonly ['en', 'cs', ...]` and a derived `Locale` union type. The first entry MUST be the default locale. Every other module that needs to know "what locales exist" MUST import from this file.

The Paraglide compiler configuration in `inlang/project.json` MUST be kept in lock-step with `LOCALES` (same list, same order); a CI lint MUST fail if the two diverge.

#### Scenario: Adding a locale touches one tuple

- **GIVEN** `LOCALES = ['en', 'cs'] as const`
- **WHEN** a developer adds German by changing the tuple to `['en', 'cs', 'de'] as const` and adds `messages/de.json`
- **THEN** the `Locale` union type widens to `'en' | 'cs' | 'de'`
- **AND** the format-helper dispatcher type-errors until `src/lib/format/de/` exists
- **AND** Paraglide's compiler emits message functions for all three locales

#### Scenario: Default locale is the first registry entry

- **GIVEN** `LOCALES = ['en', 'cs'] as const`
- **WHEN** any module reads `LOCALES[0]` as the default
- **THEN** the value is `'en'`

### Requirement: Messages are authored as flat JSON catalogs

Each locale MUST have exactly one catalog file at `src/i18n/messages/<locale>.json`. The file MUST be valid JSON, MUST be flat (one level: keys are dot-separated strings, values are strings or Paraglide message objects with `{ match: ..., other: ... }` for plural variants), and MUST share the same key-set across every locale.

A unit test MUST assert that for every key in `messages/en.json`, the same key exists in every other catalog, and vice versa. A build error from Paraglide on a missing key is acceptable instead.

#### Scenario: Catalog parity holds

- **GIVEN** `messages/en.json` contains key `client.notFound`
- **WHEN** a developer adds the key to `en.json` but forgets `cs.json`
- **THEN** the parity test (or Paraglide compile) fails with a message naming the missing key and locale

#### Scenario: Keys are dot-namespaced

- **GIVEN** a UI surface "client detail card kicker"
- **WHEN** a string is added for it
- **THEN** the chosen key follows the pattern `<screen>.<region>.<role>` (e.g. `client.detail.kicker`)

### Requirement: Components consume messages via `m.<key>(...)` only

Every UI component (`.tsx`, `.astro`) that renders user-facing text MUST do so by calling a Paraglide-emitted message function imported from `@/i18n` (which re-exports `m` from `src/paraglide/messages.js`). Components MUST NOT import locale codes, MUST NOT branch on the active locale, and MUST NOT contain hardcoded user-facing strings in any registered locale.

A Vitest unit lint MUST scan `src/components/**/*.{tsx,astro}` and `src/pages/**/*.astro` for any character in `[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]` outside of comments and `data-*` attribute names; any match MUST fail the build with the file path and the offending excerpt.

#### Scenario: Hardcoded Czech literal fails the lint

- **GIVEN** a component file containing the literal string `<span>Klienti</span>`
- **WHEN** the lint runs
- **THEN** the test fails with output naming the file and the literal `Klienti`

#### Scenario: A message function call passes the lint

- **GIVEN** a component file containing `<span>{m.menu_clients()}</span>`
- **WHEN** the lint runs
- **THEN** no failure is reported

### Requirement: Locale runtime exposes a stable, framework-neutral API

`src/i18n/runtime.ts` MUST export:
- `getLocale(): Locale` — returns the current locale synchronously.
- `setLocale(locale: Locale): void` — switches the active locale in memory only (does not persist).
- `setLocaleAndPersist(locale: Locale): Promise<void>` — switches and writes `_local/locale` (see `locale-preference`).
- `subscribe(listener: (locale: Locale) => void): () => void` — registers a change listener; returns an unsubscriber.
- A `localeStore` nanostore (re-export of the underlying atom) for `@nanostores/react` consumers.

Calling `setLocale` MUST notify subscribers synchronously and update Paraglide's internal locale state before returning. Calling `setLocaleAndPersist` MUST do the in-memory switch first (so the UI updates immediately), then write the doc; a write failure MUST NOT roll back the in-memory state.

#### Scenario: Switching notifies subscribers

- **GIVEN** an island that has called `subscribe(fn)`
- **WHEN** `setLocale('cs')` runs
- **THEN** `fn` was invoked with `'cs'` synchronously
- **AND** a subsequent `getLocale()` returns `'cs'`

#### Scenario: Persistence failure does not revert UI

- **GIVEN** PouchDB is unavailable (rejected `put`)
- **WHEN** `setLocaleAndPersist('cs')` is awaited and rejects
- **THEN** `getLocale()` still returns `'cs'`
- **AND** subscribers were notified once with `'cs'`

### Requirement: `<html lang>` reflects the active locale

Whenever the active locale changes (boot, user toggle, persistence rehydration), the `lang` attribute on the document's `<html>` element MUST be updated to the active locale code. Static SSR output MUST NOT pin `<html lang>` to a single locale; the layout MUST emit `<html>` without a `lang` attribute and rely on the client bootstrap script to set it before paint.

#### Scenario: Toggling updates the attribute

- **GIVEN** `document.documentElement.getAttribute('lang') === 'en'`
- **WHEN** `setLocale('cs')` runs
- **THEN** `document.documentElement.getAttribute('lang') === 'cs'` within the same task tick

#### Scenario: Static HTML carries no `lang`

- **GIVEN** the production Astro build output for `index.astro`
- **WHEN** the `<html>` opening tag is inspected without executing any client script
- **THEN** the tag has no `lang` attribute (or has `lang=""`)

### Requirement: Anti-flash bootstrap reads locale before first paint

The `Layout.astro` `<head>` MUST contain a synchronous inline `<script>` that opens the default IndexedDB database used by PouchDB, reads `_local/locale` and `_local/theme`, and applies `<html lang>` and `<html data-theme>` before any rendered content paints. If the locale doc is missing, the script MUST fall back to the registered locale matching `navigator.language` (region-stripped); if no match, to `LOCALES[0]`. The script MUST be self-contained (no module imports) and MUST run before any other script in the document.

#### Scenario: Cold-start cache without persisted locale uses `navigator.language`

- **GIVEN** a fresh install (`_local/locale` missing) on a browser reporting `navigator.language === 'cs-CZ'`
- **WHEN** the page first paints
- **THEN** `<html lang="cs">` is set before any Astro-rendered content is visible

#### Scenario: Persisted locale wins over `navigator.language`

- **GIVEN** `_local/locale.locale === 'en'` and `navigator.language === 'cs-CZ'`
- **WHEN** the page first paints
- **THEN** `<html lang="en">` is set

### Requirement: Format helpers dispatch by active locale and remain pure

`src/lib/format/index.ts` MUST export `formatDate`, `formatTime`, `formatDuration`, and `pluralize` whose bodies select the per-locale implementation by reading the active locale from the runtime. Each per-locale implementation MUST live under `src/lib/format/<locale>/` and MUST NOT call `Intl.*`, MUST NOT read `navigator.language`, MUST NOT read system time zone, and MUST produce byte-identical output across browsers and Node test runners for the same `(locale, date, today, ...)` inputs.

#### Scenario: Determinism across runtimes

- **GIVEN** a fixed `(locale, date, today)` triple
- **WHEN** `formatDate` runs in Vitest under Node and in Chrome
- **THEN** the resulting strings are byte-identical

#### Scenario: Dispatcher routes to the right module

- **GIVEN** `getLocale() === 'en'`
- **WHEN** `formatDate(...)` is called
- **THEN** the implementation in `src/lib/format/en/date.ts` produces the result
- **AND** no symbol from `src/lib/format/cs/` is referenced in this code path

### Requirement: Tree-shaking ships only used messages per island

The Paraglide compiler MUST be configured to emit one message function per key. The build MUST be configured (via Vite + Rollup default behavior) so that an island chunk imports only the message functions it references, and the resulting JavaScript bundle for that chunk contains only those functions' translations across all locales.

A Vitest test MUST build a representative island with N message references and assert that its emitted chunk references at most N+ε message function names.

#### Scenario: Island carrying 4 messages does not bundle the 200-message catalog

- **GIVEN** an island that calls exactly 4 `m.<key>()` functions
- **WHEN** `astro build` produces the chunk for that island
- **THEN** the chunk's source contains references to at most 5 distinct `m.*` symbols (slack of one for re-exports)

### Requirement: Service worker pre-caches every locale's compiled output

The PWA pre-cache (`@vite-pwa/astro` `globPatterns`) MUST include all files emitted by the Paraglide compiler under `dist/_astro/paraglide-*` (or equivalent post-build path). Locale switching MUST work fully offline once the SW is installed.

#### Scenario: Offline locale switch

- **GIVEN** an installed PWA in `en` mode with the SW active and the network disconnected
- **WHEN** the user toggles to Czech in the settings menu
- **THEN** every translated message renders in Czech without a network request

### Requirement: Default-locale fallback is computed once and persisted

On first launch (when `_local/locale` is absent), the runtime MUST resolve the initial locale by:
1. Reading `navigator.language`.
2. Stripping the region tag at the first `-`.
3. Selecting that bare code if it appears in `LOCALES`; otherwise selecting `LOCALES[0]`.
4. Persisting the result to `_local/locale` immediately so subsequent boots do not consult `navigator.language`.

#### Scenario: Czech browser, fresh install

- **GIVEN** `navigator.language === 'cs-CZ'` and no `_local/locale` doc
- **WHEN** the runtime initializes
- **THEN** the active locale is `'cs'`
- **AND** a `_local/locale` doc with `locale: 'cs'` has been written

#### Scenario: Unsupported browser locale falls back to default

- **GIVEN** `navigator.language === 'fr-FR'`, `LOCALES = ['en', 'cs']`, and no `_local/locale` doc
- **WHEN** the runtime initializes
- **THEN** the active locale is `'en'`
- **AND** a `_local/locale` doc with `locale: 'en'` has been written

#### Scenario: Persisted locale is durable

- **GIVEN** `_local/locale.locale === 'en'` and `navigator.language === 'cs-CZ'`
- **WHEN** the runtime initializes
- **THEN** the active locale is `'en'`
- **AND** `navigator.language` was never read during initialization

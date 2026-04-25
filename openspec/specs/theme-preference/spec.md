# theme-preference Specification

## Purpose
TBD - created by archiving change prototype-ui-integration. Update Purpose after archive.
## Requirements
### Requirement: Theme preference is stored in `_local/theme`

The user's chosen theme MUST be persisted in a PouchDB document at id `_local/theme` with shape `{ _id: '_local/theme', theme: 'light' | 'dark', updatedAt: number }`. The doc MUST NOT be encrypted (no `payload` field). The `_local/` prefix guarantees it is never replicated to CouchDB (see `local-database`).

#### Scenario: Toggling theme writes the doc

- **GIVEN** an unlocked vault with no `_local/theme` doc
- **WHEN** the user toggles the theme to dark
- **THEN** PouchDB has a `_local/theme` doc with `theme === 'dark'`
- **AND** the doc has no `payload` field

#### Scenario: Theme doc never replicates

- **GIVEN** a `_local/theme` doc exists locally
- **WHEN** a full sync to CouchDB completes
- **THEN** the CouchDB user database does not contain a `_local/theme` document

### Requirement: Theme is applied via `data-theme` on `<html>`

The active theme MUST be expressed as `<html data-theme="dark">` (when dark) or absence of the attribute (when light). All component CSS MUST resolve token values from this single attribute.

#### Scenario: Components react to attribute change

- **GIVEN** a page with `<html>` lacking `data-theme`
- **WHEN** the toggle sets `data-theme="dark"` on `<html>`
- **THEN** every token-consuming element's resolved style updates within the same animation frame

### Requirement: Theme preference survives idle-lock

After idle-lock fires, in-memory state is wiped, but the persisted theme MUST be re-read from PouchDB on the next mount and applied immediately.

#### Scenario: Dark theme persists across idle-lock

- **GIVEN** the user has selected dark theme
- **WHEN** idle-lock fires, the user re-unlocks, and the schedule mounts again
- **THEN** the page is in dark theme on first paint after unlock
- **AND** no flash of light theme is visible for more than one frame

### Requirement: First-load default follows OS preference

When `_local/theme` is absent (first launch on a device), the system MUST initialise the theme from `window.matchMedia('(prefers-color-scheme: dark)')`. The user's first explicit toggle MUST then persist the choice and the OS preference MUST be ignored thereafter.

#### Scenario: OS dark mode is honoured on first load

- **GIVEN** a fresh install on a device set to OS dark mode
- **WHEN** the user opens the app for the first time
- **THEN** the app loads in dark theme
- **AND** no `_local/theme` doc has yet been written

#### Scenario: Explicit user choice overrides OS

- **GIVEN** OS is in dark mode and the user has explicitly selected light theme
- **WHEN** the user re-opens the app on the same device
- **THEN** the app loads in light theme
- **AND** `window.matchMedia` is not consulted

### Requirement: Theme nanostore is single source of truth at runtime

A nanostore (`src/lib/store/theme.ts`) MUST hold the active theme and be the only mechanism React islands use to read it. The store MUST be initialised by reading `_local/theme` synchronously on app boot. Components MUST NOT read `localStorage`, `document.documentElement.dataset.theme`, or `matchMedia` directly.

#### Scenario: Single subscription per island

- **GIVEN** `<ThemeToggle>` and any other theme-aware island
- **WHEN** the theme is toggled
- **THEN** both islands re-render via the nanostore subscription
- **AND** there is no read of `localStorage` or `dataset.theme` in the React tree

### Requirement: Anti-flash bootstrap script

`Layout.astro` MUST include a small synchronous script that, before the body paints, reads `_local/theme` from IndexedDB (or `prefers-color-scheme` if absent) and sets `data-theme` on `<html>`. The script MUST be inlined (no external fetch) and must not exceed 2KB minified.

#### Scenario: No theme flash on cold load

- **GIVEN** a user whose persisted theme is dark
- **WHEN** they reload the app on a cold cache
- **THEN** the first painted frame is in dark theme
- **AND** there is no observable transition from light to dark


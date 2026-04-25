# locale-preference Specification

## Purpose
Persistence and surfacing of the user's chosen locale: a plaintext `_local/locale` PouchDB doc (mirroring `theme-preference`), the Settings → Language row that drives it, default-locale resolution at first install, and the idle-lock survival guarantee. New capability introduced by the i18n-multilocale-support change.

## Requirements
### Requirement: Locale preference is stored in `_local/locale`

The user's chosen locale MUST be persisted in a PouchDB document at id `_local/locale` with shape `{ _id: '_local/locale', locale: Locale, updatedAt: number }`. The doc MUST NOT be encrypted (no `payload` field). The `_local/` prefix guarantees it is never replicated to CouchDB (see `local-database`).

#### Scenario: Switching locale writes the doc

- **GIVEN** an unlocked vault with no `_local/locale` doc
- **WHEN** the user selects Czech from the settings Language row
- **THEN** PouchDB has a `_local/locale` doc with `locale === 'cs'`
- **AND** the doc has no `payload` field
- **AND** `updatedAt` is a finite millisecond timestamp `<= Date.now()`

#### Scenario: Locale doc never replicates

- **GIVEN** a `_local/locale` doc exists locally
- **WHEN** a full sync to CouchDB completes
- **THEN** the CouchDB user database does not contain a `_local/locale` document

### Requirement: Default locale at first install is English unless the host suggests a registered alternative

On first launch with no `_local/locale` doc, the application MUST resolve the initial locale per the rules in `i18n-foundation` (region-stripped `navigator.language` if registered; otherwise `LOCALES[0]`, which is `en`). After this resolution, the chosen locale MUST be persisted to `_local/locale` so future launches do not re-derive from the host.

#### Scenario: English-region browser starts in English

- **GIVEN** `navigator.language === 'en-US'` and no `_local/locale`
- **WHEN** the app boots
- **THEN** the active locale is `en`
- **AND** `_local/locale.locale === 'en'`

#### Scenario: Czech-region browser starts in Czech

- **GIVEN** `navigator.language === 'cs-CZ'` and no `_local/locale`
- **WHEN** the app boots
- **THEN** the active locale is `cs`
- **AND** `_local/locale.locale === 'cs'`

#### Scenario: Unsupported region falls back to English

- **GIVEN** `navigator.language === 'pl-PL'` (Polish, not in `LOCALES`) and no `_local/locale`
- **WHEN** the app boots
- **THEN** the active locale is `en`
- **AND** `_local/locale.locale === 'en'`

### Requirement: Settings menu exposes the Language row

The bottom-sheet settings menu (`MenuSheet` island) MUST render a Language row, positioned above the existing Theme row. The row MUST display the current locale's display name in that locale (e.g. `English`, `Čeština`) and MUST open a sub-sheet or inline option list when activated, listing every registered locale by its self-name.

Selecting a locale MUST call `setLocaleAndPersist(locale)` and close the option list. The visible label of the Language row MUST update to reflect the new selection within the same render cycle.

#### Scenario: Row shows current locale's self-name

- **GIVEN** the active locale is `cs`
- **WHEN** the bottom-sheet menu is opened
- **THEN** the Language row's value text is `Čeština`

#### Scenario: Selecting a locale switches the UI

- **GIVEN** the active locale is `cs` and the Language row's option list is open
- **WHEN** the user taps the `English` option
- **THEN** the Language row's value text becomes `English`
- **AND** every other visible string in the menu (e.g. row labels) is in English
- **AND** `_local/locale.locale === 'en'`

### Requirement: Locale preference survives idle-lock

After idle-lock fires, in-memory state is wiped, but the persisted locale MUST be re-read from PouchDB on the next mount and applied immediately. Static SSR output MUST NOT lock the layout to a specific locale.

#### Scenario: Czech locale persists across idle-lock

- **GIVEN** the user has selected Czech
- **WHEN** idle-lock fires, the user re-unlocks, and the schedule mounts again
- **THEN** the page is in Czech on first paint after unlock
- **AND** no flash of English is visible for more than one frame

### Requirement: Pre-unlock screens are localized

Login, OAuth, vault-create, vault-restore, PIN setup, recovery-secret confirmation, and device-limit screens MUST render in the active locale. The bootstrap reads `_local/locale` before any of these screens mounts (the `_local/...` prefix in PouchDB is accessible without vault unlock since it is plaintext-only).

#### Scenario: Login screen renders in active locale

- **GIVEN** `_local/locale.locale === 'cs'` and the user is signed out
- **WHEN** the login screen mounts on app launch
- **THEN** every visible label, button, and helper text is in Czech

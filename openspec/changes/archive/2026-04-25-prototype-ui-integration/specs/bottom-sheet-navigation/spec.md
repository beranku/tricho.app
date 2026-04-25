## ADDED Requirements

### Requirement: Sheet open/close state lives in a nanostore

The bottom-sheet's open/close state MUST be exposed via a `sheet` nanostore (`src/lib/store/sheet.ts`). Multiple islands MAY subscribe; only one sheet MUST be open at a time.

#### Scenario: Two islands share the same state

- **GIVEN** `<MenuButton>` and `<BottomSheet>` are independently hydrated
- **WHEN** `<MenuButton>` calls `setSheetOpen('menu')`
- **THEN** `<BottomSheet>` receives the new state via its store subscription
- **AND** the sheet renders its `menu` content

### Requirement: Backdrop tap closes the sheet

When the backdrop element is tapped, the sheet MUST close. The backdrop MUST have z-index `20` (below the sheet's `21`) and a `var(--backdrop)` background.

#### Scenario: Backdrop dismissal

- **GIVEN** the sheet is open
- **WHEN** the user taps the backdrop
- **THEN** the sheet closes
- **AND** focus returns to the trigger element that opened it

### Requirement: ESC key closes the sheet

When the sheet is open and the document receives `keydown` for `Escape`, the sheet MUST close. The handler MUST be attached only while the sheet is open and removed on close to avoid leaks.

#### Scenario: ESC dismissal

- **GIVEN** the sheet is open
- **WHEN** the user presses Escape
- **THEN** the sheet closes within one frame
- **AND** the sheet's keydown listener is removed from the document

### Requirement: Focus trap and inert background

While the sheet is open, focus MUST be trapped inside the sheet element. The non-sheet content MUST be marked `inert` so screen readers and tab navigation skip it. On close, focus MUST return to the element that triggered open.

#### Scenario: Tab cycles within sheet only

- **GIVEN** the sheet is open with three focusable rows
- **WHEN** the user tabs three times from the last row
- **THEN** focus cycles back to the first row inside the sheet
- **AND** focus never lands on the chrome buttons or schedule slots underneath

### Requirement: Body-scroll lock while open

While the sheet is open, the underlying scroll container (`.phone-scroll`) MUST NOT scroll in response to wheel, touchmove, or keyboard events. The lock MUST be released on close, and the previous scroll position preserved.

#### Scenario: Scroll position preserved across open/close

- **GIVEN** the user has scrolled the schedule to a non-zero offset
- **WHEN** the user opens and then closes the sheet
- **THEN** the schedule's scroll offset is unchanged

### Requirement: Sheet content rows for navigation

The default sheet (`type: 'menu'`) MUST contain rows for: Klienti, Statistika, Archiv, Nastavení, Synchronizace status, Téma toggle, Odhlásit. Rows that lead to deferred features MUST render but show `Připravujeme` as the secondary text.

#### Scenario: Menu rows are present

- **GIVEN** the menu sheet is open
- **WHEN** the rows are listed
- **THEN** the seven specified labels appear in that order
- **AND** the deferred rows show `Připravujeme`

### Requirement: Sync status row reflects live-sync state

The sync-status row MUST subscribe to `subscribeSyncEvents` (from `src/sync/couch.ts`) and display:
- `idle` → `Připraveno`
- `connecting` → `Připojuji…`
- `syncing` → `Synchronizuji…`
- `paused` → `Synchronizováno · před X` (X = time since last paused event, Czech-formatted)
- `error` → red dot + `Chyba synchronizace` + tap-to-retry

#### Scenario: State changes update the row in-place

- **GIVEN** the sheet is open and sync is `paused`
- **WHEN** the network drops and sync transitions to `error`
- **THEN** within one event loop the row text becomes `Chyba synchronizace`
- **AND** the dot colour switches to a red token

### Requirement: Sheet animation timing

The sheet MUST open and close with `transform: translateY(...)` over `0.32s` using the design-system easing curve. Background backdrop opacity MUST animate over the same duration.

#### Scenario: Open is animated

- **GIVEN** the sheet is closed
- **WHEN** `setSheetOpen('menu')` is dispatched
- **THEN** the sheet element's `transition-duration` is `0.32s`
- **AND** the backdrop fades in over the same duration

# daily-schedule Specification

## Purpose
TBD - created by archiving change prototype-ui-integration. Update Purpose after archive.
## Requirements
### Requirement: Phone-A renders a chronological list of day sections

The daily-schedule view MUST render `<section data-day="YYYY-MM-DD">` blocks ordered ascending by date, covering at minimum the window `[today − 1 day, today + 5 days]`. The section for the current day MUST carry `data-today="true"` and use `<DayHeaderToday>`; all other sections MUST use `<DayDivider>`.

#### Scenario: Window covers seven days

- **GIVEN** the user's local date is `2026-04-25`
- **WHEN** the schedule renders on cold load
- **THEN** day-section elements exist for `2026-04-24` through `2026-04-30`
- **AND** exactly one of those carries `data-today="true"`

### Requirement: Today's section is initially scrolled into view

On mount, the schedule MUST scroll the today-section's sticky header to the top of the viewport without animation. The scroll MUST happen before the user can perceive a flash at scroll position 0.

#### Scenario: Today is at the top after mount

- **GIVEN** the schedule has rendered for the first time in the session
- **WHEN** the user observes the viewport
- **THEN** the `data-today` section's sticky header is within `0..50px` of the top
- **AND** no smooth-scroll animation has played

### Requirement: Sticky chrome buttons remain visible across all sections

The chrome buttons (`menu`, `ellipsis`) MUST remain visible regardless of which day section is currently scrolled to the top. Their layer MUST be rendered above the sticky day headers (z-index 16+).

#### Scenario: Menu remains tappable while scrolled into the past

- **GIVEN** the user has scrolled the schedule to a past day
- **WHEN** the user taps the menu button
- **THEN** the bottom sheet opens
- **AND** the schedule did not scroll back to today

### Requirement: Slot variants reflect appointment status

Each slot MUST render exactly one of:
- `<SlotDone>` — appointment with `status: "done"`; opacity 0.55, copper-mid check mark.
- `<SlotActive>` — appointment with `status: "active"`; teal-tint background, teal-strong text.
- `<Slot>` (default scheduled) — appointment with `status: "scheduled"`.
- `<SlotFree>` — synthesised free slot for a gap ≥15 minutes within business hours; Patrick-Hand "volno X" label and copper `+` glyph.

#### Scenario: Active slot is highlighted

- **GIVEN** an appointment with `startAt ≤ now < endAt` and `status: "active"`
- **WHEN** the slot is rendered
- **THEN** the slot element has the `slot-active` class
- **AND** its background resolves to `var(--teal-tint)`
- **AND** its name text resolves to `var(--teal-strong)`

#### Scenario: Free slot is synthesised, not stored

- **GIVEN** a 35-minute gap between two scheduled appointments at `09:30` and `10:05`
- **WHEN** the schedule renders
- **THEN** a free slot appears with time `09:30` and label `volno 35 min`
- **AND** no `appointment` document was written to PouchDB to represent it

### Requirement: Scroll-to-today secondary FAB

A `<FabSecondary>` element MUST appear in the bottom-left of the phone frame when the today-section is fully scrolled out of the viewport. The arrow direction MUST indicate the side on which today lives (down arrow if scrolled into the past; up arrow if scrolled into the future). Tapping MUST scroll today's sticky header back to the top.

#### Scenario: FAB appears when scrolling into past

- **GIVEN** the schedule rendered with today centered
- **WHEN** the user scrolls upward past yesterday's last slot
- **THEN** the secondary FAB becomes visible within 100ms
- **AND** the arrow points downward

#### Scenario: FAB hidden when today is in view

- **GIVEN** today's section's sticky header is intersecting the viewport
- **WHEN** the user observes the FAB element
- **THEN** the FAB has `pointer-events: none` and zero opacity

### Requirement: Primary FAB triggers add-appointment flow

A `<Fab>` button (calendar-plus icon, teal gradient) MUST be rendered absolutely-positioned in the bottom-right of the phone frame. Tapping MUST open the add-appointment flow. While the deferred edit flow is not yet shipped, tapping MUST open a placeholder bottom-sheet that says `Plánování v příští verzi`.

#### Scenario: FAB opens placeholder

- **GIVEN** the schedule view
- **WHEN** the user taps the primary FAB
- **THEN** a bottom sheet is opened
- **AND** the sheet contains the text `Plánování v příští verzi`

### Requirement: Free-slot tap opens add-appointment flow at that time

Tapping a `<SlotFree>` MUST open the add-appointment flow with the start time pre-filled to the slot's start. While that flow is deferred, the same placeholder bottom-sheet MUST open with the time visible.

#### Scenario: Pre-fill from free slot

- **GIVEN** a `<SlotFree>` rendered for `11:00`
- **WHEN** the user taps it
- **THEN** the placeholder sheet opens
- **AND** the sheet shows the start time `11:00`

### Requirement: Schedule clears on idle-lock

When `IdleLock.onLock` fires, the schedule view MUST unmount and surrender any appointment data held in component state. The next view MUST be the unlock screen.

#### Scenario: Idle-lock returns user to login

- **GIVEN** the schedule view is mounted with appointments visible
- **WHEN** the idle-lock timer expires
- **THEN** the schedule unmounts
- **AND** the login screen is rendered
- **AND** no appointment plaintext remains in any React component state


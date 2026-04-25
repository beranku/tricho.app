## ADDED Requirements

### Requirement: Every prototype-UI island has a component test

Each React island under `src/components/islands/` MUST have a colocated `.component.test.tsx` covering:
- the happy path (render + primary interaction emits the expected store/DOM change)
- at least one failure or edge scenario named in the matching capability spec (`daily-schedule`, `client-detail`, `bottom-sheet-navigation`, `theme-preference`, `appointment-data`).

A new island MAY NOT merge without its component test.

#### Scenario: New island gets a test in the same PR

- GIVEN a PR adding `src/components/islands/Foo.tsx`
- WHEN CI runs `test:component`
- THEN `src/components/islands/Foo.component.test.tsx` exists and runs
- AND it asserts at least one rendered output and one interaction

### Requirement: Format helpers covered at unit tier

Czech formatting helpers (`src/lib/format/*.ts`) MUST be exercised at the unit tier with deterministic, host-locale-independent assertions. The suite MUST include explicit ablation that the helpers do not depend on `Intl.*` (i.e., they work with `Intl` removed).

#### Scenario: Intl-ablation suite passes

- GIVEN `globalThis.Intl` is replaced with `undefined`
- WHEN `formatDate`, `formatTime`, `formatDuration`, `pluralize` run with the same inputs as the normal-Intl path
- THEN every output is byte-identical
- AND the test fails loudly if any helper accidentally adopts `Intl.*` later

### Requirement: Appointment + theme docs round-trip through encryption

Backend-tier (Vitest, fake-indexeddb harness) MUST round-trip an `appointment` document through `putEncrypted` / `getDecrypted` and assert:
- the wire shape matches the `local-database` invariant (`{_id, _rev, type, updatedAt, deleted, payload}` only)
- the `[type, startAt]` index plan is selected for time-window queries
- a splice attack (rewrite payload to a different doc's ciphertext) yields a decryption failure
- soft-delete excludes the doc from queries

The `_local/theme` doc MUST be exercised in a separate test asserting it is plaintext (no `payload` field) and is never replicated when the sync layer flushes (the harness verifies by inspecting the dbs `_changes` feed).

#### Scenario: Wire shape contains no plaintext appointment fields

- GIVEN an `appointment` written via `putEncrypted`
- WHEN the raw row is fetched directly from PouchDB
- THEN `customerId`, `startAt`, `serviceLabel` do NOT appear at the top level
- AND `payload` is the only data-bearing field

### Requirement: E2E covers the prototype-UI golden path

Playwright MUST exercise the post-unlock prototype surface end-to-end against a real built bundle:
- launch the app, observe it lands at `index.html` with the chrome buttons rendered
- open the bottom sheet, toggle theme to dark, close the sheet
- assert `<html data-theme="dark">` is set
- navigate via hash (`#/clients/<id>`) and observe ClientDetail mounts
- return to schedule via the back button

The full E2E suite stays inside the existing 30s/test budget.

#### Scenario: Theme toggle persists across reload

- GIVEN a fresh PWA build served via `astro preview`
- WHEN the user toggles to dark theme and reloads
- THEN the page paints in dark theme on the first frame after reload
- AND no light-theme paint is observable

### Requirement: Hex-literal lint guards the design system at unit tier

A unit-tier test under `src/components/astro/__tests__/` MUST scan every `.astro` file for raw hex literals and fail on any match outside an explicit allowlist (token files, intentional iOS-island chrome). The lint MUST be wired into `npm run test:unit` so it runs on every PR.

#### Scenario: Adding a hex to a component fails CI

- GIVEN a PR that adds `style="color: #ff0000"` to `src/components/astro/Slot.astro`
- WHEN CI runs `test:unit`
- THEN the hex-lint test fails citing the file
- AND the PR cannot be merged

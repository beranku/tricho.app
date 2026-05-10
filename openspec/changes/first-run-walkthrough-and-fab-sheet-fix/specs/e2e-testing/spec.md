## ADDED Requirements

### Requirement: First-run walkthrough covers every shipped feature

The Playwright suite under `tests/e2e/` MUST include a **first-run walkthrough** — a set of specs that exercise every user-facing feature shipped in the PWA from the perspective of a brand-new user (fresh `sub`, empty vault, zero clients, zero appointments). The walkthrough MUST include:

- A spec that walks the welcome wizard (Step 1 install → Step 2 mock OIDC → Step 3 encryption: RS + WebAuthn) and asserts the unlocked diár is reached.
- A spec that opens the diár with an empty vault, taps the primary FAB and at least one synthesized free slot, and asserts the placeholder bottom-sheet copy mandated by `daily-schedule` (the literal string `Plánování v příští verzi` plus the deferred-feature body in Czech). The placeholder body string MUST be derived from a dedicated Paraglide message id, not from the unrelated promo body that was misused in commit `ff9e306`.
- A spec that exercises diár navigation (7-day window, day arrows / swipe, "dnes" sun glyph rendered, copper kickeries on day headers).
- A spec that opens a seeded client's karta (anamnéza, photo gallery, visit history, camera card present), and confirms back-nav to the diár preserves state.
- A spec that walks every Settings section (sync, encryption with PIN setup and RS rotate entry points, backup export, devices, plan, account, about) and asserts each section is reachable.
- A spec that walks the plan picker (Free / Pro / Max tiers rendered, Stripe (mock) checkout reachable, bank-transfer instructions reachable, brand phrases verbatim, Free shows "zdarma napořád").
- One thin **composite** spec that strings the walk end-to-end (welcome → diár → FAB → karta → settings) primarily for a `gif_creator` capture and end-to-end smoke; per-feature assertions stay in the per-feature specs.

Each walkthrough spec SHALL use the existing `openVaultAsTestUser` fixture so each invocation operates on a fresh `sub` and an empty vault. Each spec SHALL pass without modification under both the `ci` profile (`https://tricho.test`) and the `dev-mock` profile (`http://tricho.localhost/app/`) by honoring `E2E_BASE_URL` from `playwright.config.ts`.

#### Scenario: Empty-state diár tap reveals deferred-feature placeholder

- **GIVEN** a brand-new user signed in via mock OIDC, with an empty vault and zero appointments
- **WHEN** the user taps the primary FAB on the diár
- **THEN** a bottom sheet opens
- **AND** the sheet's title is exactly `Plánování v příští verzi`
- **AND** the sheet's body matches the dedicated `schedule_deferred_body` Paraglide message (Czech, explaining the deferred feature) — and is **not** the value of `menu_promo_body`
- **AND** there is no path forward from the sheet other than closing it (the visit-creation form remains deferred per `daily-schedule`)

#### Scenario: Free-slot tap shows the same placeholder with a time

- **GIVEN** a `<SlotFree>` rendered for any time `HH:MM`
- **WHEN** the user taps it
- **THEN** the deferred-feature placeholder sheet opens
- **AND** the sheet shows the start time `HH:MM`
- **AND** the title and body are the spec-aligned strings (same as the FAB scenario)

#### Scenario: Walkthrough covers settings sections

- **GIVEN** a brand-new user with the diár open
- **WHEN** the user opens Settings via the menu
- **THEN** the user can reach each of: sync, encryption (PIN setup, RS rotate entry), backup export, devices, plan, account, about
- **AND** the back-nav from each section returns to Settings without errors
- **AND** no console errors are recorded during the walk

#### Scenario: Walkthrough covers the plan picker

- **GIVEN** a brand-new user with Settings open
- **WHEN** the user opens Plan
- **THEN** all three tier cards (Free, Pro, Max) are rendered with their canonical brand phrases
- **AND** the Free card shows `zdarma napořád`
- **AND** opening Stripe (mock) checkout from any paid tier reaches the mock checkout page
- **AND** opening bank-transfer instructions from any paid tier reaches `BankTransferInstructions`

#### Scenario: Walkthrough composite captures the journey

- **GIVEN** a brand-new user
- **WHEN** the composite spec runs end-to-end (welcome → diár → FAB → karta → settings)
- **THEN** the walk completes within the e2e per-spec runtime budget (< 90 s for the composite specifically, granted the longer journey)
- **AND** the composite makes only smoke-level assertions (per-feature assertions stay in the per-feature specs)

#### Scenario: Walkthrough specs run unchanged against dev-mock

- **GIVEN** a developer with `make dev-mock` running locally and `tricho.localhost` resolving to 127.0.0.1
- **WHEN** they run `make e2e-walkthrough` (which sets `E2E_BASE_URL=http://tricho.localhost`)
- **THEN** every walkthrough spec passes against the dev-mock stack
- **AND** the same specs without modification pass under `make e2e` against the `ci` stack at `https://tricho.test`

### Requirement: Walkthrough placeholder copy is grep-locked to the spec

The walkthrough specs SHALL assert the placeholder bottom-sheet title and body **as exact strings** (not as i18n keys). This locks the regression that occurred when commit `ff9e306` pointed `FabAddSheet` at the unrelated `menu_promo_body` message. If a future change legitimately reword the placeholder, the change MUST land alongside an update to both `daily-schedule` and the walkthrough specs.

#### Scenario: Reverting the regression fails the walkthrough

- **GIVEN** a hypothetical PR that re-introduces `m.menu_promo_body()` as the FabAddSheet body
- **WHEN** `make e2e-walkthrough` (or the equivalent CI run) executes the `diar-empty-state` spec
- **THEN** the spec fails with an explicit assertion error showing the actual body vs. the spec-aligned `schedule_deferred_body`
- **AND** the failure references `daily-schedule` so the reviewer knows the spec is the source of truth

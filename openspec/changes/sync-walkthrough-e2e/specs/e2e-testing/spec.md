# e2e-testing — sync walkthrough additions

## ADDED Requirements

### Requirement: Device pairing first-run walk

The e2e suite SHALL include a `device-pair-walk` spec that drives Device A through the new-vault flow and Device B through the existing-vault flow with the same Recovery Secret, then asserts that both contexts reach the unlocked shell, share the same `vaultId`, and observe at least one `paused` sync event.

#### Scenario: Two devices reach the unlocked shell with matching vaultId
- **GIVEN** a fresh browser session and a fresh `sub`
- **WHEN** Device A completes `createVaultWithRs` and Device B completes `joinVaultWithRs` with A's RS
- **THEN** `__trichoE2E.vaultId` is non-empty on both contexts and equal across both
- **AND** `subscribeSyncEvents` on each device fires at least one event with `status === 'paused'` within 30 s

### Requirement: Real-time edit propagation across paired devices

The e2e suite SHALL include a `cross-device-realtime-walk` spec that proves a customer write on Device A becomes visible on Device B and a subsequent edit on Device B becomes visible on Device A — i.e. two-way propagation in a single test.

#### Scenario: A writes → B reads → B edits → A reads the edit
- **GIVEN** the Device-A / Device-B setup from `device-pair-walk`
- **WHEN** Device A calls `__trichoE2E.putCustomer({ firstName: 'Anna', ... })`
- **THEN** Device B observes the doc within 30 s and `getCustomer(id)` returns the same firstName
- **WHEN** Device B calls `__trichoE2E.editCustomer(id, { phone: '+420 600 100 200' })`
- **THEN** Device A observes the edit within 30 s and `getCustomer(id)` returns the new phone

### Requirement: Cancel-then-gated end-to-end walk

The e2e suite SHALL include a `cancel-then-gated-walk` spec that drives the cancel UI, then re-stubs the subscription as expired-past-grace, and asserts that the unlocked shell surfaces `GatedSheet` (not silent failure) with both "Pokračovat offline" and "Obnovit nyní" CTAs.

#### Scenario: Cancel CTA → expiry → GatedSheet
- **GIVEN** a stubbed active-Stripe subscription on PlanScreen
- **WHEN** the user taps `plan-cancel-cta`
- **THEN** `POST /auth/subscription/cancel` is observed
- **WHEN** the test re-stubs `GET /auth/subscription` with an `expiredSubscription()` payload and forces `__trichoE2E.setGated(true)` to mirror the 402-driven gate
- **THEN** the unlocked shell renders `data-testid="gated-sheet"` within 10 s with both `gated-sheet-renew` and `gated-sheet-dismiss` actions present

### Requirement: Local ZIP → fresh-device restore walk

The e2e suite SHALL include a `local-zip-restore-walk` spec that exports a backup ZIP from Device A, hands those bytes to a fresh Device B with no prior vault state, drives the wizard's restore-zip flow, and asserts that the original customer is readable on B.

#### Scenario: ZIP from A round-trips into B's vault
- **GIVEN** Device A with a customer doc whose plaintext name is unique
- **WHEN** Device A produces a ZIP via `generateLocalBackupZip` (in-page)
- **AND** Device B is opened on a fresh context with no server `vault-state`
- **AND** Device B drives the wizard's `flow="restore-zip"` Step 3 sub-flow with A's ZIP and A's RS
- **THEN** Device B's `__trichoE2E.getCustomer(id)` returns the original payload
- **AND** the data on B was not loaded via sync (vault-state arrived from the ZIP, not the server)

### Requirement: Cloud backup → fresh-device init walk

The e2e suite SHALL include a `cloud-backup-init-walk` spec that lists `/auth/backup/months`, downloads a month, and asserts the same RestoreFromZip surface accepts those bytes. The spec MAY stub the auth endpoints when the backend cron is non-deterministic; the success criterion is the wiring (request URLs, content-type, restore-success status), not the cron itself.

#### Scenario: Stubbed cloud-backup download → restore-zip success
- **GIVEN** a paid user on a fresh device with stubbed `GET /auth/backup/months` returning a single month and `GET /auth/backup/months/:m` returning a known ZIP
- **WHEN** the user navigates to the cloud-backup list and taps download
- **THEN** the download request URL contains `/auth/backup/months/<m>`
- **AND** the restore surface produces a success status with `applied >= 1`

### Requirement: Walk-spec helpers live under fixtures/

The e2e suite SHALL expose `app/tests/e2e/fixtures/sync-flows.ts` with at minimum: `writeCustomerOn`, `editCustomerOn`, `readCustomerOn`, `waitForCustomerOn(predicate)`, and `freshContext`. New walkthrough specs MUST import from this helper module rather than duplicating bridge-evaluate boilerplate, so the bridge contract is centralised and reviewable in one file.

#### Scenario: A new walk spec composes from existing helpers
- **GIVEN** a new walk spec file under `app/tests/e2e/`
- **WHEN** the spec needs to write/read/edit a customer or wait for sync
- **THEN** the spec MUST import the helper from `./fixtures/sync-flows` and not call `__trichoE2E` directly

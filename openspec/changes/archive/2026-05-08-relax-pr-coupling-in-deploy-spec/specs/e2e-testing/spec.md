## MODIFIED Requirements

### Requirement: CI workflow produces actionable artifacts on failure

The CI workflow (`.github/workflows/ci.yml`) MUST execute the e2e suite on every push to `dev`, every push to `main`, and every pull request. On failure, it MUST upload Playwright traces, screenshots, video (if enabled), and the `docker compose logs` of every service as artifacts. The diagnostics MUST be attached to the failing run regardless of the trigger event (push or PR).

#### Scenario: Failing CI run keeps diagnostics

- **GIVEN** a CI run (triggered by a push to `dev`, a push to `main`, or a pull request) whose change breaks the OAuth callback
- **WHEN** the e2e job fails
- **THEN** the workflow uploads `playwright-report/`, `test-results/` and `docker-logs/` as artifacts
- **AND** the run summary links to those artifacts so the developer can open them without re-running locally

### Requirement: E2E boot is hermetic and reproducible

Each `make e2e` run MUST start from a clean CouchDB data volume and a clean `tricho-auth` meta database. The workflow MUST either recreate the named volumes or use `docker compose --project-name <unique>` so parallel runs do not collide.

#### Scenario: Two parallel CI runs do not corrupt each other

- **GIVEN** two CI runs triggering the e2e job concurrently on the same runner pool (any combination of pushes to `dev`, pushes to `main`, and pull requests)
- **WHEN** both runs reach the test phase
- **THEN** neither observes documents created by the other
- **AND** each run tears down its own stack in the `always()` post-step

### Requirement: Two-browser-context harness is the convention for cross-device specs

Cross-device E2E specs MUST use two `BrowserContext`s within a single Playwright test (rather than two `test()` blocks coordinating via a shared volume) and MUST pass the same `sub` to both while letting cookies diverge so each context registers as a distinct device. The harness MUST live under `tests/e2e/fixtures/cross-device.ts` and be the single import surface every cross-device spec uses; no spec MAY hand-roll the two-context dance inline.

#### Scenario: New cross-device spec uses the harness in one line

- **GIVEN** a developer adding a new cross-device test
- **WHEN** they import `openTwoDevices` from `tests/e2e/fixtures/cross-device.ts`
- **THEN** they receive `{ deviceA, deviceB }` already signed in to the same vault
- **AND** they do not reproduce the OAuth + unlock dance inline

#### Scenario: Spec that reaches around the harness is detectable

- **GIVEN** a commit on `dev` (or a PR) adding a `tests/e2e/*.spec.ts` that calls `browser.newContext()` directly with cross-device intent
- **WHEN** `grep "browser.newContext()" tests/e2e` is run on the change
- **THEN** the only matches are inside `tests/e2e/fixtures/cross-device.ts`

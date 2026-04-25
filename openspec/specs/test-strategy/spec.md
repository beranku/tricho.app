# test-strategy Specification

## Purpose

The authoritative testing contract for TrichoApp: the pyramid tiers, speed budgets, coverage thresholds, tagging rules, CI layering, and the decision tree for "which tier does this test belong to". Defines the rules every test file in the repo MUST follow so that the suite stays fast, layered, and meaningful as the codebase grows.

Source files: `docs/TESTING.md`, `vitest.config.unit.ts`, `vitest.config.component.ts`, `vitest.config.backend.ts`, `vitest.config.integration.ts`, `package.json` test scripts, `Makefile` test targets, `.github/workflows/tests.yml`, `src/test/fixtures/`.
## Requirements
### Requirement: Six-tier test pyramid
The test suite MUST be organised as six tiers, each with a distinct purpose, runtime budget, and invocation command. A test's tier is declared by its filename suffix and its placement on disk:

| Tier | Suffix | Runtime budget (median per test) | Invocation |
|---|---|---|---|
| Pure unit | `.test.ts` under `src/` | < 10 ms | `npm run test:unit` |
| Component (React) | `.component.test.tsx` under `src/components/` | < 50 ms | `npm run test:component` |
| Backend unit (Node) | `.test.mjs` under `infrastructure/*/test/` | < 20 ms | `npm run test:backend` |
| Backend integration (CouchDB container) | `.integration.test.mjs` under `infrastructure/*/test/` | < 2 s | `npm run test:backend:integration` |
| End-to-end (Playwright) | `*.spec.ts` under `tests/e2e/` | < 30 s | `npm run test:e2e` |
| Smoke / infra (shell) | `scripts/smoke/*.sh` | < 1 s | `make test-smoke` |

A test SHALL NOT live in a tier whose budget it cannot meet. A file that bloats past its tier's budget MUST be split or relocated before merging.

#### Scenario: Tier membership is grep-detectable
- GIVEN any test file in the repository
- WHEN its path is inspected
- THEN exactly one tier claims it by convention
- AND `npm run test:<tier>` runs precisely that tier and no other

### Requirement: `npm test` is the fast developer loop
The default `npm test` (no arguments) MUST run unit + component tiers only, complete in under 15 seconds on a warm cache, and require no Docker daemon, no network, and no `SOPS_AGE_KEY`. Anything that breaks these properties MUST move to a slower-tier script.

#### Scenario: Fresh clone developer loop
- GIVEN a contributor who has run `npm ci` once
- WHEN they run `npm test`
- THEN the command exits green within 15 s
- AND no network calls and no container starts have occurred

#### Scenario: `npm test` without docker still passes
- GIVEN a laptop with Docker Desktop / Colima stopped
- WHEN the contributor runs `npm test`
- THEN the command exits 0 without error or warning about Docker

### Requirement: Per-tier coverage thresholds
Each tier MUST meet a coverage floor enforced by `@vitest/coverage-v8`:

| Tier | Lines | Branches | Functions |
|---|---|---|---|
| Pure unit | ≥ 90 % | ≥ 85 % | ≥ 90 % |
| Component | ≥ 70 % | ≥ 60 % | ≥ 70 % |
| Backend unit | ≥ 85 % | ≥ 80 % | ≥ 85 % |
| Backend integration | — (exempt — measured via call-site contracts, not lines) | — | — |

Coverage SHALL be enforced in CI. A PR that reduces any covered metric by more than 0.5 percentage points MUST either restore it or carry an explicit reviewer-acknowledged exception comment referencing `docs/TESTING.md`.

#### Scenario: Coverage drop fails CI
- GIVEN a PR that deletes tests for `src/crypto/envelope.ts` without touching the source
- WHEN CI's `test:unit` job runs with `--coverage`
- THEN the job exits non-zero citing the lines threshold
- AND the PR cannot be merged on required-status-check

### Requirement: Test files live next to the code they test
Unit + component tests MUST be colocated with their implementation (`foo.ts` → `foo.test.ts` alongside). Backend tests MUST live under the service's `test/` subdirectory (`infrastructure/couchdb/tricho-auth/test/`). E2E specs MUST live under `tests/e2e/`. No other placement is permitted.

#### Scenario: Reviewer finds the test without searching
- GIVEN a PR modifying `src/auth/oauth.ts`
- WHEN the reviewer opens the diff
- THEN `src/auth/oauth.test.ts` appears next to it in the same directory in the diff view
- AND the reviewer does not need to search for the coverage elsewhere

### Requirement: CI runs tiers in parallel jobs
The CI workflow MUST execute unit, component, backend, backend-integration, e2e, and smoke tiers as independent GitHub Actions jobs that can succeed or fail independently. Total wall-clock for a full green run MUST stay under 5 minutes.

#### Scenario: One slow tier doesn't block feedback
- GIVEN a PR that breaks the e2e tier only
- WHEN CI runs
- THEN unit, component, backend, and smoke jobs all report green within 2 min
- AND the contributor sees the e2e failure distinctly, not mixed with other output

### Requirement: Shared fixtures prevent duplication
A central fixture directory (`src/test/fixtures/` for frontend, `infrastructure/couchdb/tricho-auth/test/fixtures/` for backend, `tests/e2e/fixtures/` for Playwright) MUST hold all reusable test setup: sample vault IDs, canned DEKs, stub OAuth results, a factory for opening an unlocked vault, etc. No test file SHALL duplicate fixture construction that already exists in the shared directory.

#### Scenario: A new recovery test reuses existing fixtures
- GIVEN a contributor writing a new test for `src/auth/recovery.ts`
- WHEN they import the `makeVaultFixture()` helper from `src/test/fixtures/vault.ts`
- THEN they get a fully initialised keystore + dek + vault-id in one call
- AND they do not repeat the ~20 lines of boilerplate the existing tests already contain

### Requirement: Decision-tree documentation
`docs/TESTING.md` MUST include a "which tier does my test belong to?" decision tree that answers:
1. Does it touch browser APIs or React? → component or e2e.
2. Does it need a real database, container, or network? → integration or e2e.
3. Is it pure logic? → unit.
4. Is it a full user flow across pages? → e2e.
5. Is it a prerequisite check for the stack itself? → smoke.

Each branch MUST point at a concrete example file in the repo.

#### Scenario: New contributor onboarding
- GIVEN a contributor who has never written a test in this repo
- WHEN they open `docs/TESTING.md`
- THEN within 2 minutes they can identify where their new test belongs
- AND they can point at an in-repo example that matches their use case

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


## ADDED Requirements

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

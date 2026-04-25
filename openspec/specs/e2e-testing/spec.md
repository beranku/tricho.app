# e2e-testing Specification

## Purpose

The contract for the containerized end-to-end test suite that exercises the whole TrichoApp stack — PWA, `tricho-auth`, CouchDB, Traefik — through the same edge a real browser would use. Runs locally via `make e2e`, in CI via a dedicated GitHub Actions workflow, and uses a mock OIDC provider in the `ci` Compose profile so the OAuth → device-registration → JWT-issue → CouchDB-sync path is fully covered without real third-party providers.

Source files: `tests/e2e/`, `playwright.config.ts`, `infrastructure/mock-oidc/`, `infrastructure/traefik/ci-certs/`, `.github/workflows/tests.yml`.

## Requirements

### Requirement: Playwright suite runs against the unified stack
The repository MUST ship a Playwright test suite under `tests/e2e/` that boots via `make e2e` and executes against `https://tricho.test/` (the Traefik edge of the `ci` profile). The suite MUST NOT bypass Traefik or talk to backend container ports directly — every assertion must traverse the same edge the browser would.

#### Scenario: Smoke suite completes on a fresh checkout
- GIVEN a cloned repository with `SOPS_AGE_KEY` available
- WHEN `make e2e` runs to completion
- THEN `docker compose --profile ci up -d` is invoked
- AND the stack reaches `healthy` within 120 seconds
- AND Playwright exits 0 with the smoke tag
- AND all test traffic is observed in Traefik's access log (proving edge traversal)

### Requirement: Full OAuth → sync path is covered
The suite MUST include at least one test that (a) navigates to `/auth/google/start`, (b) completes the OAuth round-trip against the mock OIDC container, (c) lands on the PWA with `sessionStorage['tricho-oauth-result']` populated, (d) unlocks a fresh vault, (e) writes an encrypted document via PouchDB, and (f) verifies the ciphertext appears in CouchDB via a read through `/userdb-<hex>/`.

#### Scenario: End-to-end happy path
- GIVEN a clean `ci` profile boot
- WHEN the `oauth-sync-roundtrip` test runs
- THEN the test navigates through OAuth, device registration, vault creation, and replication
- AND the CouchDB response body for the created doc contains an `envelope-crypto` shape (no plaintext `data` key at the top level)
- AND the test completes within 60 seconds

### Requirement: Mock OIDC provider is CI-only
The `mock-oidc` container MUST run only under the `ci` profile. It MUST issue RS256-signed `id_tokens` whose `sub` and `email_verified` claims the test can influence via a small control endpoint (e.g., `POST /mock/identity` to select the next identity). The mock MUST NOT be reachable from the `dev` or `prod` profiles.

#### Scenario: Scripted identity selection
- GIVEN `ci` profile up
- WHEN the test POSTs `{"sub":"g-test-1","email":"e2e@example.com","email_verified":true}` to `/mock/identity`
- AND then navigates `/auth/google/start`
- THEN the OAuth callback resolves with `couchdbUsername` deterministically derived from that subject
- AND subsequent tests using the same subject hit the same user row in `tricho-auth`'s meta database

#### Scenario: Mock absent in dev config
- GIVEN `docker compose --profile dev config`
- WHEN the service list is inspected
- THEN `mock-oidc` does not appear

### Requirement: CI workflow produces actionable artifacts on failure
A GitHub Actions workflow (`.github/workflows/e2e.yml`) MUST execute the suite on every pull request and on pushes to `main`. On failure, it MUST upload Playwright traces, screenshots, video (if enabled), and the `docker compose logs` of every service as artifacts.

#### Scenario: Failing test keeps diagnostics
- GIVEN a PR whose change breaks the OAuth callback
- WHEN the `e2e` job fails
- THEN the workflow uploads `playwright-report/`, `test-results/` and `docker-logs/` as artifacts
- AND the PR's status check links to those artifacts

### Requirement: Self-signed TLS is trusted by the test browser
The `ci` profile MUST present a TLS certificate for `tricho.test` that Playwright trusts (either via `ignoreHTTPSErrors: true`, a pre-loaded root CA in the test browser context, or a `mkcert`-style injected root). Production ACME behavior MUST NOT be exercised in CI.

#### Scenario: Browser context trusts the cert
- GIVEN `ci` profile running with a self-signed cert
- WHEN Playwright's `browser.newContext()` is created per the project config
- THEN navigating `https://tricho.test/` returns 200
- AND no certificate error is logged by the test runner

### Requirement: E2E boot is hermetic and reproducible
Each `make e2e` run MUST start from a clean CouchDB data volume and a clean `tricho-auth` meta database. The workflow MUST either recreate the named volumes or use `docker compose --project-name <unique>` so parallel runs do not collide.

#### Scenario: Two parallel CI jobs do not corrupt each other
- GIVEN two pull requests triggering `e2e.yml` concurrently on the same runner pool
- WHEN both jobs reach the test phase
- THEN neither observes documents created by the other
- AND each job tears down its own stack in the `always()` post-step

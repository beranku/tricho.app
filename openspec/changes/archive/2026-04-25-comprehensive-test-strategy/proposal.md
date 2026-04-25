## Why

TrichoApp's test suite is lopsided. The crypto + keystore layers are deeply exercised (~286 unit tests, 2.5 s runtime), but whole tiers of the stack have no coverage at all:

- **Zero component tests** for ~2,300 lines of React (`AppShell`, `LoginScreen`, `OAuthScreen`, `CustomerCRM`, `PinSetupScreen`, `RSConfirmation`, `PhotoCapture`, `SyncStatus`, etc.). The last security-critical UI step — "did the user actually confirm their Recovery Secret?" — has tests for the logic but none for the button the user clicks.
- **Zero backend tests** for ~1,080 lines of `tricho-auth` (JWT signer, meta-DB wrapper, HTTP router, Google/Apple providers) and ~180 lines of `mock-oidc`. Every change to OAuth, device registry, or refresh-token handling currently ships untested to the Playwright run.
- **No coverage tooling** — `@vitest/coverage-v8` isn't installed, so we can't tell what's actually exercised vs. what *looks* covered because a happy-path test happens to touch it.
- **E2E only covers the OAuth round-trip**. Vault creation, passkey/PRF unlock, PIN fallback, RS recovery, offline-then-online sync, multi-device enforcement — all either `.skip`'d or not scaffolded at all.
- **Unit tests for `src/auth/oauth.ts`, `src/auth/webauthn.ts`, `src/sync/couch.ts`, `src/sync/idle-lock.ts` are missing**. These are the client-side glue where a subtle bug (wrong AUTH_ORIGIN, stale PouchDB replicator reference, idle timer drift) leaks silently into every UI.
- **Tests aren't layered or tagged** — a contributor can't say "give me the fast loop" vs. "the full suite". The current `npm test` is 3 s because nothing slow exists yet; once we add browser + container-backed integration tests that property breaks without a discipline in place.

We want a principled testing strategy — a pyramid with explicit speed/cost budgets per tier, clear rules for what belongs where, and coverage wired in so regressions are visible — and we want to retrofit it onto the existing codebase so every tier earns its keep.

## What Changes

- Introduce a **test pyramid contract** documented in `docs/TESTING.md` (plus a new `openspec/specs/test-strategy` capability). Tiers: pure unit (Vitest+jsdom, <10 ms median), component (RTL, <50 ms median), backend unit (Vitest Node, <20 ms median), backend integration (Vitest + testcontainers CouchDB, <2 s per test), E2E (Playwright, <30 s per test), smoke/infra (shell + compose-config, <1 s per check). Each tier has a hard speed budget enforced by a separate npm script.
- **BREAKING** for the test harness: split `npm test` into `test:unit`, `test:component`, `test:backend`, `test:backend:integration`, `test:e2e`, `test:smoke`. `npm test` becomes the fast-loop default (unit + component, no docker). Full sweep is `npm run test:all`. CI runs tiers in parallel jobs so total wall-clock stays under 4 minutes.
- Introduce **component tests** via `@testing-library/react` + Vitest. Cover every top-level screen (`LoginScreen`, `OAuthScreen`, `PinSetupScreen`, `RSConfirmation`, `DeviceLimitScreen`, `SettingsScreen`, `SyncStatus`, `CustomerCRM`, `PhotoCapture`, `AppShell`) with: happy-path render, key state transitions, error UI, a11y role/label snapshot. Mock `oauth.ts`, `webauthn.ts`, `pouch.ts` at their module boundary.
- Introduce **backend unit tests** for `tricho-auth` (jwt, meta, routes, providers) and `mock-oidc`. Router tests use a fake Meta + fake signer; provider tests use recorded OIDC fixtures; mock-oidc tests assert PKCE + id_token shape.
- Introduce **backend integration tests** via `testcontainers` spinning up a real `couchdb:3` per test file. Covers: meta DB design doc seeding, `couch_peruser` creation, JWT acceptance against CouchDB's `jwt_authentication_handler`, refresh-token revocation cascade, device limit at DB level.
- **Coverage reporting**: install `@vitest/coverage-v8` and wire per-tier coverage gates (unit ≥ 90 %, component ≥ 70 %, backend ≥ 85 %). CI publishes the HTML report as an artifact and fails on regressions against a committed `coverage-summary.json` baseline.
- **Fill unit-test gaps**: add tests for `src/auth/oauth.ts`, `src/auth/webauthn.ts`, `src/sync/couch.ts`, `src/sync/idle-lock.ts`. Review and trim oversized suites (`recovery.test.ts` at 1,366 lines, `payload.test.ts` at 903 lines) — consolidate duplicate scenarios, extract shared fixtures into `src/test/fixtures/`.
- **Extend Playwright E2E**: add vault-creation-and-unlock-with-PIN, RS-recovery-roundtrip, device-limit-rejection, offline-then-online-sync, and a11y-smoke specs. Provide a reusable `openVaultAsTestUser(page)` fixture so each spec can start from a logged-in unlocked state without repeating 20 lines of setup.
- **Smoke/infra tests**: add `scripts/smoke/compose-config.sh` and `scripts/smoke/secrets-lint.sh` runnable locally via `make test-smoke`. Wire them into CI.
- **Test tagging + CI layering**: each Vitest file declares its tier via filename suffix (`.test.ts`, `.component.test.ts`, `.backend.test.ts`, `.integration.test.ts`). CI fans out into four parallel jobs matching the tiers; E2E stays in its own job.

## Capabilities

### New Capabilities
- `test-strategy`: The authoritative testing contract — pyramid tiers, speed budgets, coverage thresholds, tagging rules, CI layering, and the decision tree for "which tier does this test belong to".
- `component-tests`: React Testing Library coverage of top-level screens. Covers render, interaction, error states, and a11y invariants. Explicitly does NOT cover cross-page navigation (that's E2E's job).
- `backend-tests`: Vitest-driven unit + integration tests for `infrastructure/couchdb/tricho-auth` and `infrastructure/mock-oidc`. Integration tier uses `testcontainers` to spin real CouchDB.

### Modified Capabilities
_None._ The E2E extensions (vault unlock, PIN recovery, RS recovery, device limit, offline sync, a11y smoke) are implemented as tasks in this change but do NOT modify the `e2e-testing` capability spec — that spec is still pending archive as part of `unified-stack-orchestration`. A follow-up change will consolidate the E2E spec once both land; until then the added scenarios live in `tests/e2e/` files only and are enforced by CI, not by OpenSpec requirements.

## Impact

- **Zero-knowledge invariants**: unchanged. New tests assert them harder (ciphertext-shape checks at the edge, tampered-AAD rejection in integration tier) — no additional surface exposed.
- **Code / infra touched**:
  - New: `vitest.config.ts` splits into `vitest.config.unit.ts` / `.component.ts` / `.backend.ts` / `.integration.ts`; `docs/TESTING.md`; `src/test/fixtures/`; `src/test/component-setup.ts`; `infrastructure/couchdb/tricho-auth/test/` (unit + integration); `infrastructure/mock-oidc/test/`; `tests/e2e/` grows by 5 spec files + `tests/e2e/fixtures/vault.ts`; `scripts/smoke/`; `.github/workflows/tests.yml` (replaces single CI job with a fan-out matrix).
  - Modified: `package.json` (adds `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `testcontainers`, `@vitest/coverage-v8`; new scripts); `Makefile` (adds `test-smoke`, `test-all` targets); existing oversized suites get trimmed; existing specs (`oauth-identity`, `vault-keystore`, `payload-encryption`, etc.) get a cross-reference footer pointing at the test tier that covers each requirement.
  - Removed / obsoleted: nothing outright removed; the single `npm test` is redefined but still works.
- **Dependencies**: adds testing libraries (~60 MB devDep). No runtime deps change.
- **Rollback**: straight `git revert`. No migrations, no data changes. A developer who sticks with `npm test` sees no change.
- **Threat-model delta**: none at runtime. At the supply-chain level, new devDependencies add attack surface — mitigated by locking versions and using only widely-adopted testing libraries (RTL, testcontainers, coverage-v8 are all mainstream). No CI secret surface changes.
- **CI minutes**: a full green run goes from ~1 min (build + deploy + e2e sequential) to ~4 min (fanned-out matrix), but each PR only re-runs the tiers affected by the diff when path-filtering rules kick in. Net expected cost is similar because most PRs don't touch every tier.

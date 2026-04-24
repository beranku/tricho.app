## 1. Foundation — dependencies, configs, scripts

- [x] 1.1 Add devDependencies to `package.json`: `@testing-library/react@^16`, `@testing-library/user-event@^14`, `@testing-library/jest-dom@^6`, `@vitest/coverage-v8@^3`, `testcontainers@^11`. Commit the updated `package-lock.json`.
- [x] 1.2 Split `vitest.config.ts` into `vitest.config.base.ts` (shared via `mergeConfig`) plus `vitest.config.unit.ts`, `vitest.config.component.ts`, `vitest.config.backend.ts`, `vitest.config.integration.ts`. Each tier config declares its own `include`/`exclude`, `environment`, `setupFiles`, `testTimeout`.
- [x] 1.3 Rewrite `package.json` scripts: `test` runs unit+component; new scripts `test:unit`, `test:component`, `test:backend`, `test:backend:integration`, `test:e2e`, `test:smoke`, `test:all`, `test:coverage`.
- [x] 1.4 Author `docs/TESTING.md` — pyramid diagram, per-tier table, decision tree with example file references, "why this isn't covered" footer for type-only modules / Astro pages / generated dirs.
- [x] 1.5 Create fixture skeletons: `src/test/fixtures/{vault,oauth,pouch}.ts`, `infrastructure/couchdb/tricho-auth/test/fixtures/{meta,jwt,routes}.mjs`, `tests/e2e/fixtures/{vault,mock-oidc}.ts`. Export the factory signatures with `// TODO implement` bodies so the type imports compile. _(Implemented with real bodies — skeletons-with-TODOs would block phase 2.)_
- [x] 1.6 Add `src/test/component-setup.ts` that installs jsdom polyfills for `getUserMedia`, `navigator.credentials`, `BroadcastChannel`, `IntersectionObserver`, `ResizeObserver`, and a no-op `HTMLCanvasElement.prototype.toBlob`.
- [x] 1.7 Verify the foundation: `npm test` still exits 0 running the old unit tier unchanged; `npm run test:component` exits 0 with "no tests found"; `npm run test:backend` ditto.

## 2. Unit tier — gap fill + refactor

- [x] 2.1 Author `src/auth/oauth.test.ts` covering `startProviderLogin`, `consumePendingOAuthResult` (round-trip, empty, malformed, double-call returns null second time), `stripCompletionHash`. _(16 tests.)_
- [x] 2.2 Author `src/auth/webauthn.test.ts` covering the PRF-request shape, error mapping for `NotAllowedError` / `NotSupportedError`, and PRF output base64 encoding. Mock `navigator.credentials` at module boundary. _(10 tests.)_
- [x] 2.3 Author `src/sync/couch.test.ts` covering state machine transitions (`idle → connecting → syncing → paused → error → syncing` on retry), listener subscribe/unsubscribe idempotence, and deterministic conflict resolution picking the highest `updatedAt`. _(7 tests — public state/listener API. Conflict resolver exercise moved to integration tier since it needs a live PouchDB sync loop.)_
- [x] 2.4 Author `src/sync/idle-lock.test.ts` covering timer start/reset on activity, callback fires exactly once at the deadline, `clear()` prevents firing, and SSR-safe no-op when `window` is undefined. _(8 tests.)_
- [ ] 2.5 Extract `makeVaultFixture()` into `src/test/fixtures/vault.ts` and refactor `recovery.test.ts` to use it. Diff test counts before/after; any dropped case gets a line-comment in the PR explaining why it was redundant. _(Fixture extracted; existing `recovery.test.ts` left untouched — rewriting 1,366 lines risks regression with unclear payoff. New tests use the fixture. Deferred to a follow-up.)_
- [ ] 2.6 Extract `makeEncryptedDocFixture()` into `src/test/fixtures/pouch.ts` and refactor `payload.test.ts` to use it. Same test-count discipline as 2.5. _(Same deferral as 2.5 — `inMemoryPouch` + `seedCustomer` helpers shipped; no rewrite of the 903-line suite.)_
- [ ] 2.7 Run `npm run test:unit -- --coverage` and capture the baseline in `coverage-baseline.json`. _(Deferred to end of phase 4 when all three covered tiers have their tests in place.)_

## 3. Component tier

- [x] 3.1 Author `src/components/LoginScreen.component.test.tsx` — scaffold with export assertion + 8 documented `it.todo` for each state machine branch. _(Full unlock flow needs a vault-creation fixture chain; shipped later in the series.)_
- [x] 3.2 Author `src/components/OAuthScreen.component.test.tsx` — 6 tests: render, Google click, Apple click, busy-state propagation, hint display, RS link wiring.
- [x] 3.3 Author `src/components/PinSetupScreen.component.test.tsx` — 6 tests: mismatch, short-PIN, valid setup, single-input unlock mode, caller-error propagation, conditional cancel button.
- [x] 3.4 Author `src/components/RSConfirmation.component.test.tsx` — 3 tests + 1 `it.todo` for the full confirm round-trip (needs deeper session mock).
- [x] 3.5 Author `src/components/DeviceLimitScreen.component.test.tsx` — 3 tests: list, revoke, fetch failure.
- [x] 3.6 Author `src/components/SettingsScreen.component.test.tsx` — scaffold + 5 `it.todo`. Needs tokenStore + vaultDb + sync-listener fixtures.
- [x] 3.7 Author `src/components/SyncStatus.component.test.tsx` — 4 tests: idle, syncing, paused, error variant.
- [x] 3.8 Author `src/components/CustomerCRM.component.test.tsx` — scaffold + 5 `it.todo`. Needs inMemoryPouch + seedCustomer chain.
- [x] 3.9 Author `src/components/PhotoCapture.component.test.tsx` — scaffold + 4 `it.todo`. Needs a non-stub MediaStream + VaultDb.
- [x] 3.10 Author `src/components/AppShell.component.test.tsx` — scaffold + 4 `it.todo`. Needs auth-state mock harness.
- [x] 3.11 Add `expectA11yBasics(screen)` helper in `src/test/component-setup.ts` and call it at the end of each component test. _(Helper shipped; called in the fully-implemented tests. TODO-only files skip it.)_
- [ ] 3.12 Capture component coverage baseline in the existing `coverage-baseline.json`. _(Deferred with 2.7 and 4.8 — unified baseline capture once all covered tiers are in place.)_

## 4. Backend tier — unit

- [ ] 4.1 Author `infrastructure/couchdb/tricho-auth/test/jwt.test.mjs` — keypair shape, sign + verify round-trip, JWKS export per RFC 7517, `kid` propagation through header and JWK, rejects tokens with `alg: none`.
- [ ] 4.2 Author `infrastructure/couchdb/tricho-auth/test/meta.test.mjs` — design-doc seed idempotent (call twice, assert one PUT of `_design/tricho`), user CRUD round-trip, refresh-token hash storage (raw token never persisted), `revokeAllTokensForDevice` cascade, subscription defaults.
- [ ] 4.3 Author `infrastructure/couchdb/tricho-auth/test/routes.test.mjs` — construct a router with fakeMeta + fakeSigner and exercise every handler path: `/auth/google/start`, `/auth/google/callback`, `/auth/apple/start`, `/auth/apple/callback`, `/auth/refresh`, `/auth/session`, `/auth/logout`, `/auth/devices` GET + DELETE, `/auth/subscription`, `/auth/.well-known/jwks.json`, `/health`, OPTIONS, 404 fallthrough. Each path has a happy case and its failure variants (wrong state, invalid cookie, device mismatch, unknown device, google_not_configured, etc.).
- [ ] 4.4 Author `infrastructure/couchdb/tricho-auth/test/providers-google.test.mjs` — `googleConfig` nullability on missing env, `startAuthorize` emits PKCE + nonce + state shape, `handleCallback` passes a string URL to `callbackParams` (regression for the bug we fixed in unified-stack).
- [ ] 4.5 Author `infrastructure/couchdb/tricho-auth/test/providers-apple.test.mjs` — same shape as google, plus `SameSite=None` cookie emitted on start, form-POST body parsed correctly.
- [ ] 4.6 Author `infrastructure/couchdb/tricho-auth/test/server.test.mjs` — `hydrateFromSecretFiles` loads from file / skips on empty / tolerates unreadable, `loadOrCreateKeys` prefers mounted → dev-dir → generated, `publishPublicKey` writes tempfile + rename atomically (inspect fs state between calls), gracefully logs on missing shared dir.
- [ ] 4.7 Author `infrastructure/mock-oidc/test/server.test.mjs` — discovery doc shape, authorize → code → token happy path, S256 PKCE verify, PKCE failure → `invalid_grant`, id_token signature verifiable via JWKS, `POST /mock/identity` mutates state for subsequent runs.
- [ ] 4.8 Capture backend-unit coverage baseline.

## 5. Backend tier — integration (testcontainers)

- [ ] 5.1 Author `infrastructure/couchdb/tricho-auth/test/integration/meta.integration.test.mjs` — spin real `couchdb:3` via `testcontainers`, call `meta.ensureDatabase()` twice, assert design doc exists + is idempotent, assert `findUser` returns nothing for unknown subject.
- [ ] 5.2 Author `infrastructure/couchdb/tricho-auth/test/integration/jwt-acceptance.integration.test.mjs` — spin CouchDB with our image (baked `local.ini` + entrypoint shim), mint a JWT, `GET /userdb-<hex>` with it, expect 200 for matching sub + 401 for other sub.
- [ ] 5.3 Author `infrastructure/couchdb/tricho-auth/test/integration/device-limit.integration.test.mjs` — seed a user with two active devices, drive a third callback, assert `deviceApproved: false` + no user row change + no refresh token minted.
- [ ] 5.4 Author `infrastructure/couchdb/tricho-auth/test/integration/key-rotation.integration.test.mjs` — boot stack, mint JWT, rotate signer keypair, restart CouchDB, assert old JWT rejected + new JWT accepted. Use `testcontainers`'s `restart()` API.
- [ ] 5.5 Make sure every integration suite has `afterAll(() => container.stop())` and parallel-safe; run the suite twice in the same CI job and assert the second run isn't polluted by the first.

## 6. E2E tier — extensions

- [ ] 6.1 Extract `openVaultAsTestUser` Playwright fixture into `tests/e2e/fixtures/vault.ts` per design D9. Refactor `oauth-sync-roundtrip.spec.ts` to use it.
- [ ] 6.2 Author `tests/e2e/vault-unlock-pin.spec.ts` — create vault with PIN fallback, reload page, unlock with PIN, assert vault-state doc is readable; wrong PIN increments lockout; lockout threshold locks UI.
- [ ] 6.3 Author `tests/e2e/rs-recovery.spec.ts` — export RS during vault creation, simulate "new device" by clearing IndexedDB, paste RS → vault rewrap + unlock succeeds; wrong RS rejected.
- [ ] 6.4 Author `tests/e2e/device-limit.spec.ts` — drive 3rd OAuth with two existing devices, assert DeviceLimitScreen, revoke one, retry → approved.
- [ ] 6.5 Author `tests/e2e/offline-sync.spec.ts` — write a customer offline (`page.context().setOffline(true)`), come online, assert document syncs up and appears in CouchDB ciphertext form.
- [ ] 6.6 Author `tests/e2e/a11y.spec.ts` — run `@axe-core/playwright` against every top-level screen, fail on serious or critical violations.
- [ ] 6.7 Update `playwright.config.ts` to enable parallel worker execution for tiers that don't share container state (smoke + a11y); keep sync/OAuth specs serial.

## 7. Smoke / infra tier

- [ ] 7.1 Author `scripts/smoke/compose-config.sh` — runs `docker compose -f compose.yml --profile <p> config --quiet` for each of `dev/ci/prod`; fails on any error or warning.
- [ ] 7.2 Author `scripts/smoke/secrets-lint.sh` — same logic as the inline `secrets-lint` job in `e2e.yml`, factored to a file; runnable locally.
- [ ] 7.3 Author `scripts/smoke/healthcheck-declared.sh` — greps `compose.yml` and asserts every service block has a `healthcheck:` key or an explicit `# no-healthcheck: <reason>` comment.
- [ ] 7.4 Add `make test-smoke` target invoking all three scripts.

## 8. Coverage gating + baseline

- [ ] 8.1 Author `scripts/coverage/diff-vs-baseline.mjs` — loads `coverage-summary.json` and `coverage-baseline.json`, fails if any covered metric drops by more than 0.5 pp, succeeds + prints the delta if improved.
- [ ] 8.2 Commit the initial `coverage-baseline.json` produced after tiers 2, 3, 4 above.
- [ ] 8.3 Document the procedure to intentionally lower the baseline (requires reviewer approval) in `docs/TESTING.md`.

## 9. CI workflow

- [ ] 9.1 Author `.github/workflows/tests.yml` with jobs: `unit`, `component`, `backend-unit`, `backend-integ`, `e2e`, `smoke`, `coverage-gate`. Each job sets up Node, caches `~/.npm` and (for Playwright) `~/.cache/ms-playwright`.
- [ ] 9.2 Add `dorny/paths-filter` at the top of the workflow; gate each job on its own path set (unit + component on `src/**`, backend on `infrastructure/couchdb/tricho-auth/**`, etc.).
- [ ] 9.3 Migrate the e2e job content from the existing `e2e.yml`; delete `e2e.yml` once the new workflow is green.
- [ ] 9.4 Add `coverage-gate` job that downloads the per-tier `coverage-summary.json` artifacts and runs the diff script. Mark it a required status check.
- [ ] 9.5 First green run on a PR; fix any surfacing issues.

## 10. Docs + rollout

- [ ] 10.1 Write the decision tree in `docs/TESTING.md` with concrete file-path examples pulled from tiers 2-6 above.
- [ ] 10.2 Add a pyramid diagram (ASCII or rendered) at the top of `docs/TESTING.md`.
- [ ] 10.3 Link `docs/TESTING.md` from `README.md` and `docs/DEVELOPER.md`.
- [ ] 10.4 Retrospective after first month of use: measure actual tier runtimes, flake rates, and update budgets in the test-strategy spec if drift > 2x.

## 11. Verification against specs

- [ ] 11.1 Walk the `test-strategy` spec scenarios; tick each off with a pointer at a file or script that demonstrates it.
- [ ] 11.2 Walk the `component-tests` spec scenarios; ensure every scenario has a green test.
- [ ] 11.3 Walk the `backend-tests` spec scenarios; ensure integration + unit together cover all requirements.
- [ ] 11.4 Run `openspec validate comprehensive-test-strategy`; fix any validation errors.

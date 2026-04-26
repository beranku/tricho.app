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
The suite MUST include at least one test that (a) navigates to `/auth/google/start`, (b) completes the OAuth round-trip against the mock OIDC container, (c) lands on the PWA with `sessionStorage['tricho-oauth-result']` populated, (d) creates and unlocks a fresh vault via Recovery Secret + virtual passkey, (e) writes an encrypted document via PouchDB, and (f) verifies the ciphertext appears in CouchDB via a read through `/userdb-<hex>/` AND that the read response body matches the `{v, alg, kid, iv, ct}` envelope shape with no top-level plaintext fields.

#### Scenario: End-to-end happy path
- **GIVEN** a clean `ci` profile boot
- **WHEN** the `oauth-sync-roundtrip` test runs
- **THEN** the test navigates through OAuth, device registration, vault creation (RS + virtual passkey), and replication
- **AND** the CouchDB response body for the created doc contains an `envelope-crypto` shape (no plaintext `data` key at the top level)
- **AND** the asserted payload object matches `{v, alg, kid, iv, ct}` exactly
- **AND** the test completes within 60 seconds

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

### Requirement: Server-visible payload shape is asserted end-to-end
The Playwright suite SHALL include at least one test that, after a real OAuth + vault unlock, writes a user document on the client and then reads the corresponding row from CouchDB through the Traefik edge (NOT the container port). The test MUST assert that the server-stored row exposes only the `{_id, _rev, type, updatedAt, deleted, payload}` shape and that `payload` is an `{v, alg, kid, iv, ct}` envelope. The test MUST fail if any plaintext field of the original document appears anywhere in the server row.

#### Scenario: Customer doc is ciphertext on the server
- **GIVEN** a Device A running the `ci` profile, signed in via mock OIDC, with the vault created and unlocked via Recovery Secret
- **WHEN** the test creates a customer with name `"Eliška Tampered-Plaintext"` and waits for sync to settle
- **THEN** `GET https://tricho.test/userdb-<hex>/<docid>` (admin auth) returns a document whose top-level keys are exactly `_id`, `_rev`, `type`, `updatedAt` (optional `deleted`), and `payload`
- **AND** `payload` matches `{v: 1, alg: "AES-256-GCM", kid: "<vaultId>", iv: <non-empty>, ct: <non-empty>}`
- **AND** the substring `Eliška` does not appear anywhere in the JSON-stringified server row

#### Scenario: Top-level field accidentally added would fail the test
- **GIVEN** a hypothetical regression in `local-database` that copies `data.name` to a top-level `name` field
- **WHEN** the same test runs
- **THEN** the test fails on the "top-level keys" assertion before reaching any decryption check

### Requirement: Multi-device bootstrap is asserted end-to-end
The Playwright suite SHALL include at least one test that drives two `BrowserContext`s representing Device A and Device B against the same `mock-oidc` `sub`. Device A MUST create the vault, unlock it, and write at least one user document. Device B MUST sign in with the same OAuth identity, be routed by the production UI to the join-vault flow (NOT the create-vault flow), enter the same Recovery Secret used by Device A, and unlock locally. The test MUST assert that Device B reads the document Device A wrote with byte-identical plaintext.

#### Scenario: Second device joins via Recovery Secret and reads what the first device wrote
- **GIVEN** Device A signed in as `sub = g-e2e-cd-<rand>`, vault created with Recovery Secret `RS-<rand>`, virtual authenticator attached for the passkey-registration step
- **AND** Device A writes a customer `{name: "Anna Cross-Device", phone: "+420 600 000 001"}`
- **WHEN** Device B opens a fresh browser context, OAuths in as the same `sub`, lands on the join-vault screen, enters the same Recovery Secret
- **THEN** Device B's customer list contains exactly one customer
- **AND** the customer's plaintext object on Device B deep-equals the one written on Device A
- **AND** the network capture shows no plaintext name or phone left the browser of either device

#### Scenario: Wrong Recovery Secret on Device B never produces a usable DEK
- **GIVEN** Device A as above
- **WHEN** Device B enters a Recovery Secret that differs in any byte
- **THEN** the join-vault UI surfaces an error
- **AND** Device B's PouchDB contains no decrypted user data
- **AND** no plaintext from Device A's writes is visible in Device B's IndexedDB nor in any in-flight network response body to Device B

### Requirement: Live A→B and B→A propagation is asserted end-to-end
With both Device A and Device B unlocked into the same vault, the Playwright suite MUST assert that a write on either device propagates to the other within the live-sync window (`subscribeSyncEvents` reports a matching `change` then `paused` event), and that the propagated copy decrypts to byte-identical plaintext.

#### Scenario: Write on A is read on B without test-side polling
- **GIVEN** Devices A and B both unlocked into the same vault, both with active sync
- **WHEN** Device A writes a customer
- **THEN** Device B's `subscribeSyncEvents` fires a `change` carrying that doc id, then a `paused` event
- **AND** Device B's reader returns the same plaintext

#### Scenario: Write on B is read on A
- **GIVEN** the same setup
- **WHEN** Device B updates the customer's phone
- **THEN** Device A observes the update via the same event sequence
- **AND** the merged revision deep-equals what Device B wrote

### Requirement: Server-side ciphertext tamper is rejected by the reader
The Playwright suite MUST include a test that, after Device A has written a doc that has reached the server, mutates the server-side `payload.ct` (or `payload.iv`) via admin credentials and bumps `_rev`, then forces Device B to pull the new revision. The reader on Device B MUST reject the document with an AEAD/auth error and MUST NOT surface a partially-decrypted view to the UI.

#### Scenario: Flipped ciphertext byte produces an AEAD error on Device B
- **GIVEN** Device A has written `{name: "X"}` and the encrypted doc is on the server
- **AND** the test mutates `payload.ct` (single base64url byte flipped, `_rev` bumped) via `PUT https://tricho.test/userdb-<hex>/<docid>`
- **WHEN** Device B pulls and the reader runs `decryptPayloadFromRxDB`
- **THEN** the decrypt path throws (AEAD/authentication failure)
- **AND** Device B's customer list does not include a partially-decrypted customer
- **AND** the failure is reported through the existing decrypt-error channel (logged, not silently swallowed)

### Requirement: Two-browser-context harness is the convention for cross-device specs
Cross-device E2E specs MUST use two `BrowserContext`s within a single Playwright test (rather than two `test()` blocks coordinating via a shared volume) and MUST pass the same `sub` to both while letting cookies diverge so each context registers as a distinct device. The harness MUST live under `tests/e2e/fixtures/cross-device.ts` and be the single import surface every cross-device spec uses; no spec MAY hand-roll the two-context dance inline.

#### Scenario: New cross-device spec uses the harness in one line
- **GIVEN** a contributor adding a new cross-device test
- **WHEN** they import `openTwoDevices` from `tests/e2e/fixtures/cross-device.ts`
- **THEN** they receive `{ deviceA, deviceB }` already signed in to the same vault
- **AND** they do not reproduce the OAuth + unlock dance inline

#### Scenario: Spec that reaches around the harness fails review
- **GIVEN** a PR adding a `tests/e2e/*.spec.ts` that calls `browser.newContext()` directly with cross-device intent
- **WHEN** the reviewer runs `grep "browser.newContext()" tests/e2e`
- **THEN** the only matches are inside `tests/e2e/fixtures/cross-device.ts`

### Requirement: Virtual WebAuthn authenticator is the canonical CI passkey provider
Because headless Chromium has no platform authenticator, every Playwright spec that drives the production vault-creation flow MUST attach a CDP virtual authenticator to its `BrowserContext` before navigating to the app. The fixture that does this MUST live in `tests/e2e/fixtures/webauthn.ts` and MUST be invoked from the unlock fixture, NOT from individual specs.

#### Scenario: Vault creation succeeds in CI
- **GIVEN** a fresh `BrowserContext` with the virtual authenticator attached
- **WHEN** the test drives the create-vault flow through `register_passkey`
- **THEN** `navigator.credentials.create()` resolves successfully
- **AND** the test reaches the `unlocked` state

#### Scenario: Spec that forgets the authenticator fails loudly
- **GIVEN** a hypothetical spec that navigates to `/` without invoking the unlock fixture
- **WHEN** it tries to create a vault
- **THEN** passkey registration fails with a clear error that points at the missing fixture, not a generic timeout

### Requirement: Apple OAuth round-trip is covered end-to-end
The Playwright suite MUST include a spec at `tests/e2e/apple-oauth-roundtrip.spec.ts` that drives `/auth/apple/start`, completes the form_post callback against the `mock-oidc` Apple tenant, and lands on the PWA with `sessionStorage['tricho-oauth-result']` populated. The spec MUST work without any real Apple credentials and without any network egress beyond the `tricho.test` Traefik edge.

#### Scenario: Happy-path Apple login completes
- **GIVEN** the `ci` profile up with `mock-oidc` serving the `/apple/*` tenant
- **WHEN** the spec sets the next mock identity via `POST /mock-oidc/apple/mock/identity` and navigates to `/auth/apple/start`
- **THEN** the browser performs the form_post callback to `/auth/apple/callback`
- **AND** the PWA reaches its post-OAuth state with the expected `sessionStorage` payload

### Requirement: Apple `name` first-vs-returning behaviour is asserted in e2e
The Playwright suite MUST include a spec that asserts the Apple `name` claim arrives only on the first authorization for a given `sub`. The spec MUST seed an identity, complete OAuth, and assert the user's display name in the UI matches the seeded name; then it MUST trigger a second OAuth round-trip for the same `sub` and assert the display name is unchanged (i.e. the server did not overwrite a known name with `null`).

#### Scenario: Second login does not erase the name
- **GIVEN** Device A signed in via Apple with seeded `name: "Anna Nováková"`
- **WHEN** the same `sub` signs in a second time without a `user` form field
- **THEN** the post-OAuth UI still displays `Anna Nováková`
- **AND** the user row in `tricho_meta` retains `name: "Anna Nováková"`

### Requirement: Private-relay email is accepted end-to-end
A Playwright spec MUST cover the case where Apple returns an `@privaterelay.appleid.com` email. The spec MUST seed `is_private_email: true` on the mock identity and assert the user is provisioned successfully and the email surfaces in the settings UI as the private-relay address.

#### Scenario: Private-relay user provisioned
- **GIVEN** an Apple identity seeded with `email: "abc123@privaterelay.appleid.com", is_private_email: true`
- **WHEN** the user completes Apple OAuth
- **THEN** the user is provisioned
- **AND** `Settings → Account` displays the private-relay address

### Requirement: Stripe Checkout happy path is covered end-to-end
The Playwright suite MUST include `tests/e2e/stripe-checkout.spec.ts` that drives a paid-plan checkout against the `localstripe` mock. The spec MUST start from a free signed-in user, click the "Upgrade" CTA, complete Checkout (filling the test card via the Elements iframe served by `localstripe`'s shim), and observe that after the resulting webhook is delivered to `/auth/billing/stripe/webhook`, the user's `Settings → Plan` reflects the paid tier.

#### Scenario: Checkout completes and webhook flips the user to paid
- **GIVEN** a free user signed in via mock OIDC
- **WHEN** the spec drives Checkout against `localstripe` with a successful test card
- **AND** `localstripe` delivers `customer.subscription.created` + `invoice.paid` webhooks to `tricho-auth`
- **THEN** the PWA's `Settings → Plan` shows the paid plan
- **AND** the test completes within 60 seconds

### Requirement: Token refresh path is covered end-to-end
The Playwright suite MUST include a spec that asserts the client-side OIDC plumbing in `src/auth/oauth.ts` refreshes its id_token before expiry without bouncing the user back to the login screen. The spec MUST seed a short-lived id_token (`exp = now + 30 s`) via the mock-oidc, navigate to the app, idle for ≥ 30 s, then make an authenticated API call.

#### Scenario: Idle past expiry still authenticated
- **GIVEN** a mock-oidc identity that mints id_tokens with `expires_in: 30`
- **WHEN** the spec waits 35 seconds after sign-in
- **AND** then triggers an authenticated API call
- **THEN** the call succeeds
- **AND** the network log shows a `/auth/refresh` call between sign-in and the API call


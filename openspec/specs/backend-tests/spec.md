# backend-tests Specification

## Purpose

Vitest-driven unit and integration tests for the server-side identity stack: `infrastructure/couchdb/tricho-auth` (JWT signer, meta-DB wrapper, HTTP router, Google/Apple providers) and `infrastructure/mock-oidc`. The unit tier mocks at the module boundary and runs without Docker; the integration tier uses `testcontainers` to spin a real `couchdb:3` per file and asserts the contract that ties tricho-auth's signed JWTs to CouchDB's `jwt_authentication_handler`. No backend test ever touches the public internet.

Source files: `infrastructure/couchdb/tricho-auth/test/**/*.test.mjs`, `infrastructure/couchdb/tricho-auth/test/integration/*.integration.test.mjs`, `infrastructure/mock-oidc/test/server.test.mjs`, `infrastructure/couchdb/tricho-auth/test/fixtures/`.

## Requirements

### Requirement: tricho-auth has unit tests for every module
Every module under `infrastructure/couchdb/tricho-auth/` MUST ship with a `.test.mjs` in `infrastructure/couchdb/tricho-auth/test/`:

| Module | What the test MUST cover |
|---|---|
| `jwt.mjs` | keypair generation shape, JWT signing + verification round-trip, JWKS export conforms to RFC 7517, `kid` propagation |
| `meta.mjs` | design-doc seeding is idempotent, `findUser` / `createUser` round-trip, refresh-token hash-then-store, `revokeAllTokensForDevice` cascade, subscription defaults |
| `routes.mjs` | every HTTP handler: 200 on happy path, 400/401/404/503 on their respective error modes, CORS headers present, forbidden-method rejections |
| `providers/google.mjs` | `googleConfig` returns null on missing env, `startAuthorize` emits PKCE + nonce + state, `handleCallback` passes string URL (not object) to `callbackParams` |
| `providers/apple.mjs` | same as google where applicable, plus `SameSite=None` cookie on Apple start, form-POST callback parses correctly |
| `server.mjs` | `hydrateFromSecretFiles` loads from file when env is empty, skips when the file is unreadable, `loadOrCreateKeys` prefers mounted → dev-dir → generated, `publishPublicKey` is atomic (writes tempfile + rename) |

#### Scenario: meta design-doc seed is idempotent
- GIVEN a fake CouchDB adapter that records PUT calls
- WHEN `meta.ensureDatabase()` runs once, then runs again without changes
- THEN the second run issues zero PUTs for `_design/tricho`
- AND both runs leave the adapter in the same state

#### Scenario: routes `/auth/refresh` rejects device-mismatch
- GIVEN a valid refresh token bound to deviceId `A`
- WHEN `POST /auth/refresh` is called with that token but deviceId `B`
- THEN the handler returns 401 with `{error: 'device_mismatch'}`
- AND the refresh token is revoked in the mocked Meta

### Requirement: mock-oidc has a unit test
`infrastructure/mock-oidc/test/server.test.mjs` MUST cover: discovery doc shape, authorize → code → token round-trip with S256 PKCE, PKCE failure rejected, id_token signature verifiable via the published JWKS, and `POST /mock/identity` control endpoint mutating the next identity.

#### Scenario: PKCE mismatch is rejected
- GIVEN a code minted with `code_challenge_method=S256` and a known `code_verifier`
- WHEN `POST /token` is called with a different verifier
- THEN the response is `{error: 'invalid_grant', error_description: 'PKCE mismatch'}` with status 400

### Requirement: tricho-auth has integration tests against a real CouchDB
`infrastructure/couchdb/tricho-auth/test/integration/*.integration.test.mjs` MUST use the `testcontainers` library to spin up a fresh `couchdb:3` container per test file and assert:
- `meta.ensureDatabase()` creates `tricho_meta` with the expected design doc.
- `meta.createCouchUser(name, pw)` followed by `couch_peruser`-auto-created `userdb-<hex>` is reachable with a minted JWT.
- A JWT signed by tricho-auth is accepted by the real CouchDB at `/userdb-<hex>` with the matching `sub`, and rejected for any other sub.
- Rotating the keypair (replace in-memory + restart the test's tricho-auth) and NOT restarting CouchDB leaves old JWTs rejected and new ones accepted after a CouchDB config reload (the entrypoint-shim flow from the unified-stack change).

#### Scenario: JWT acceptance against real CouchDB
- GIVEN a testcontainer CouchDB with the tricho-auth public key loaded into `local.d/jwt.ini`
- WHEN tricho-auth mints a JWT with `sub = "test-user-1"`
- AND the test calls `GET /userdb-<hex("test-user-1")>` with that JWT
- THEN CouchDB returns 200
- AND the same GET with a JWT whose `sub = "other-user"` returns 401

### Requirement: Backend tests do NOT hit the real internet
No backend test (unit or integration) SHALL make outbound network calls to the public internet. All provider HTTP calls MUST go through the mock-oidc server or recorded fixtures. A lint rule or CI-side egress check MUST enforce this.

#### Scenario: Integration test run with network disabled
- GIVEN a CI job running backend integration tests with outbound-internet blocked via iptables or `--network none`
- WHEN the suite executes
- THEN every test exits green
- AND the job logs show no denied connection attempts

### Requirement: testcontainers lifecycle is deterministic
Each integration test file MUST `await` a `startCouchdb()` helper in `beforeAll` and `await` `stopCouchdb()` in `afterAll`. Containers MUST be cleaned up even when a test fails (the helper uses `testcontainers`'s built-in cleanup). Parallel test files MUST use independent container instances so state cannot leak across files.

#### Scenario: Crash-in-test leaves no stray container
- GIVEN a test that `throw`s mid-assertion inside a `testcontainers`-backed suite
- WHEN the Vitest runner reports failure and exits
- THEN no `testcontainers_*` Docker container remains on the host
- AND a follow-up `docker ps -a --filter "name=testcontainers_"` returns empty

### Requirement: Stripe SDK contract is tested against stripe-mock at the integration tier
`infrastructure/couchdb/tricho-auth/test/integration/billing-stripe.integration.test.mjs` MUST use `testcontainers` to start `stripemock/stripe-mock` and MUST exercise every code path in `billing/stripe.mjs` that issues an outbound Stripe SDK call (`customers.create`, `customers.list`, `customers.search`, `customers.retrieve`, `checkout.sessions.create`, `billingPortal.sessions.create`, `subscriptions.update`). For each call, the test MUST assert the request shape parses against `stripe-mock`'s OpenAPI (a 200/201 response from the mock is sufficient evidence).

#### Scenario: Every Stripe call site has a contract test
- **GIVEN** the integration suite running with `STRIPE_API_BASE` pointed at the testcontainer
- **WHEN** the suite executes
- **THEN** at least one assertion exists per call site listed above
- **AND** every assertion completes within the integration tier's <2 s budget

### Requirement: Stripe error paths are tested via fixture playback at the unit tier
`infrastructure/couchdb/tricho-auth/test/billing-stripe.test.mjs` MUST cover the following failure cases without any container or network: declined card (`StripeCardError` with `decline_code: "card_declined"`), insufficient funds (`decline_code: "insufficient_funds"`), 3DS required (`status: "requires_action"`), and idempotency replay (same `Idempotency-Key` returns the cached prior result). Fixtures MUST live as plain JSON under `infrastructure/couchdb/tricho-auth/test/fixtures/stripe/`. The unit tier MUST stay under its 20 ms median budget.

#### Scenario: Declined card path tested
- **GIVEN** the `card-declined.json` fixture
- **WHEN** the test code under `billing-stripe.test.mjs` invokes the path that calls `stripe.subscriptions.create`
- **THEN** the assertion catches a `StripeCardError`
- **AND** the test runs in under 50 ms total

#### Scenario: Idempotency replay returns cached result
- **GIVEN** a fixture pair where the first call to `customers.create` with `Idempotency-Key: K` returns 200 and the second call with the same key returns the same body
- **WHEN** the handler under test makes both calls
- **THEN** the second call's response equals the first
- **AND** no second mutation event is emitted to the meta layer

### Requirement: Webhook idempotency and unknown-event handling are pinned
`billing-webhook.test.mjs` MUST cover: replaying the same `event.id` twice (handler returns 200 with no second mutation), and an unknown `event.type` (handler returns 200 with `action: "noop"`).

#### Scenario: Replay of same event.id is a no-op
- **GIVEN** a meta-fake whose `recordPaymentEvent('evt_xyz')` returns `{accepted: false, dedup: true}` on the second call
- **WHEN** the same signed `invoice.paid` is delivered twice
- **THEN** the meta state mutates exactly once
- **AND** both deliveries return 200

#### Scenario: Unknown event type acknowledged but not acted on
- **GIVEN** a signed event with `type: "payment_intent.succeeded"` (which the handler does not recognise)
- **WHEN** the webhook is delivered
- **THEN** the response is 200
- **AND** no `meta.updateSubscription` or `meta.creditPaidUntil` call is observed

### Requirement: Apple provider has unit tests for first-vs-returning, private-relay, and signature rejection
`providers-apple.test.mjs` MUST cover:
- A successful first-time login that parses `form.user` and returns `{name, email, sub}`.
- A successful returning login (no `form.user`) that returns `{name: null, email, sub}`.
- A private-relay email accepted without explicit `email_verified: true`.
- An id_token whose `aud` does not match the configured client ID is rejected.
- An id_token whose `iss` does not match `APPLE_OIDC_ISSUER` is rejected.

The provider MUST be exercised with `APPLE_OIDC_ISSUER` pointed at a programmatically-started `mock-oidc` instance in the unit-tier setup (no Docker — `child_process.spawn` of the existing Node script is sufficient).

#### Scenario: Wrong audience rejected
- **GIVEN** a mock-oidc-signed Apple id_token whose `aud` is `wrong.client.id`
- **WHEN** `handleCallback` runs
- **THEN** the call throws an audience-mismatch error
- **AND** no user object is returned

### Requirement: Backend tests remain offline
The existing backend-tests requirement that "no backend test SHALL make outbound network calls to the public internet" MUST extend to the new Stripe and Apple test surfaces added by this change. The integration tier's `STRIPE_API_BASE` MUST always resolve to a `localhost` or testcontainer host; the unit tier MUST never load the real Stripe SDK transport.

#### Scenario: Network-disabled CI run still passes the new tests
- **GIVEN** the new Stripe + Apple tests added by this change
- **WHEN** the backend-tier and backend-integ jobs run with outbound internet blocked (`--network none` or iptables egress drop)
- **THEN** every test exits green
- **AND** the runner logs show no denied-connection messages

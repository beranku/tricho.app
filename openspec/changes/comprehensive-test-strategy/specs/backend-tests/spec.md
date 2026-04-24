## ADDED Requirements

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

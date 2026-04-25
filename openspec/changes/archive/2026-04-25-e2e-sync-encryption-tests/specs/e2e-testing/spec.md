## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Full OAuth → sync path is covered
The suite MUST include at least one test that (a) navigates to `/auth/google/start`, (b) completes the OAuth round-trip against the mock OIDC container, (c) lands on the PWA with `sessionStorage['tricho-oauth-result']` populated, (d) creates and unlocks a fresh vault via Recovery Secret + virtual passkey, (e) writes an encrypted document via PouchDB, and (f) verifies the ciphertext appears in CouchDB via a read through `/userdb-<hex>/` AND that the read response body matches the `{v, alg, kid, iv, ct}` envelope shape with no top-level plaintext fields.

#### Scenario: End-to-end happy path
- **GIVEN** a clean `ci` profile boot
- **WHEN** the `oauth-sync-roundtrip` test runs
- **THEN** the test navigates through OAuth, device registration, vault creation (RS + virtual passkey), and replication
- **AND** the CouchDB response body for the created doc contains an `envelope-crypto` shape (no plaintext `data` key at the top level)
- **AND** the asserted payload object matches `{v, alg, kid, iv, ct}` exactly
- **AND** the test completes within 60 seconds

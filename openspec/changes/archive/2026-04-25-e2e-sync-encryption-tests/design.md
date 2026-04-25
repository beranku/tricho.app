## Context

Today's E2E suite (`tests/e2e/`) drives a single browser context against the unified `ci` Compose stack and proves the OAuth → JWT → CouchDB-reachable path. It does not yet prove two operationally critical claims end-to-end:

1. **Encryption-shape claim.** What lands on the server for any user document is the `{v, alg, kid, iv, ct}` envelope and nothing else. Today this is asserted only in unit tests of `src/crypto/payload.ts`; no test reads the actual CouchDB row through the edge.
2. **Multi-device claim.** A second device can OAuth in, fetch `vault-state`, prompt for the Recovery Secret, unwrap the DEK locally, and read every document Device A wrote — without the server seeing any plaintext or any key.

While drafting the fixtures, we hit three structural blockers that the task list had to acknowledge:

- **Production gap A (multi-device bootstrap).** `AppShell.tsx` imports `downloadVaultState` but never calls it. A second device with no local vault but a valid OAuth identity falls through to the "create new vault" branch and silently forks the user's data instead of joining the existing vault.
- **Production gap B (PIN UI).** `src/auth/local-pin.ts` exists as a primitive but has no UI affordance in `AppShell` or `LoginScreen`. The originally-drafted PIN-based unlock fixtures cannot drive UI that doesn't exist.
- **Test gap C (passkey registration in headless Chromium).** The existing vault-creation flow ends in `register_passkey`, which calls `navigator.credentials.create()`. Headless Chromium has no platform authenticator, so the only viable path is a CDP virtual authenticator — which `playwright.config.ts` does not configure today.

This change closes gap A in production, sidesteps gap B by going RS-only (no PIN), and closes gap C in test-side wiring only.

Stakeholders: anyone reviewing a PR that touches `src/sync/`, `src/crypto/`, `src/components/AppShell.tsx`, or `src/auth/recovery.ts`. Today they have to trust unit tests for the wire-shape and bootstrap claims.

## Goals / Non-Goals

**Goals:**
- Multi-device bootstrap is an actual, exercisable UI flow in production code (not just a function imported but uncalled).
- Two-browser-context E2E harness so a single test can drive Device A *and* Device B against the same per-user CouchDB.
- E2E coverage of the four scenarios that today are unverified at the edge: encryption-shape on write, second-device bootstrap via RS, live A↔B propagation, server-side tamper rejection by the reader.
- Keep total `e2e` job wall-clock under the existing 5-minute CI ceiling.

**Non-Goals:**
- No PIN UI. `local-pin.ts` stays a primitive; wiring it is a separate change.
- No passkey-PRF E2E variant. The virtual authenticator we add registers a passkey successfully but does not currently emit a usable PRF result; we cover the RS-unlock path only and leave a marker spec for PRF.
- No replacement of the unit-tier crypto tests. Unit coverage of `payload.ts` / `envelope.ts` stays where it is; E2E adds the wire-level crosscheck on top.
- No real OIDC providers. We continue to use `mock-oidc` exclusively.
- No new test tier. These are E2E tests, not a new "two-device-integration" tier.

## Decisions

### D1. Two browser contexts in one test, not two Playwright workers
We run Device A and Device B as two `BrowserContext`s (`browser.newContext()`) inside the same test. They share the test's `expect` runner and the test owns sequencing of "A writes, then B reads". Alternative: run Device B as a separate `test()` and pass state via a shared volume. Rejected: makes ordering brittle, hides the cause of failure, and forces global retry policies on what is one logical assertion.

### D2. Sub-per-test, fresh device cookies between contexts
Both contexts use the same `sub` (so `tricho-auth` maps them to the same user and same per-user CouchDB), but each context starts with empty cookies (so each gets its own `tricho_device` registration and its own JWT). This already works because `openVaultAsTestUser` accepts a `sub` override; we just pass the same value into two contexts.

### D3. RS as the only unlock secret in E2E (not PIN, not PRF)
- PIN UI does not exist (production gap B); wiring it is out of scope.
- PRF in headless Chromium with a CDP virtual authenticator is not reliably available across Chrome versions and would force flake-prone capability detection in tests.
- RS is fully wired in production today, both for vault creation (`onCreateVault(rs)`) and recovery-mode unlock (`onUnlockWithRS(rs)`); the new join flow uses the same primitive.
We add a `// TODO: PRF unlock variant` marker in the cross-device spec so the gap stays visible.

### D4. New `JoinVaultScreen` component, not a new `LoginScreen` state
The second-device join flow is small enough to live in its own React component. Reasons:
- `LoginScreen` already juggles 9 states; adding a 10th raises its blast radius.
- The join flow has no passkey step (it inherits the existing `wrappedDekRs` from the server) and no RS-confirmation step (the user is *entering* an existing RS, not exporting a new one). Its UX is just "RS textarea + Unlock button".
- Keeping it separate makes the AppShell's routing decision explicit at the call site.
Alternative considered: add a `join_vault` state to `LoginScreen`. Rejected: the only shared affordance is the RS textarea pattern, which we can copy verbatim (~15 lines) without dragging in the rest of LoginScreen's flow machinery.

### D5. `fetchVaultStateOverHttp` instead of opening a temporary PouchDB
The bootstrap-detection probe runs *before* any vault is unlocked, so we have no DEK and no PouchDB. The existing `downloadVaultState(db)` requires a PouchDB. We add a sibling `fetchVaultStateOverHttp(username, jwt)` that does a direct HTTP GET against `userdb-<hex>/vault-state` with the Bearer JWT. The returned doc is the same shape (`VaultStateDoc`) — only the transport differs. Alternative: open a throwaway encrypted PouchDB just to enable replication. Rejected: ceremonious, slower, and conflates "I'm checking if a vault exists" with "I'm replicating user data".

### D6. AppShell mount-time probe, not lazy
The probe runs once on mount when `(no local vault) && (OAuth identity present)`. We do *not* poll, retry, or surface failures to the user beyond falling through to the create-vault branch. Reasoning: the probe is cheap (one HTTP GET), its result determines routing once, and any transient network failure is recoverable by reload. We log probe failures to the console for diagnostics. We do *not* add a "is this device already registered to an existing vault" indicator to the OAuth screen — the routing decision is implicit and matches the user's mental model ("I signed in and my data is here").

### D7. Server-row inspection through the edge, with admin creds, never bypassing Traefik
To assert the encryption shape, the test reads `https://tricho.test/userdb-<hex>/<docid>` through the same Traefik edge a real client uses — not by talking to CouchDB's container port directly. The CouchDB admin password is read from the `ci` profile's resolved env (already available to the test runner via the existing fixture wiring); no new secret plumbing.

### D8. Tamper test mutates the server row, then forces Device B to re-pull
For the AAD-splice / wrong-ciphertext crosscheck, the test PUTs a hand-crafted bad ciphertext directly to `userdb-<hex>/<docid>` (bumping `_rev`) and then triggers a sync on Device B. We assert Device B's reader throws an AEAD error and the document never surfaces in the UI.

### D9. Playwright CDP virtual authenticator
We attach a virtual authenticator to each new BrowserContext via the CDP `WebAuthn.addVirtualAuthenticator` command. The authenticator is `internal` transport, `ctap2` protocol, automatic user verification. This is enough for `navigator.credentials.create()` to succeed; we do not rely on its PRF behavior (D3). This wiring lives in `tests/e2e/fixtures/webauthn.ts` and is invoked by the unlock fixture.

### D10. Threat-model delta (per `openspec/config.yaml` design rule)

These tests touch key material indirectly (they unlock vaults inside the browser and inspect ciphertext on the wire). The change also alters a key-handling path in production (multi-device bootstrap routing). Per the project rule, a short before/after:

| Adversary capability | Before this change | After this change |
|---|---|---|
| Server operator reads a customer doc and sees plaintext | Caught only by unit tests of `payload.ts`. A regression in `local-database` that bypassed `encryptPayloadForRxDB` would slip past CI. | Caught by E2E: `oauth-sync-roundtrip` asserts the on-wire shape through the real edge. |
| Server operator swaps ciphertext between two docs in the same vault (AAD splice) | Caught only by unit tests of `payload.ts`. | Caught by E2E: cross-device test mutates the server row and asserts the reader throws. |
| Compromised server returns a vault-state with a substituted `wrappedDekRs` to a joining device | Caught only by unit tests of `couch-vault-state.ts`. | Still caught primarily by unit tests; the E2E "wrong-RS rejected" path adds a live check that bad RS never produces a useful DEK. The new `fetchVaultStateOverHttp` does not validate the doc beyond AEAD-on-unwrap; AEAD failure on unwrap remains the gating control. |
| Hostile network downgrades to plaintext sync | Out of scope (TLS handles this) | Unchanged. |
| New: malicious server returns 200 with a hand-crafted vault-state doc to a *first*-time joining device | Could not happen — bootstrap path didn't exist. | Same threat model as `wrappedDekRs` substitution above: AEAD-on-unwrap is the gating control. The user's RS is the secret; without it, the malicious doc is inert. |

The change introduces no new attack surface in the data path: the join branch only reads, never writes. It does, however, exercise an admin-credential path against the `ci` CouchDB; that credential is `ci`-profile-only and unchanged.

## Risks / Trade-offs

- **[E2E flake from two contexts racing]** → Mitigation: the test never asserts on Device B until it has explicitly waited for `subscribeSyncEvents` on Device B to report `paused` after a `change` event for the document id Device A wrote. We do not use sleeps.
- **[Wall-clock budget creep]** → Mitigation: the four new specs share one mock-OIDC `sub` per test (no extra OAuth round-trips), and the harness reuses the existing `vaultUser` fixture under the hood. Estimated added wall-clock: 25–35 s in the `e2e` job. Re-validate after merge.
- **[Admin credential surface in tests]** → Mitigation: read from the same SOPS-decrypted env the `ci` profile already exposes; do not hardcode and do not log. Tag the helper that uses it (`adminGet`, `adminPut`) so a grep makes leakage obvious.
- **[Production join branch widens the auth-trust surface]** → Mitigation: the join-mode probe only *reads* the vault-state doc and only acts on it after the user-supplied RS successfully unwraps the DEK (AEAD-validated). A malicious server cannot inject a usable DEK without knowing the RS. We add a unit-tier test that the unwrap failure on a tampered `wrappedDekRs` propagates as a user-visible error rather than a silent fallback to "create new vault" (which would split the user's data).
- **[Virtual authenticator drift across Chrome versions]** → Mitigation: pin the CDP behavior we depend on (`addVirtualAuthenticator` with `ctap2` + `internal` + automatic user verification). If a future Chrome version changes the API, the failure mode is loud (every E2E test fails to register a passkey), not silent.
- **[New JoinVaultScreen drifts from LoginScreen recovery branch]** → Mitigation: both consume the same `decodeRsFromInput` / `parseRsInput` from `src/auth/recovery.ts`. Visual styling matches via the same CSS classes. We rely on the rule of three before any abstraction is extracted.

## Migration Plan

- Production rollout: merge → `JoinVaultScreen` is purely additive → existing single-device users are unaffected (the probe returns null, the create-vault branch runs as before).
- Test rollout: new specs run on every PR via the existing `e2e` job. If the wall-clock budget is exceeded, shard `cross-device-sync.spec.ts` into a sub-job in `.github/workflows/tests.yml`.
- Rollback: revert the change PR. No data migration, no feature flag. The vault-state doc shape is unchanged.

## Open Questions

- Should the join-mode probe also handle the case where a user has multiple OAuth identities mapped to the same vault (e.g., signed in once with Google, again with Apple)? Today: no. The probe uses the OAuth-derived `couchdbUsername`, which is per-OAuth-sub. Cross-identity bootstrap is an unrelated feature and out of scope.
- Should we emit a telemetry event when the join branch runs successfully? Not in this change. We log to console for now; structured telemetry can land with the broader observability work.
- Should the tamper test also cover `vault-state` itself (server-side mutation of `wrappedDekRs`)? Likely yes, but we scope the first iteration to user-data docs to keep PR size manageable; flag as a follow-up in tasks.md.

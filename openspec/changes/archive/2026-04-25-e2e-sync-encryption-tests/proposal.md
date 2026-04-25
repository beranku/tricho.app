## Why

The most security-critical claims TrichoApp makes — "the server only ever sees ciphertext" and "a second device can join an existing vault without leaking plaintext through the network" — are currently asserted only at the unit and component tier. The two E2E tests that were meant to cover these paths (`oauth-sync-roundtrip.spec.ts` "authenticated write appears as ciphertext on CouchDB", `offline-sync.spec.ts`) are still `test.skip`'d with TODOs blocked on a missing vault-unlock fixture. Multi-device bootstrap (`vault-state-sync` requirement #5) has unit coverage but no end-to-end verification: a regression that, for example, dropped AAD or echoed plaintext into the server doc would slip through CI today.

While drafting the test fixtures we discovered a deeper gap: the multi-device bootstrap **is not actually wired into the production UI today**. `downloadVaultState` is imported in `AppShell.tsx` but never called. A second device that signs in with the same OAuth identity gets routed to the "create new vault" branch instead of being prompted for the Recovery Secret to join the existing one. Closing this gap is a prerequisite for any honest E2E verification, so we close it inside the same change instead of stacking a follow-up.

## What Changes

**Production code (new in this revision):**
- Add a `JoinVaultScreen` React component (RS prompt only, mirrors the existing recovery-mode UX in `LoginScreen`) under `src/components/JoinVaultScreen.tsx`.
- Wire `downloadVaultState` into `AppShell.tsx`: on mount, when there is no local vault but an OAuth identity is present, attempt to fetch the per-user CouchDB `vault-state` doc via the OAuth JWT; on hit, route to `JoinVaultScreen` and unwrap the DEK locally; on miss, fall through to the existing "create vault" flow.
- Add a thin `fetchVaultStateOverHttp(username, jwt)` helper to `src/sync/couch-vault-state.ts` so the bootstrap path does not require an open PouchDB.

**Test infrastructure:**
- Configure a Playwright CDP virtual-WebAuthn authenticator so the existing passkey-registration step in `LoginScreen` completes in headless Chromium. Lives entirely in `tests/e2e/fixtures/webauthn.ts` — no production change.
- Add a two-`BrowserContext` Playwright harness (`tests/e2e/fixtures/cross-device.ts`) that simulates Device A and Device B against the same `mock-oidc` `sub`, sharing the per-user CouchDB through the real Traefik edge.
- Add an unlock fixture (`tests/e2e/fixtures/unlock.ts`) with `createVaultWithRs(page)` and `joinVaultWithRs(page, { recoverySecret })` that drive the production UI end-to-end.
- Add an admin-row-inspection helper (`tests/e2e/fixtures/admin.ts`) that reads CouchDB rows through `https://tricho.test/` using ci-profile admin credentials.

**Test specs:**
- Replace the two existing `test.skip` placeholders with real coverage:
  - `oauth-sync-roundtrip.spec.ts` "authenticated write appears as ciphertext" — assert the server row for a freshly-written customer carries an `{v, alg, kid, iv, ct}` payload and no plaintext fields.
  - `offline-sync.spec.ts` — Device A goes offline, writes a customer, comes back online; assert the encrypted doc reaches the server.
- Add a new spec `tests/e2e/cross-device-sync.spec.ts` covering: (a) Device B bootstrap via Recovery Secret reads what Device A wrote, (b) live propagation A → B and B → A, (c) tamper crosscheck: an admin-side mutation of the ciphertext on the server is rejected by the reader with an AEAD error, (d) wrong-RS path on Device B fails before any key material is exposed.

No breaking changes. The new "join vault" path is purely additive: existing single-device flows are unaffected because the route is taken only when no local vault exists *and* a server-side `vault-state` doc is present.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `e2e-testing`: adds requirements for end-to-end verification of (a) server-visible payload shape, (b) multi-device bootstrap, (c) live A↔B propagation, (d) server-side tamper rejection, (e) the two-browser-context harness convention, (f) the virtual-WebAuthn fixture as the canonical way to satisfy passkey registration in CI.
- `vault-state-sync`: adds a requirement that the client UI MUST call `downloadVaultState` (or its over-HTTP equivalent) on sign-in when no local vault exists, and route to a vault-join flow if a server-side `vault-state` doc is present. This formalises the production-side gap we close in this change.

## Impact

- Affected production code: `src/components/AppShell.tsx` (mount-time vault-state probe; new `view = 'join_vault'`; new `onJoinVault` handler), `src/components/LoginScreen.tsx` (unchanged — the join flow is a sibling component, not a new state inside LoginScreen, to keep its surface focused), `src/components/JoinVaultScreen.tsx` (new), `src/sync/couch-vault-state.ts` (new `fetchVaultStateOverHttp` helper).
- Affected test code: `tests/e2e/fixtures/{admin,unlock,cross-device,webauthn}.ts` (new), `tests/e2e/oauth-sync-roundtrip.spec.ts` and `tests/e2e/offline-sync.spec.ts` (replace skips), `tests/e2e/cross-device-sync.spec.ts` (new), component tests for the new screen and the new AppShell branch.
- Affected docs: `docs/TESTING.md` "Concrete examples to mirror" table — add row for cross-device sync.
- Affected CI: `.github/workflows/tests.yml` `e2e` job runtime budget — re-validate it still fits under the 5-min ceiling once the new specs run.
- Zero-knowledge invariants: unchanged. The new join path derives the KEK from the user-supplied RS in the browser; the server only ever returns the inert `wrappedDekRs` ciphertext. No DEK or RS crosses the wire. The bootstrap fetch carries a Bearer JWT (already trusted to authorize per-user reads) and reads exactly one document.
- Rollback: revert the change PR; no migrations, no infra changes, no schema bumps. The vault-state doc shape is unchanged.

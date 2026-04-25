## 1. Production code: multi-device bootstrap UI

- [x] 1.1 Add `fetchVaultStateOverHttp(username, jwt, fetch?)` to `src/sync/couch-vault-state.ts`. Returns `VaultStateDoc | null` (404 → null; non-404 errors throw). Uses the same `userDbUrlFor` derivation as the rest of the sync layer.
- [x] 1.2 Add `src/sync/couch-vault-state.test.ts` cases for the new helper: 200 → doc; 404 → null; 500 → throw; empty body → throw. Mock `fetch`.
- [x] 1.3 Add `src/components/JoinVaultScreen.tsx` — RS textarea, "Unlock" button, "Sign out" button, error region. Imports `decodeRsFromInput` / `parseRsInput` / `isValidRsFormat` from `src/auth/recovery.ts`. No state machine beyond `idle | unlocking | error`.
- [x] 1.4 Add `src/components/JoinVaultScreen.component.test.tsx` covering: valid-RS submit calls handler with decoded bytes; invalid-RS-format shows inline error and does not call handler; handler-throw transitions to error state; sign-out fires the sign-out callback.
- [x] 1.5 Modify `src/components/AppShell.tsx`:
  - Add `view = 'join_vault'` and `serverVaultState: VaultStateDoc | null` state.
  - In the mount `useEffect`, after the existing OAuth + listVaultStates step: if `!hasVault && incoming?.tokens?.jwt && incoming.couchdbUsername`, call `fetchVaultStateOverHttp(...)` with a 5 s timeout; on hit set `serverVaultState` and `view = 'join_vault'`; on miss/error log and fall through to existing routing.
  - Add `onJoinVault(rs)` handler that derives KEK from `rs + serverVaultState.deviceSalt`, unwraps `wrappedDekRs`, creates a local `VaultState` mirroring the server-side `vaultId + deviceSalt + wrappedDekRs`, sets `dek` and `vaultId`, then calls the existing `onUnlocked` to wire up sync.
  - Render `<JoinVaultScreen ... />` when `view === 'join_vault'`.
- [ ] 1.6 Update `src/components/AppShell.component.test.tsx` to cover: probe hit → join_vault view; probe miss → create flow; probe network error → create flow; onJoinVault success → unlocked; onJoinVault wrong-RS → stays on join_vault with error. *Deferred — the existing AppShell test is `it.todo()` placeholders gated on a fixtures buildout; deferring matches the project pattern (see `LoginScreen.component.test.tsx`). Coverage of these paths comes from the new E2E specs in §3.*
- [x] 1.7 Schema bump: `VaultStateDoc.vaultId` (additive). `uploadVaultState` now requires `vaultId` in payload; existing callers in AppShell updated. Joining devices use this to adopt the shared vaultId so payload `kid` matches.

## 2. Test infrastructure: virtual WebAuthn + admin + unlock + cross-device fixtures

- [x] 2.1 Add `tests/e2e/fixtures/webauthn.ts` exposing `attachVirtualAuthenticator(page)` and `attachVirtualAuthenticatorForContext(context)` that use `context.newCDPSession(page)` + `WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator` (`ctap2`, `internal`, `automaticPresenceSimulation: true`, `isUserVerified: true`).
- [x] 2.2 Add `tests/e2e/fixtures/admin.ts` with `adminGet(docPath)` / `adminPut(docPath, doc)` / `adminFindDocId(username, type)`. Creds resolved in order: `COUCHDB_PASSWORD` env, `COUCHDB_PASSWORD_FILE`, then `.secrets-runtime/couchdb_password` (the file `make ci` renders). URL goes through `https://tricho.test/`. Sets `User-Agent: tricho-e2e-admin`.
- [x] 2.3 Add `tests/e2e/fixtures/unlock.ts` exposing `createVaultWithRs(page, opts)`: attach virtual authenticator, inject the OAuth result into sessionStorage, navigate to `/`, drive RS-display → confirm → register-passkey through user-visible UI, return `{ user, recoverySecret }`.
- [x] 2.4 Extend `tests/e2e/fixtures/unlock.ts` with `joinVaultWithRs(page, { sub, recoverySecret })`: drive OAuth as the same `sub`, navigate to `/`, type the RS into the JoinVaultScreen textarea, submit, wait for the unlocked shell.
- [x] 2.5 Add `tests/e2e/fixtures/cross-device.ts` exposing `openTwoDevices(browser, { sub? })`: creates two `BrowserContext`s, calls `createVaultWithRs` on Device A, calls `joinVaultWithRs` on Device B with the captured RS, returns `{ deviceA, deviceB, sub, vaultId, recoverySecret, username }`. Both contexts opt in to the AppShell test bridge.
- [x] 2.6 Add `waitForSyncedDoc(page, { docId, timeoutMs? })` inside `cross-device.ts`. Subscribes to `subscribeSyncEvents` via the `__trichoE2E` bridge, resolves on a pulled-change-then-paused sequence, rejects on timeout. No sleeps.
- [x] 2.7 Add the AppShell E2E test bridge (gated on `localStorage['tricho-e2e-bridge'] === '1'`). Exposes `vaultId`, `username`, `getSyncState`, `subscribeSyncEvents`, `putCustomer`, `updateCustomer`, `getCustomer`, `listCustomers`. No test-only behavior — just stable handles by name.

## 3. Test specs: replace skips + add cross-device-sync

- [x] 3.1 Replace `test.skip('authenticated write appears as ciphertext on CouchDB', ...)` in `tests/e2e/oauth-sync-roundtrip.spec.ts` with a real test using `createVaultWithRs`. Writes a Czech-diacritic-named customer, asserts envelope shape, asserts `Eliška` substring is absent from the JSON-stringified row.
- [x] 3.2 Replace the `test.skip(...)` body in `tests/e2e/offline-sync.spec.ts` with: open Device A signed in + unlocked, `context.setOffline(true)`, write customer, assert IndexedDB persisted it, `context.setOffline(false)`, wait for sync `paused`, then `adminGet` and assert envelope shape with no plaintext.
- [x] 3.3 Create `tests/e2e/cross-device-sync.spec.ts` with a top-of-file `// TODO: PRF unlock variant of every test in this file`.
- [x] 3.4 "Device B joins via Recovery Secret and reads what Device A wrote" using `openTwoDevices`; asserts deep-equal plaintext between A and B.
- [x] 3.5 "Wrong Recovery Secret on Device B never produces a usable DEK" — drives the join flow with a flipped RS; asserts the join screen stays visible, `__trichoE2E` bridge never appears on B, and no plaintext from A is in any response body B fetched.
- [x] 3.6 "Write on A is read on B" and "Write on B is read on A" using `waitForSyncedDoc` for both directions. No sleeps.
- [x] 3.7 "Flipped ciphertext byte produces an AEAD error on Device B" — `adminGet` the row, flip one base64url byte of `payload.ct`, `adminPut` with bumped `_rev`, trigger Device B sync, assert tampered customer never surfaces with original plaintext and the decrypt error reaches the console / throws on listCustomers.

## 4. Documentation + verification

- [x] 4.1 Added `Cross-device sync with RS bootstrap → tests/e2e/cross-device-sync.spec.ts` to the "Concrete examples to mirror" table in `docs/TESTING.md`.
- [x] 4.2 Added `JoinVaultScreen renders + RS submit wiring → src/components/JoinVaultScreen.component.test.tsx` plus rows for the virtual-WebAuthn and admin fixtures to the same table.
- [x] 4.3 Ran `npm test`: 459 tests across 40 files, all green, no regression. (383 unit + 76 component.)
- [ ] 4.4 Run `npm run test:e2e` against the `ci` profile end-to-end. *Local run blocked: this host's `/etc/hosts` lacks `127.0.0.1 tricho.test` (the Makefile guard refuses without it; needs sudo).* The PR author MUST run `make e2e` once `/etc/hosts` is set, capture wall-clock, and put it in the PR description so reviewers can confirm the < 5-min CI ceiling still holds. CI itself adds the entry inside the runner; this gap is host-only.
- [ ] 4.5 If wall-clock exceeds the ceiling, shard `cross-device-sync.spec.ts` into a sub-job in `.github/workflows/tests.yml` (additive — do not move other specs).

## 5. Follow-ups (open as separate change after this one ships)

- [ ] 5.1 File a follow-up: extend the tamper test to also cover server-side mutation of `vault-state.wrappedDekRs` (cross-check on the second-device bootstrap path). Out of scope for this change to keep PR size manageable.
- [ ] 5.2 File a follow-up: add a passkey-PRF variant of the cross-device suite once the WebAuthn virtual-authenticator harness reliably emits PRF results.
- [ ] 5.3 File a follow-up: wire `src/auth/local-pin.ts` into `LoginScreen` as a daily-unlock fallback for non-PRF authenticators, with its own E2E coverage.

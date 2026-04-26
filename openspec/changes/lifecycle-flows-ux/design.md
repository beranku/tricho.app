## Context

The app's primary onboarding (welcome wizard) was rebuilt recently and looks polished. Underneath that surface, the post-onboarding lifecycle is a graveyard of half-finished components and dead code paths:

- `RestoreFromZipScreen` exists with a `view: 'restore-zip'` enum entry but **no `setView('restore-zip')` call anywhere** — it is impossible to reach.
- `RenewBanner` is fully implemented but never imported into the unlocked shell.
- `PinSetupScreen` is implemented and tested but `AppShell` never mounts it; the entire local-pin-fallback capability is dead in the UI.
- `DeviceLimitScreen` (the full version, with revoke list and OAuth context) is only used inside `SettingsScreen`. The pre-unlock device-limit gate in `AppShell` (lines ~600–620) renders a stripped-down placeholder with raw inline styles and a single "sign in again" button.
- `SettingsScreen` "Rotovat Recovery Secret" generates a fresh RS, wraps the DEK with it, persists the wrap — and **never shows the RS to the user**. The very next time the user is on a new device or loses their passkey, they have a vault that can only be opened by an RS they have never seen. This is the kind of bug that leaves people with permanently inaccessible data.
- `MenuSheet`'s "Logout" calls `window.location.reload()`. This wipes ephemeral memory but leaves the IndexedDB keystore + cached OAuth result + sync state machine in their previous state; on reload, the user sees `UnlockGate`, which is technically correct but feels nothing like "logging out".
- The `UnlockGate` daily-unlock surface uses i18n keys named `wizard_step3_existing_qr_*` because the original "join existing vault" copy happened to be reusable. Reading the source after the wizard refactor, every one of these strings is mis-named for its current meaning.
- `IdleLock` clears the DEK and switches `view` to `'welcome'`, which then routes through the same logic as a brand-new user — except `hasExistingVault` is true, so `UnlockGate` renders. The user sees their wordmark briefly, then the wordmark is replaced by the unlock surface, and the day-divider header from the schedule view is gone. Continuity is lost; the app feels like it forgot them.

Stakeholders: the practitioner (single hairdresser/trichologist) running this on an iPad in a salon. They are not technical. They will not save the Recovery QR if the app does not insist. They will press the "Rotovat" button if it looks important, even if they do not need to. They will lose the iPad and need to set up the next one quickly with their existing data.

The architectural constraints from `openspec/project.md` are non-negotiable: the server sees ciphertext + OAuth identity only; AAD binds every payload to `{vaultId, docId}`; the Recovery Secret is the offline fallback and never touches the server. Every decision below is checked against those.

## Goals / Non-Goals

**Goals:**

1. Every screen and component already in `src/components/` has a real entry point or is removed. No dead code paths.
2. The locked screen, the welcome wizard, and the unlocked shell share visual identity (Fraunces serif headings, ballpoint copper accent on success states, Geist sans for body, the same paper-grain texture). A user moving between them does not feel they switched apps.
3. **Recovery Secret rotation is impossible to complete without seeing and confirming the new RS.** This is a correctness fix, not a UX nicety; ships unconditionally.
4. Adding a second device works in three steps from the second device: install → sign in with the same provider → either scan the saved QR or type the Base32. Sync progress is visible; the user knows when it's safe to start using the new device.
5. Plan upgrade and renewal nudges appear at the right moments — before expiry, during grace, and at the device-limit prompt — without ever blocking access to local data.
6. Account deletion is a real flow that fulfils the User Guide's already-published promise.
7. The PIN fallback path works end-to-end: registration on a non-PRF authenticator → daily PIN unlock → optional later upgrade to a PRF passkey.
8. Czech voice is honest and warm. No "passkey not found" / "vault state probe failed"-style raw error strings reach the user.

**Non-Goals:**

- Server-side changes beyond the new `POST /auth/account/delete` endpoint and the optional `?with-progress=1` parameter on `GET /auth/devices`.
- Touching the welcome wizard's reducer in any way that breaks its invariants (one-way step transitions, browser-mode hard-stop, PWA detection on every mount).
- Touching the cryptographic envelope (`src/crypto/envelope.ts`, `src/crypto/payload.ts`) or the keystore wrap formats. All wraps continue to be `wrappedDekRs`, `wrappedDekPrf`, `wrappedDekPin` with their existing semantics.
- Multi-language design beyond Czech (cs) and English (en) — adding more locales remains a separate concern.
- Sync-protocol changes. `couch-vault-state.ts`, `couch.ts`, `couch-auth.ts` keep their wire format and invariants.
- Reworking the daily-schedule, client-detail, or camera-card islands. This change touches *around* them, not inside them.

## Decisions

### D1. The locked screen is a top-level `AppShell` view, not a modal

**Decision:** Add `'locked'` to the `View` enum in `AppShell.tsx`. `IdleLock.onLock` calls `setView('locked')` instead of `setView('welcome')`. The locked view renders a new `LockedScreen` component that uses the same brand wordmark + paper grain background as the welcome wizard but with a single, calm unlock affordance (passkey biometric tap, PIN field, or RS-secret reveal).

**Alternatives considered:**

- *Modal overlay over the unlocked shell.* Rejected: the unlocked shell holds an open `VaultDb` and the in-memory DEK; an idle-lock that didn't actually clear those would defeat the purpose of an idle lock. The modal approach would need to fake a clear, which is worse than honestly clearing.
- *Keep `setView('welcome')` but render a different sub-view inside `WelcomeScreen` when a vault exists.* Rejected: `WelcomeScreen` is supposed to be exclusively the onboarding wizard per the existing `welcome-onboarding-wizard` spec, which says "the application's pre-unlock surface MUST be a single React island, `<WelcomeScreen>`, mounted from `src/pages/index.astro` whenever no vault is unlocked". Returning users with an unlocked-then-locked vault are a *different* flow — they already have a vault — and giving them their own view keeps both surfaces single-purpose.

**Why this is right:** the user's mental model is "the app is locked, not the app forgot me". A dedicated view named `locked` enforces that mental model in the routing.

### D2. The wizard's `flow` enum gains `restore-zip`; the reducer's invariants are preserved

**Decision:** Extend `Flow` in `src/components/welcome/wizard-state.ts` from `'new' | 'existing'` to `'new' | 'existing' | 'restore-zip'`. The Step 3 substep enum gains `'pick-zip'` and `'pin-setup'`. The reducer's three invariants (PWA-storage-origin floor, one-way `currentStep` transitions, `SET_FLOW` only valid on entry to Step 3) stay verbatim; new substeps slot into the existing `ADVANCE_SUBSTEP` / `BACK_SUBSTEP` validators.

**Alternatives considered:**

- *Make ZIP restore a separate top-level flow outside the wizard.* Rejected: the user always enters via the same install + sign-in steps regardless of whether they're new, joining, or restoring. Diverging at Step 3 keeps the surface coherent.
- *Auto-select `restore-zip` from the server probe (analogous to how `existing` is auto-selected today).* Rejected: there is no server-side signal that the user wants ZIP restore over RS-typed restore. The flow is user-chosen at the start of Step 3 via a small radio between "Mám Recovery klíč" and "Mám zálohovací ZIP soubor".

**Threat-model delta:** none. ZIP restore is a local-bytes-as-is path that already exists (`src/backup/local-zip-restore.ts`). The user still must produce the Recovery Secret to unwrap the DEK after the local docs are written; the ZIP itself is the doc payload, not a key.

### D3. RS rotation reuses the wizard's Step 3 substeps wholesale

**Decision:** Extract `Step3DownloadQr` + `Step3VerifyInput` into reusable presentational components (they already are nearly so). The new `RotateRecoverySecret` component composes them with a "commit" handler that, after checksum confirmation, calls a new `commitRotatedRs(rs)` primitive that (a) wraps the in-memory DEK with a KEK derived from the new RS, (b) writes the new `wrappedDekRs` with `version` incremented, (c) uploads the new `vault-state` doc to CouchDB, and (d) only then deletes the old wrap from the KeyStore. Steps (b)–(d) happen atomically: either all three succeed or none change on-disk state.

**Alternatives considered:**

- *Separate component tree for rotation.* Rejected: divergence guarantees drift between onboarding and rotation paths.
- *Two-phase wrap with a "pending" flag.* Considered, rejected as overkill: the wrap operation is a single IndexedDB transaction; failure modes are limited to (a) IndexedDB write fails (atomicity preserved by the transaction) and (b) network upload fails (the local KeyStore takes priority; sync will retry). A `pending` flag would only help if a rotation could be partially applied across the device + server boundary, which it cannot — server-side `vault-state` is informational for second-device join, not authoritative.

**Why this is right:** the bug being fixed is a missing UI step, not a wrong primitive. The cryptographic primitive (`onWrapDekWithRs`) is correct; we are wrapping it in the same human gate the user already understands from onboarding.

### D4. Device-limit is one screen with two backends, not two screens

**Decision:** `DeviceLimitScreen` accepts either a `tokenStore: TokenStore` (post-unlock, today's behaviour) or an OAuth-bound JWT (`oauthJwt: string`, pre-unlock). Both paths use the same `fetchDevices` and `revokeDevice` calls. The pre-unlock entry replaces the inline placeholder in `AppShell` (the `view === 'device-limit'` branch with the hand-rolled `<div>` and inline `style={{}}`).

**Alternatives considered:**

- *Two specialised components.* Rejected: the differences are 5 lines of conditional auth-header construction; duplicating 200 lines of layout for that is silly.
- *A pre-unlock "lite" version that just lists devices without revoke.* Rejected: the entire point of hitting the limit is being able to revoke from this surface.

### D5. Mid-flight `gated` is a sheet, not a full-screen takeover

**Decision:** When the sync state machine flips to `gated` while `view === 'unlocked'`, instead of forcibly switching to `view: 'plan'`, render a new `GatedSheet` at the bottom of the unlocked shell. The sheet is dismissible to "Pokračovat offline"; tapping "Obnovit" routes to the plan picker. Crucially: the user can still finish the appointment they're recording. Closing the sheet leaves them on the schedule.

**Alternatives considered:**

- *Keep current full-screen behaviour.* Rejected: a practitioner mid-appointment, capturing a before/after photo for their client, does not need to be ripped to a payment flow. Their data is local-first; sync can wait. The current behaviour treats sync interruption as a hard failure when it is in fact a soft one.

**Risk:** users who never re-open the sheet drift further from paying. Mitigation: `RenewBanner` continues to surface in the schedule header; the sheet auto-reopens on the next app launch until the gate is resolved.

### D6. Wipe-on-logout is a single primitive, not scattered cleanup calls

**Decision:** Introduce `wipeSession(): Promise<void>` in a new `src/lib/lifecycle.ts`. Its job: stop sync, dispose `tokenStore`, close PouchDB, clear in-memory `dek`/`vaultId`/`pendingOAuth`, drop sessionStorage entries. Called from logout *and* from "delete account" (the latter additionally deletes the `tricho_keystore` row and the per-vault PouchDB). All cleanup paths route through this function so we do not forget one in five places.

**Alternatives considered:**

- *Continue with `window.location.reload()`.* Rejected: a hard reload re-runs OAuth-callback parsing, which can re-route to device-limit or re-stash a stale `pending-oauth` from sessionStorage if the URL hash hasn't been cleared. Logout should be predictable and silent; a reload is neither.

### D7. Device names are plaintext on the device list, treated like `lastSeenAt`

**Decision:** Device names are user-typed strings stored alongside `lastSeenAt` in the server-side device record. They are visible to the server. They are not encrypted. They do not appear inside any `payload`.

**Alternatives considered:**

- *Encrypt the device name with the vault DEK.* Rejected: the device list is fetched *before* the vault is unlocked (when hitting the device-limit gate) — at which point the DEK is unavailable. We could hold an encrypted name and decrypt it post-unlock, but the value of "show me which device this is" is precisely highest at the pre-unlock gate.
- *Make device names mandatory at registration.* Rejected: adds friction for the brand-new-vault flow where the user is the only device. Default to `${browserFamily} on ${platform}` (e.g. "Safari on iPhone") and let the user override.

**Threat-model delta:** the server gains a small piece of plaintext metadata per device. An attacker who compromises the server can already enumerate device IDs and `lastSeenAt`; adding a name does not meaningfully increase the attacker's signal — they could already correlate two devices belonging to one user via OAuth identity. The user's typed name *could* leak salon identity ("Salon Petra — iPad"), which is a soft leak comparable to the OAuth email already on the server. Document this in `account-lifecycle` spec; do not pretend it is encrypted.

### D8. PIN setup is a Step 3 terminal substep, gated on a registration feedback signal

**Decision:** `registerPasskey` already returns `{ credentialId, prfSupported, prfOutput }` (`src/auth/webauthn.ts`). The wizard Step 3 webauthn substep, after a successful registration, checks `prfSupported`. If false, the substep does not call `onCompleted()` directly — it dispatches `ADVANCE_SUBSTEP: 'pin-setup'`. The `pin-setup` substep mounts `PinSetupScreen` in `mode: 'setup'`; on successful submit, the DEK is wrapped with a PBKDF2-derived KEK and stored as `wrappedDekPin` + `pinSalt`. *Only then* does the wizard call `onCompleted()`.

**Alternatives considered:**

- *Detect lack of PRF up front and skip Step 3 substeps entirely for non-PRF devices.* Rejected: PRF support is an authenticator-not-platform attribute and cannot be reliably detected before `navigator.credentials.create` runs. The post-registration check is the only honest signal.
- *Always require a PIN, even on PRF devices, as a "second factor".* Rejected: this is a single-user salon CRM; a PIN on top of biometrics is friction without security gain.

### D9. The wizard fork between `flow="existing"` and `flow="restore-zip"` is a small radio at the top of Step 3

**Decision:** When entering Step 3 with `hasServerVaultState === true`, default `flow` to `'existing'` but render a small linked-text affordance: "Nemám Recovery klíč, ale mám zálohovací ZIP". Clicking it dispatches `SET_FLOW: 'restore-zip'`. The reverse switch ("mám Recovery klíč") is also offered until any decoding actually starts. Once a `pick-zip` or `qr` substep has been engaged with input, the switch disappears (matches the existing rule that flow can only be set once meaningfully).

**Alternatives considered:**

- *Three big buttons up front.* Rejected: 99% of users go through `flow="existing"` with the QR; defaulting to it and offering the alternative is the right calibration.

### D10. Czech voice with a copper hand-drawn sun on success states

**Decision:** New copy lives in `src/i18n/messages/cs.json` and `en.json`. Czech is authoritative; English is faithful translation. Tone: warm, second-person singular ("ty", not "vy"), no jargon. Examples:

- Unlock: "Vítej zpět." not "Unlock vault"
- Locked-by-idle: "Pauza skončila? Klepni a jsme zpět." not "Session timed out"
- RS rotation success: "Hotovo. Tvůj nový klíč je tenhle —" not "Recovery secret rotated successfully"
- Account delete confirmation: "Smazat všechno trvale. Napiš `SMAZAT` pro potvrzení."

Each terminal success state (RS rotation done, second device joined, account restored, plan upgraded) renders a small ballpoint copper sun glyph for 800ms, fading to the next surface. The sun is the shared brand mark from the schedule view's "today" header — using it as the universal "this happened" mark is the character the brief asks for.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Adding a `flow="restore-zip"` branch to a tightly tested wizard reducer could regress existing transitions | Reducer changes are additive (new actions are no-ops for existing states); existing test suite (`wizard-state.test.ts`) runs unchanged and gains scenarios for the new flow |
| The pre-unlock `DeviceLimitScreen` needs to call `fetchDevices` before any vault is open. The current `fetchDevices` signature takes a JWT, which we already have on the OAuth callback result. So no data-flow risk — but adding "this device" annotation requires comparing to a `localDeviceId` we don't have pre-unlock | Use the OAuth-callback `incoming.deviceId` as the local identifier; pass it explicitly to `DeviceLimitScreen` as a prop |
| Wiring the PIN setup into the wizard's terminal substep means the wizard now has two terminal states (`webauthn` for PRF devices, `pin-setup` for non-PRF). Adds a branching surface to the spec | Spec scenarios cover both; reducer test exercises both |
| `wipeSession` must close PouchDB cleanly, otherwise the next vault open hits "DB is already in use" | The `closeVaultDb` helper already handles this; `wipeSession` calls it and `await`s before resetting React state |
| Mid-flight `gated` sheet means the user could keep working after expiry. Their data is local-only at that point — but they may not realise sync is paused | The `RenewBanner` stays visible; `SyncStatus` shows orange "gated"; the gated sheet auto-reopens on the next launch |
| Adding `POST /auth/account/delete` is a destructive endpoint. A bug or replay attack could nuke an account | Endpoint requires (a) a fresh JWT (`iat` within 5 minutes), (b) a typed-confirmation token returned from `POST /auth/account/delete-confirm` that itself requires a fresh JWT. Two-step makes accidental deletion essentially impossible |
| The Czech copy is opinionated. Future translators may disagree | Copy is treated as a brand asset, not a generic message catalog; cs.json is authoritative and reviewed by Honza |
| Some users will rotate their RS expecting the old RS to keep working as a "second key". They will be surprised when only the new one works | Add an inline explainer in the rotation surface: "Stará Recovery klíč přestane fungovat hned, jak potvrdíš tu novou." |

## Migration Plan

This is a pre-launch refactor, not a deployed-data migration. There is no production data, no users to migrate, and no rollout sequencing to manage.

Internally:

1. Land the proposal + design + tasks (`/opsx:propose` output, this document).
2. Implement in tasks order. Each task is independently mergeable; failing CI on one does not block the others.
3. On the way through, delete dead code (the inline placeholder in `AppShell` for device-limit, the unused `wizard_step3_existing_qr_*` keys after locked-screen migration finishes consuming them). The simplify pass at the end of tasks.md handles removal.
4. After all tasks land: full Playwright run over `e2e-testing` and `e2e-sync-encryption-tests` to confirm no regression in the primary flows.
5. **Rollback:** the `lifecycle-flows-ux` env flag (`VITE_LIFECYCLE_FLOWS_UX`) gates the new screens. Setting it to `false` restores the prior code paths *except* for D3 (RS rotation correctness fix), which ships unconditionally because the prior behaviour is a defect.

Pre-launch we do not need staged rollout. If we discover a critical bug after launch, the env flag rolls back nine of the ten changes; the tenth (D3) is correct in both states because the new flow is strictly more secure than the old.

## Open Questions

1. Does the `tricho-auth` server need a new endpoint for the device-name field, or do we just send it in the existing `POST /auth/devices/register` body? (Lean: the latter; field is optional and has a server-side default of `${browserFamily} on ${platform}`.)
2. Should the "Show Recovery Secret" surface in Settings allow re-rendering the original QR exactly (preserving it byte-for-byte) or render a fresh QR from the same RS bytes (which would have identical payload but possibly different bitmap layout)? (Lean: fresh QR; the payload is what matters, scanners are tolerant of bitmap variation.)
3. The copper sun glyph used as the universal success mark — does it scale well at 24 px without losing the ballpoint character? (Action: design check before T-final.)
4. The `?with-progress=1` parameter on `GET /auth/devices` returns initial replication checkpoint info. Is "checkpoint info" the right shape, or do we want `{pulled: number, expected: number}`? (Lean: explicit fields; checkpoint is server-internal.)

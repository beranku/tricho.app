## Why

Onboarding has been polished into a tight three-step PWA-first wizard. Everything **after** that — daily unlock, locked screen, adding a second device, restoring from a `.tricho-backup.zip`, viewing the Recovery Secret again, rotating it, hitting the device limit, upgrading the plan, account deletion, OAuth/sync errors — has grown organically into a patchwork of half-wired components. Several screens (`PinSetupScreen`, `RestoreFromZipScreen`, `RenewBanner`, `DeviceLimitScreen` with revoke list) are present in the repository but unreachable from any UI entry point; one (`SettingsScreen` Recovery Secret rotation) is *worse* than unreachable — it silently rotates the user's last-resort recovery code without ever showing them the new value, making them more locked out, not less. We are pre-launch and can refactor freely; this is the moment to give the secondary flows the same craftsmanship as the primary onboarding so the app feels coherent end-to-end.

The brand brief calls for character: ballpoint copper accents on a few hero moments, Fraunces serifs on greetings, an honest Czech voice that demystifies E2E encryption without being scary. Today the secondary surfaces use generic system-blue buttons, English-flavoured terms ("vault", "passkey"), inline `style={{}}` blocks that bypass the design tokens, and copy strings repurposed from unrelated wizard steps (the unlock screen reuses `wizard_step3_existing_qr_*` keys whose name no longer matches the meaning). We can fix all of this in one focused, scoped pass without touching the zero-knowledge invariants.

## What Changes

### Pre-unlock surface — recovery hub
- **NEW** Welcome wizard adds a fourth top-level branch: **`flow="restore-zip"`** for users who have a `.tricho-backup.zip` but no working device and no usable Recovery Secret transcription. Routes through Step 3-substep `pick-zip` → `verify-rs` → `webauthn`. The substep ordering reuses the same one-way state machine as `flow="new"`.
- **NEW** `flow="existing"` Step 3 adds a confidence panel after RS unwrap: "Po dokončení uvidíš X klientů a Y fotek z Y_total" so the user knows sync is in flight before they open the app.
- **MODIFIED** Step 3 webauthn substep accepts an optional **device-name** input ("Tento iPhone — *honzův*"). The name is sent with the device-registration call so the future devices list is meaningful.
- **MODIFIED** Browser-mode Step 1 post-install warning gets a stronger iOS-specific reminder ("Aplikaci teď otevři z plochy — ne z prohlížeče") and a "I'm stuck" expander with the three known iOS pitfalls.
- **MODIFIED** OAuth callback errors propagate visually: when `OAuthResult.error` is set, the wizard renders an inline copper-bordered error card on Step 2 instead of silently dropping back to the start.

### Daily unlock — locked screen as a real screen
- **NEW** Dedicated **`view: 'locked'`** in `AppShell`, shown by `IdleLock.onLock` instead of the current "wipe back to welcome" behavior. The screen carries the brand wordmark, a one-tap biometric button, and a quiet recovery-secret link. Memory state stays cleared (no DEK, no tokens), but the user sees their app, not a stranger's onboarding.
- **MODIFIED** `UnlockGate` renamed conceptually into the new locked screen and re-keyed against new `lock_*` i18n strings (no longer recycling `wizard_step3_existing_qr_*`).
- **NEW** When a vault has no PRF wrap but has a **PIN** wrap (`wrappedDekPin`), the locked screen renders the PIN input as the primary path with the Recovery Secret link as a secondary fallback.

### PIN fallback — wired, not orphaned
- **MODIFIED** `OnboardingWizard` Step 3 webauthn substep, after `registerPasskey`, inspects the registration result: if `prfSupported === false`, the wizard pivots to a **`pin-setup`** terminal substep before the final card. The user sets a 4–32 char PIN, the DEK is wrapped under it, and unlock is now PIN-first. PRF-supporting devices skip the substep entirely.
- **MODIFIED** Settings exposes "Nastavit / změnit PIN" (visible only when WebAuthn is unavailable or registration didn't return PRF). Adding a PIN later goes through the same `PinSetupScreen` component.

### Adding 2nd / 3rd device
- **MODIFIED** `DeviceLimitScreen` (full version, with the revoke list) is reachable both pre-unlock and from Settings. Pre-unlock variant uses the OAuth-bound JWT directly (already returned in `incoming.tokens`) without needing a `tokenStore`. The current minimal placeholder in `AppShell` is replaced.
- **MODIFIED** `DeviceLimitScreen` adds an **"Upgradnout místo revokace"** path that flows directly into the plan picker, returning to device-limit with the new `deviceLimit` after the upgrade succeeds.
- **NEW** Sync gives **second-device join progress**: the existing `SyncStatus` is augmented with `pulled` vs. `expected` while the first replication is in flight, so the user sees "Stahuji 47 / 312" instead of an indefinite spinner.
- **MODIFIED** Device list entries gain a friendly `name` (set at registration; defaults to `${browser} on ${platform}`) and **"toto je toto zařízení"** badge, so revoking the wrong device becomes hard.

### Plan upgrade & renewal walkthrough
- **MODIFIED** `RenewBanner` is wired into the unlocked shell (currently dead code). It renders inside the daily-schedule header for the last 7 days before `paidUntil` and through the grace window. Tap → `PlanScreen`.
- **NEW** **Mid-flight gating UX**: when the sync state machine flips to `gated` while the user is mid-task, an opaque-but-non-modal overlay sheet appears explaining ("Předplatné vypršelo — tvá data zůstávají v zařízení; synchronizace se obnoví hned po obnovení") with two buttons: "Obnovit" (→ plan picker) and "Pokračovat offline" (→ dismiss, keep working locally). Replaces the current behavior of forcibly switching `view` to `plan`.
- **NEW** Pre-OAuth **plan-preview** card on welcome wizard (between brand wordmark and Step 1): "Free pro jeden iPad navždy · Pro pro 2 zařízení a cloud zálohy". Card is read-only; choosing a plan still happens after sign-in.

### Recovery Secret — viewer, rotation, confirm
- **CRITICAL FIX** Settings → "Rotovat Recovery Secret" today silently overwrites the on-disk RS wrap *without showing the new RS to the user*. After this change, rotation flows through the same `Step3DownloadQr` + `Step3VerifyInput` substeps as initial onboarding: generate, show QR + Base32, require checksum re-entry, and *only then* commit the new wrap and discard the old one. Cancellation at any point leaves the old RS in place.
- **NEW** Settings → "Zobrazit Recovery Secret" — gated on a fresh biometric assertion (not the cached unlock). Re-renders the existing QR + Base32 from the in-memory DEK; never leaves the device.
- **NEW** Settings → "Stáhnout zálohovací ZIP teď" — entry point into the existing `BackupExportScreen` (currently only reachable from the plan screen via the optional `onOpenBackupExport` prop).

### Settings — completeness pass
- **NEW** "Odhlásit" runs a real `wipeSession()`: closes PouchDB, clears `tokenStore`, drops `pendingOAuth`, drops `vaultId` from React state, then sets `view='welcome'`. No `window.location.reload()`.
- **NEW** "Trvale smazat účet" — typed confirmation modal ("napiš `SMAZAT`"), revokes the server-side identity (`POST /auth/account/delete`), wipes IndexedDB (`tricho_keystore`, `tricho_meta`, `userdb-*`), then routes back to welcome. Implements the User Guide's existing promise.
- **NEW** "Naposledy zálohováno: 12 dní" indicator + amber dot if > 30 days, linking to the local backup export screen.

### Sync state — actionable, not decorative
- **MODIFIED** `SyncStatus` `error` state shows a "Tap to retry" affordance and a humanised reason (network / auth / vault-mismatch / unknown), not the raw error string.
- **MODIFIED** `error` and `gated` are routed to a single visible status row inside the unlocked shell so the user always sees them; today they are buried inside Settings.

## Capabilities

### New Capabilities

- `locked-screen`: Dedicated post-idle-lock surface that holds the brand identity while the vault is sealed. Owns biometric / PIN / RS unlock paths, error messaging, and the "your app, not a stranger's" continuity contract.
- `restore-from-local-zip`: First-class restore path for users who have a `.tricho-backup.zip` and want to recreate a vault from it. Reachable from the welcome wizard pre-unlock and from settings post-unlock; reuses `restoreFromZipBytes` and the shared ZIP byte format.
- `account-lifecycle`: Account deletion + re-authentication flows. Owns the typed-confirmation gate, the server-side identity revocation handshake, and the IndexedDB wipe. Includes the `wipeSession` primitive for clean logout.
- `device-management`: Device naming at registration, the friendly name in the list, "this device" badge, the upgrade-instead-of-revoke ramp from `DeviceLimitScreen`, and the sync-progress feedback during second-device first replication.
- `plan-renewal-walkthrough`: Renewal banner placement, mid-flight `gated` overlay, pre-OAuth plan preview, and the upgrade hand-off from device-limit. Owns *when and where* renewal nudges appear; the plan catalog and entitlement checks remain in `billing-plans`.

### Modified Capabilities

- `welcome-onboarding-wizard`: Adds the `flow="restore-zip"` branch, the `pin-setup` terminal substep, the device-name input, the OAuth-error inline card, and the pre-OAuth plan-preview card. The reducer's invariants (one-way step transitions, browser-mode hard-stop) are preserved verbatim.
- `recovery-secret`: Tightens the rotation requirement so rotation MUST go through the same generate→display→checksum-confirm gate as initial creation, and adds a "view current RS" requirement that demands a fresh authenticator assertion (not a cached DEK).
- `local-pin-fallback`: Wires the PIN setup substep into the wizard and adds the unlock-with-PIN scenario on the locked screen. Registration-time PRF detection becomes the trigger.
- `passkey-prf-unlock`: Daily unlock surface moves from the wizard's `UnlockGate` to the new `locked-screen` capability; no crypto changes.

## Impact

- **Code**:
  - `src/components/AppShell.tsx` — adds `'locked'`, `'plan-preview'`, `'account-delete'` views; replaces minimal device-limit stub with full `DeviceLimitScreen`; wires `wipeSession`.
  - `src/components/welcome/` — new substep components (`Step3PickZip`, `Step3PinSetup`, `Step3DeviceName`); modifies `wizard-state.ts` reducer to add the new transitions.
  - `src/components/LockedScreen.tsx` (new) — replaces the `UnlockGate` daily-use path.
  - `src/components/RotateRecoverySecret.tsx` (new) — wraps the existing Step3 substeps for in-app rotation.
  - `src/components/SettingsScreen.tsx` — adds "Show RS", "Set PIN", "Last backup", "Logout", "Delete account" entries; removes silent rotation.
  - `src/components/RenewBanner.tsx` — wired into `UnlockedShell`.
  - `src/components/SyncStatus.tsx` — humanised error states with retry CTA.
  - `src/sync/couch.ts` — surfaces `pulled / expected` during initial replication of an existing vault.
  - `src/auth/oauth.ts` — propagates server-side identity-deletion endpoint.
  - `src/i18n/messages/{cs,en}.json` — ~60 new keys; deprecates the recycled `wizard_step3_existing_qr_*` keys on the unlock surface in favour of new `lock_*` keys.
- **Server**:
  - `tricho-auth` exposes `POST /auth/account/delete` (revokes refresh tokens, deletes `subscription:*` doc, deletes per-user CouchDB account). Idempotent.
  - `GET /auth/devices` already exists; gains an optional `?with-progress=1` mode that returns initial replication checkpoint info for the new sync-progress UI.
- **Zero-knowledge invariants**: unchanged. No new plaintext field reaches the server. The device `name` is sensitive only to the user and stored as a plaintext field on the existing device-list response — same trust level as `lastSeenAt` and `addedAt`. Local backup ZIP path is bytes-as-is (no decrypt). Recovery Secret never leaves the device.
- **Rollback**: each modification is gated behind a feature flag `lifecycle-flows-ux` in `import.meta.env`. Disabling restores the current behavior except for the rotation fix, which is a pure correctness change and SHALL ship unconditionally.

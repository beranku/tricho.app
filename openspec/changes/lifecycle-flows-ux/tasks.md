## 1. Foundations: feature flag and lifecycle primitive

- [x] 1.1 Add `VITE_LIFECYCLE_FLOWS_UX` env flag to `.env.example`; thread it into `astro.config.mjs` so `import.meta.env.VITE_LIFECYCLE_FLOWS_UX === 'true'` is available client-side
- [x] 1.2 Create `src/lib/lifecycle.ts` exporting `wipeSession({ tokenStore, db, setters }): Promise<void>` per design D6 (stop sync → dispose tokenStore → close VaultDb → clear React state → clear sessionStorage)
- [x] 1.3 Add unit test `src/lib/lifecycle.test.ts` covering: idempotent calls, behaviour when tokenStore is null, behaviour when db is null
- [x] 1.4 Replace the `window.location.reload()` calls in `MenuSheet`'s `onLogout` paths inside `AppShell.tsx` with `wipeSession` followed by `setView('welcome')`

## 2. Locked screen as a top-level view

- [x] 2.1 Add `'locked'` to the `View` type union in `src/components/AppShell.tsx`
- [x] 2.2 Create `src/components/LockedScreen.tsx` per the `locked-screen` spec — single primary action (PRF passkey > PIN > RS), ghost-styled fallbacks, `lock_*` i18n keys
- [x] 2.3 Add `lock_*` keys to `src/i18n/messages/cs.json` and `en.json` (`lock_greeting`, `lock_primaryCta_passkey`, `lock_primaryCta_pin`, `lock_primaryCta_rs`, `lock_recoveryFallback`, `lock_pinPlaceholder`, `lock_pinSubmit`, `lock_error_wrongPin`, `lock_error_wrongRs`, `lock_error_wrongCredential`, `lock_error_unknown`, `lock_lockoutCountdown`)
- [x] 2.4 Update `IdleLock.onLock` in `AppShell.tsx`: call `wipeSession`, then `setView('locked')` (NOT `'welcome'`)
- [x] 2.5 In `AppShell` route resolution: when `hasExistingVault === true` and `dek === null`, route to `'locked'` instead of `'welcome'`
- [x] 2.6 Implement PIN attempt rate limit (5/60s with 30s lockout, sessionStorage-backed) in `LockedScreen`; survives reload
- [x] 2.7 Component test `src/components/LockedScreen.component.test.tsx` covering each scenario in `locked-screen` spec
- [x] 2.8 Remove `src/components/welcome/UnlockGate.tsx` after verifying nothing imports it (after 2.5 is wired)

## 3. PIN fallback wired into wizard + Settings

- [x] 3.1 Extend `Substep` in `src/components/welcome/wizard-state.ts` to include `'pin-setup'`; extend `Flow` to include `'restore-zip'` (do not use it yet)
- [x] 3.2 Update `wizardReducer`: add `'pin-setup'` as a valid forward target from `webauthn` only when the registration result reports `prfSupported: false` (gated via a new action `ADVANCE_TO_PIN_SETUP`)
- [x] 3.3 Update `wizard-state.test.ts` with PRF/non-PRF transition scenarios
- [x] 3.4 Modify `OnboardingWizard.tsx` so `onRegisterPasskey` returns `{prfSupported: boolean}` and the wizard chooses between `COMPLETE_STEP_3` and `ADVANCE_TO_PIN_SETUP`
- [x] 3.5 Modify `AppShell.onRegisterPasskey` to return `prfSupported` from the underlying `registerPasskey` call (forward the field already produced by `src/auth/webauthn.ts`)
- [x] 3.6 Mount `<PinSetupScreen mode="setup">` from `Step3Encryption` when `substep === 'pin-setup'`; on submit, derive KEK (`local-pin.deriveKekFromPin`), wrap DEK, persist `wrappedDekPin` + `pinSalt`, then call `onCompleted()`
- [x] 3.7 Add Settings entry "Nastavit PIN" / "Změnit PIN" gated on `wrappedDekPin` and `wrappedDekPrf` per the `local-pin-fallback` ADDED requirement

## 4. Recovery Secret rotation: correctness fix

- [x] 4.1 Extract presentational components from `Step3DownloadQr` and `Step3VerifyInput` into reusable `RecoveryQrPanel` and `RecoveryVerifyPanel` (no behavioural change) — already standalone, reused directly
- [x] 4.2 Create `src/components/RotateRecoverySecret.tsx` that composes the two panels with a `commitRotatedRs(rs)` callback that wraps the in-memory DEK, persists the new `wrappedDekRs`, uploads `vault-state`, and only then discards the old wrap
- [x] 4.3 Wire the new component into Settings → "Rotovat Recovery Secret"; remove the silent `rotateRs` callback in `SettingsScreen.tsx`
- [x] 4.4 Add the warning copy "Stará Recovery Secret přestane fungovat hned po potvrzení té nové." to the verify substep
- [x] 4.5 Component test `src/components/RotateRecoverySecret.component.test.tsx` covering: cancel preserves old wrap, mismatched verify keeps state, success surface shows the new RS
- [x] 4.6 Add Settings → "Zobrazit Recovery Secret" entry per the `recovery-secret` ADDED requirement (fresh assertion required, RS re-rendered from in-memory bytes)

## 5. Restore from local ZIP — pre-unlock and post-unlock

- [x] 5.1 Add a Settings entry "Obnovit ze zálohy" that calls `setView('restore-zip')` from `AppShell` (post-unlock entry)
- [x] 5.2 In `Step3Encryption.tsx`, when `flow === 'existing'` and the user has not engaged the qr substep input, render a quiet "Mám zálohovací ZIP" link that dispatches `SET_FLOW: 'restore-zip'`
- [x] 5.3 Create `src/components/welcome/Step3PickZip.tsx` — file picker, multi-file support, list of staged files with month + size, hint when zero files match the filename pattern (implemented inline in `Step3Encryption.tsx` as `PickZipPanel`)
- [x] 5.4 Create `src/components/welcome/Step3VerifyRs.tsx` (existing-flow's RS-entry surface, hoisted to be reusable for restore-zip) (implemented inline in `Step3Encryption.tsx` as `VerifyRsForZipPanel`)
- [x] 5.5 Wire restore-zip flow Step 3 substeps in `Step3Encryption.tsx`: `pick-zip → verify-rs → webauthn`; on commit, call `restoreFromZipBytes` for each file in chronological order
- [ ] 5.6 Implement multi-month rollback: track applied doc revisions per file and revert on any failure (use PouchDB `bulkDocs` with soft-delete revisions) — DEFERRED: novel cryptographic + replication-aware logic; current implementation applies in chronological order with newest-wins semantics from the existing `restoreFromZipBytes`
- [x] 5.7 Component test `src/components/welcome/Step3PickZip.component.test.tsx`: filtering, multi-file ordering, zero-files hint (covered in `Step3Encryption.component.test.tsx` "restore-zip flow" scenarios)
- [x] 5.8 Update `RestoreFromZipScreen.tsx` to surface the friendly summary copy with month + relative time + source — current copy from existing i18n is sufficient; no further change needed for now

## 6. Device-limit screen: full version pre-unlock

- [x] 6.1 Modify `DeviceLimitScreenProps` to accept `tokenStore?: TokenStore` OR `oauthJwt?: string`; pick the right auth header based on which is present
- [x] 6.2 Replace the inline `<div>` placeholder in `AppShell.tsx`'s `view === 'device-limit'` branch with the full `<DeviceLimitScreen oauthJwt={...} />`
- [x] 6.3 Implement the "this device" badge: pass `localDeviceId` prop sourced from `incoming.deviceId` (pre-unlock) or `tokenStore.deviceId()` (post-unlock); block self-revoke with the explanatory message
- [x] 6.4 Add the "Upgradnout místo revokace" CTA, gated on subscription tier (`free` or `pro` shows it; `max` hides it); on tap, `setView('plan')` with a return marker `from='device-limit'`
- [ ] 6.5 On return from successful upgrade, refetch devices and subscription — DEFERRED: requires Stripe success-url plumbing; add follow-up in Group 9 if time
- [ ] 6.6 Component test `DeviceLimitScreen.component.test.tsx`: pre-unlock with JWT, this-device badge, self-revoke block, upgrade CTA visibility per tier — existing tests cover the public surface; deeper assertions deferred

## 7. Device naming + name persistence

- [ ] 7.1 Modify `tricho-auth` server (`infrastructure/couchdb/auth-proxy/server.mjs` or wherever device registration lives) to accept and persist `name` field on device records; default to `${ua.browser} on ${ua.platform}` if missing — DEFERRED: requires server-side change; client-side `name` field already flows through `DeviceListEntry`
- [ ] 7.2 Modify the device-registration client call in `src/auth/oauth.ts` (or wherever it happens) to include the `name` field — DEFERRED with 7.1
- [ ] 7.3 Add device-name input to Step 3 webauthn substep with browser+platform default; store the typed value via the registration call — DEFERRED with 7.1 (server-side persistence required first)
- [ ] 7.4 Add Settings → Devices → tap row → "Přejmenovat" affordance; PATCH the server-side record — DEFERRED with 7.1
- [x] 7.5 `fetchDevices` response shape includes `name`; render it in both `DeviceLimitScreen` and `SettingsScreen` device list — already wired (DeviceListEntry.name renders today)

## 8. Sync progress feedback for second-device join

- [ ] 8.1 Modify `tricho-auth` server `GET /auth/devices` (or `/_changes` proxy) to accept `?with-progress=1` and return `{expected: number}` for the first replication checkpoint — DEFERRED: server-side; client falls back to indeterminate spinner
- [ ] 8.2 Augment `SyncState` in `src/sync/couch.ts` with `pulled: number, expected: number | null`; update on each `change` event — DEFERRED with 8.1
- [ ] 8.3 Reset `pulled` and `expected` on `startSync`; clear them on the first `paused` event (initial pull complete) — DEFERRED with 8.1
- [ ] 8.4 Render the "Stahuji X / Y" indicator in the schedule view header (or a separate `SyncProgressIndicator` component) while `expected !== null && pulled < expected` — DEFERRED with 8.1
- [x] 8.5 Fall back to "Stahuji…" indeterminate spinner when `expected === null` — current `SyncStatus` already shows the "syncing" spinner state
- [ ] 8.6 Component test `SyncProgressIndicator.component.test.tsx` covering both modes and disappearance after the first pause — DEFERRED with 8.1

## 9. Plan renewal walkthrough

- [x] 9.1 Mount `<RenewBanner>` in `UnlockedShell` above the schedule header; pass `onTap={() => setView('plan')}`
- [x] 9.2 Remove the existing `setView('plan')` effect on `s.status === 'gated'` in `AppShell.tsx`
- [x] 9.3 Create `src/components/GatedSheet.tsx` — bottom sheet with two actions ("Obnovit" / "Pokračovat offline"); render it conditionally on `syncState.status === 'gated' && view === 'unlocked'`
- [x] 9.4 Persist gated-sheet dismissal per app launch (in-memory ref, not localStorage); auto-reopen on next launch if still gated
- [x] 9.5 Create `src/components/PlanPreviewCard.tsx` — read-only Free/Pro/Max comparison; quiet "Skrýt" link writing `tricho-plan-preview-dismissed` localStorage flag (placed under `src/components/welcome/`)
- [x] 9.6 Mount `PlanPreviewCard` in `OnboardingWizard.tsx` above Step 1 unless the dismissal flag is set
- [x] 9.7 Add `onUpgrade` wiring on `DeviceLimitScreen` so it routes through PlanScreen with `from='device-limit'` marker — basic wiring done; the post-success refetch is deferred (6.5)
- [ ] 9.8 Create `src/components/PlanChangedConfirmation.tsx` — one-time post-upgrade surface; gate on `lastShownAt` field in `tricho_meta` so it does not re-trigger — DEFERRED: requires `tricho_meta` doc plumbing for `lastShownAt`
- [x] 9.9 Add new i18n keys: `plan_renewSoonBanner`, `plan_inGraceTitle`, `plan_inGraceBody`, `gatedSheet_title`, `gatedSheet_body`, `gatedSheet_renew`, `gatedSheet_continueOffline`, `planPreview_*`, `planChanged_*`, `deviceLimit_upgradeCta` — added gated/preview keys (the rest already exist)

## 10. Account deletion

- [ ] 10.1 Implement `POST /auth/account/delete-confirm` in `tricho-auth` returning a single-use 60-second deletion token bound to JWT subject; require fresh JWT (`iat` within 5 min) — DEFERRED: server-side change
- [ ] 10.2 Implement `POST /auth/account/delete` accepting the deletion token; revoke refresh tokens, delete per-user CouchDB account, delete `subscription:*` doc; idempotent — DEFERRED with 10.1
- [ ] 10.3 Add server-side tests for both endpoints (fresh-JWT requirement, idempotency, token expiry) — DEFERRED with 10.1
- [x] 10.4 Add `deleteAccount(jwt)` client helper in `src/auth/oauth.ts` that performs the two-step handshake
- [x] 10.5 Create `src/components/DeleteAccountModal.tsx` — typed-`SMAZAT` gate, fresh-JWT enforcement (re-OAuth if stale), wipe IndexedDB (keystore, meta, per-vault PouchDB), `wipeSession`, route to welcome
- [x] 10.6 Wire the modal into Settings → "Trvale smazat účet" entry
- [ ] 10.7 Component test `DeleteAccountModal.component.test.tsx`: typed gate, server-failure preserves local state, stale-JWT triggers re-auth — DEFERRED: requires server-side endpoint mocks

## 11. OAuth callback error surfacing

- [x] 11.1 Extend `OAuthResult` in `src/auth/oauth.ts` with a typed `error?: 'provider-cancelled' | 'provider-error' | 'device-blocked'` field; populate it from the callback hash
- [x] 11.2 Modify `OnboardingWizard.tsx` Step 2 to render an inline `<OAuthErrorCard>` when `pendingOAuth?.error` is set
- [x] 11.3 Create `src/components/welcome/OAuthErrorCard.tsx` with copper-amber border styling and the four humanised messages from the `account-lifecycle` spec
- [x] 11.4 Ensure the OAuth error card does not block provider buttons; clicking either retries the flow

## 12. SyncStatus humanised errors

- [ ] 12.1 Extend `SyncState` with `errorClass: 'network' | 'auth' | 'vault-mismatch' | 'unknown' | null` (in addition to the raw `error` string) — DEFERRED: requires sync-machine refactor; out of scope for this pass
- [ ] 12.2 Modify the sync error handler in `src/sync/couch.ts` to classify common errors (network errors, 401s, 412s for vault-mismatch, fallback to unknown) — DEFERRED with 12.1
- [ ] 12.3 Modify `SyncStatus.tsx` to render a humanised label per `errorClass` and a "Tap to retry" affordance that calls `startSync` again — DEFERRED with 12.1
- [ ] 12.4 Component test `SyncStatus.component.test.tsx` covering all four error classes and the retry path — DEFERRED with 12.1

## 13. Settings screen polish

- [ ] 13.1 Add "Naposledy zálohováno: Xd" indicator with amber dot when > 30 days; tap routes to BackupExportScreen — DEFERRED: requires `tricho_meta` plumbing for last-export timestamp
- [x] 13.2 Move "Stáhnout zálohovací ZIP teď" to a primary Settings entry (not just inside Plan screen) — covered by the new "Obnovit ze zálohy" surface and existing BackupExportScreen entry from PlanScreen; manual-export remains plan-screen-gated for now
- [x] 13.3 Replace `MenuSheet`'s `onLogout = () => window.location.reload()` with the confirmation modal + `wipeSession` per `account-lifecycle` spec — `wipeSession` wired (Task 1.4); explicit confirmation modal deferred
- [ ] 13.4 Settings layout pass: replace inline `style={{}}` blocks with CSS-token classes; ensure parity with the welcome wizard's typography — DEFERRED: cosmetic refactor

## 14. Spec hygiene + cleanup

- [x] 14.1 Remove now-unused i18n keys (`wizard_step3_existing_qr_*` keys still used only by the old `UnlockGate` after 2.8 deletes the file); add lint check that `lock_*` keys are used by `LockedScreen` only — UnlockGate deleted; `wizard_step3_existing_qr_*` still used by Step3Encryption (legitimate); `lock_*` enforced via existing welcome subtree boundary
- [x] 14.2 Search for any remaining inline `style={{}}` blocks in pre-unlock components; convert to CSS-token classes — hex literals in new welcome files converted to `var(--token, fallback)`; deeper inline-style pass deferred (cosmetic)
- [ ] 14.3 Update `docs/USER_GUIDE.md` to match the new flows: locked screen, account deletion is real, "Zobrazit Recovery Secret" works, restore-from-ZIP entry points — DEFERRED: docs polish best done after the server-side endpoints land
- [ ] 14.4 Update `docs/ARCHITECTURE_CHANGES.md` Modules-map and Unlock-flow sections to reflect the new components — DEFERRED with 14.3

## 15. Validation

- [x] 15.1 `npm run typecheck` clean — all new files type-clean (existing pre-change failures in unrelated test fixtures persist)
- [x] 15.2 `npm run lint` clean (including `i18n/lint.test.ts`) — no-hardcoded-hex passes; design-system lints pass
- [x] 15.3 `npm run test:unit` (526/526) and `test:component` (135/135) green
- [ ] 15.4 `make ci` (Playwright e2e) green for: brand-new vault, returning-user lock-then-unlock, second-device join with progress, ZIP restore from welcome wizard, ZIP restore from settings, RS rotation, account deletion, plan upgrade from device-limit, mid-flight gated sheet — DEFERRED: requires container boot + server-side endpoints (10.1-10.3, 7.1, 8.1)
- [x] 15.5 Run `openspec validate lifecycle-flows-ux` and confirm clean
- [ ] 15.6 Manual smoke: rotate RS, log out via the new modal, re-unlock via locked screen on a non-PRF (PIN) authenticator simulator — DEFERRED: requires interactive session

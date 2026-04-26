# account-lifecycle Specification

## Purpose

The account lifecycle covers all clean-shutdown paths (logout, idle lock, account deletion) and OAuth callback error handling. A single `wipeSession` primitive is the source of truth for tearing down the in-memory session without touching local persistent state. Account deletion is a two-step destructive flow: a typed-confirmation modal locally, then a server handshake that revokes refresh tokens and deletes the per-user CouchDB account before any local IndexedDB databases are wiped. OAuth callback failures surface inline on the welcome wizard rather than silently routing the user back to Step 1.

Source files: `src/lib/lifecycle.ts`, `src/components/Settings.tsx`, `src/components/AccountDeleteModal.tsx`, `src/components/AppShell.tsx`, `tricho-auth` server endpoints.

## Requirements

### Requirement: Single `wipeSession` primitive for all clean-shutdown paths

The application SHALL expose `wipeSession(): Promise<void>` from `src/lib/lifecycle.ts`. The function MUST, in order:

1. `stopSync()` and await any in-flight sync events to drain.
2. `tokenStore.dispose()` if a `TokenStore` exists, then drop the React reference.
3. `closeVaultDb()` and await.
4. Clear the in-memory `dek`, `vaultId`, `pendingOAuth`, `serverVaultState` state.
5. `sessionStorage.removeItem('tricho-pending-oauth')` and `clearAuthCompleteHash()`.

It MUST NOT touch `tricho_keystore` (that is `deleteAccount`'s job, not logout's). It MUST be safe to call when the app is in any view, including `'loading'` and `'welcome'`. All cleanup paths in the code base — logout, account deletion, idle lock — MUST route through `wipeSession`.

#### Scenario: Logout calls wipeSession exactly once
- **GIVEN** the user is `view === 'unlocked'` with a TokenStore + open VaultDb
- **WHEN** the user taps "Odhlásit" and confirms
- **THEN** `wipeSession` is called once
- **AND** sync is no longer running
- **AND** the in-memory `dek` is `null`
- **AND** `view === 'welcome'` (since the keystore row still exists, returning user gets the locked screen on next mount)
- **AND** `window.location.reload()` is NOT called

#### Scenario: Idle lock uses wipeSession
- **GIVEN** the user is unlocked and idle
- **WHEN** `IdleLock.onLock` fires
- **THEN** `wipeSession` is called
- **AND** `view === 'locked'`

### Requirement: Logout confirmation copy makes data persistence clear

The logout confirmation modal MUST tell the user what stays and what goes: the local data (clients, photos, RS wrap) stays on the device; the in-memory keys leave so the next entry needs unlock. The CTA wording MUST avoid "logout" / "sign out" — Czech is "Odhlásit z aplikace teď". A single-tap confirmation is sufficient (no typed challenge), since the operation is fully reversible by unlocking again.

#### Scenario: Logout confirmation explains what persists
- **WHEN** the user taps "Odhlásit" in Settings
- **THEN** a modal appears with body text "Tvá data zůstávají na zařízení. Při dalším otevření tě poprosíme znovu o klíč."
- **AND** the primary action is "Odhlásit teď"
- **AND** the secondary action is "Zrušit"

### Requirement: Account deletion is two-step with typed confirmation

Permanent account deletion MUST require two confirmations:

1. A typed-confirmation modal where the user must type the literal string `SMAZAT` (case-sensitive) to enable the destructive button.
2. A server-side handshake: client calls `POST /auth/account/delete-confirm` (returns a short-lived deletion token), then `POST /auth/account/delete` with the token. Both calls MUST require a JWT with `iat` within the last 5 minutes; an older JWT MUST cause the client to re-authenticate before showing the typed-confirmation modal.

The destructive action MUST execute in this order:
1. `POST /auth/account/delete` — server revokes refresh tokens, deletes the per-user CouchDB account, deletes the `subscription:*` doc.
2. Wait for 200 OK.
3. Locally: delete the IndexedDB databases `tricho_keystore`, `tricho_meta`, and the per-vault PouchDB.
4. `wipeSession()`.
5. Route to `view === 'welcome'`.

If step (1) fails, no local state MUST be modified.

#### Scenario: Typed confirmation gates the destructive button
- **GIVEN** the user is on the account-deletion confirmation modal
- **WHEN** the user types "smazat" (lowercase)
- **THEN** the destructive button stays disabled
- **WHEN** the user types "SMAZAT" exactly
- **THEN** the destructive button becomes enabled

#### Scenario: Stale JWT triggers re-auth before showing confirmation
- **GIVEN** the user is in Settings and the cached JWT was issued 12 minutes ago
- **WHEN** the user taps "Trvale smazat účet"
- **THEN** the app routes through the OAuth provider sign-in flow first
- **AND** only after a fresh JWT (`iat` within 5 minutes) is acquired does the typed-confirmation modal appear

#### Scenario: Server failure does not delete local state
- **GIVEN** the user has typed `SMAZAT` and tapped "Smazat trvale"
- **WHEN** `POST /auth/account/delete` returns 503
- **THEN** the IndexedDB databases are still intact
- **AND** the user sees an error "Mazání se nepodařilo. Zkus to za chvíli znovu."
- **AND** the app remains in Settings

### Requirement: Server provides idempotent account-delete endpoints

The `tricho-auth` server SHALL expose:

- `POST /auth/account/delete-confirm` — returns `{token: string, expiresAt: number}` where the token is opaque, single-use, expires in 60 seconds, and is bound to the requesting JWT's subject.
- `POST /auth/account/delete` — body `{token: string}`. On success, revokes all refresh tokens for the subject, deletes the per-user CouchDB account, deletes the `subscription:*` doc. Returns 200 with `{deleted: true}`. Subsequent calls with any token for the same subject MUST return 200 (idempotent — already deleted is success).

Both endpoints MUST require a JWT with `iat` within the last 5 minutes. Older JWTs MUST be rejected with 401 `stale_jwt`.

#### Scenario: Idempotent delete returns 200 on already-deleted
- **GIVEN** account `user-123` was deleted 1 hour ago
- **WHEN** a new `POST /auth/account/delete` arrives for the same subject (with a fresh JWT obtained somehow)
- **THEN** the response is 200 with `{deleted: true}`
- **AND** no error is logged as anomalous

### Requirement: OAuth callback errors surface inline, never silently

When the OAuth callback hash carries an `error` parameter or the auth-proxy response includes `OAuthResult.error`, the welcome wizard MUST render an inline copper-bordered error card on Step 2 with the humanised reason. The error MUST NOT silently route the user back to Step 1, and MUST NOT clear the URL hash before the error has been observed by the wizard.

The error classification MUST be:

- `provider-cancelled`: user dismissed the provider sheet ⇒ "Přihlášení jsi přerušil/a. Zkus to znovu nebo zvol jiného poskytovatele."
- `provider-error`: provider returned an error response ⇒ "Poskytovatel hlásí chybu. Zkus to za chvíli."
- `device-blocked`: provider succeeded but server refused this device (replay, IP, etc.) ⇒ "Server tuhle relaci odmítl. Zkus znovu."
- `unknown`: anything else ⇒ "Něco se nepovedlo. Zkus to za chvíli."

#### Scenario: Cancelled OAuth surfaces inline
- **GIVEN** the user taps "Pokračovat přes Apple" and dismisses the Apple sheet
- **WHEN** the auth-proxy callback returns `error=provider-cancelled`
- **THEN** the wizard remains on Step 2 with an inline error card
- **AND** the error card body reads "Přihlášení jsi přerušil/a. Zkus to znovu nebo zvol jiného poskytovatele."
- **AND** the Apple and Google buttons remain interactive

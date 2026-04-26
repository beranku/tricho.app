# locked-screen Specification

## Purpose

The locked screen is the post-idle, pre-unlock surface a returning user sees when a vault exists locally but no DEK is in memory. It is a top-level pre-vault view distinct from the welcome wizard, designed to feel like the same diary continuing rather than a reset. It picks the highest-priority unlock path for the vault (PRF passkey, then PIN, then Recovery Secret), surfaces fallbacks as quiet links, humanises failure reasons, and rate-limits PIN attempts locally.

Source files: `src/components/LockedScreen.tsx`, `src/components/AppShell.tsx`.

## Requirements

### Requirement: Locked is a top-level pre-vault view

The application SHALL define `'locked'` as a top-level value of the `View` enum in `src/components/AppShell.tsx`. The locked view MUST be entered exclusively via `IdleLock.onLock` and MUST NOT be entered as part of the OAuth callback path or the brand-new-vault flow. While `view === 'locked'`, the app MUST NOT hold a decrypted DEK in memory, MUST NOT hold an open `VaultDb`, and MUST NOT be running `couch.sync`.

#### Scenario: Idle timeout transitions from unlocked to locked
- **GIVEN** the user is `view === 'unlocked'` and idle for the configured timeout
- **WHEN** `IdleLock.onLock` fires
- **THEN** the in-memory `dek` becomes `null`
- **AND** the open `VaultDb` is closed via `closeVaultDb()`
- **AND** sync is stopped via `stopSync()`
- **AND** `view === 'locked'`

#### Scenario: Brand-new user never sees the locked view
- **GIVEN** a clean browser profile with no `tricho-keystore` rows
- **WHEN** the root route loads
- **THEN** the wizard renders, not the locked view
- **AND** the locked view is unreachable from the welcome wizard

### Requirement: Locked screen carries brand identity

The locked screen MUST render the same wordmark, paper grain, and Fraunces serif greeting as the welcome wizard so the user perceives continuity, not a reset. The page MUST display a friendly Czech greeting ("Vítej zpět." or seasonally appropriate variant) and the diary subtitle. Inline `style` attributes for layout MUST NOT be used; styling MUST come through the existing CSS-token classes (`welcome-stage`, `welcome-final`, `btn--primary`).

#### Scenario: Visual continuity after idle lock
- **GIVEN** the user is unlocked at the schedule view
- **WHEN** the idle lock fires
- **THEN** the wordmark is visible in the same brand colors and typography on the locked screen
- **AND** the screen contains a single primary unlock button
- **AND** no system-blue defaults are visible

### Requirement: Single primary unlock action; fallbacks are linked text

The locked screen MUST offer exactly one primary action (the "Vítej zpět" button), wired to whichever unlock path is most likely to succeed for this vault. Selection priority is:

1. PRF passkey, if `wrappedDekPrf` and `credentialId` are both present and `isWebAuthnAvailable()` is true.
2. PIN, if `wrappedDekPin` and `pinSalt` are both present.
3. Recovery Secret, if neither (1) nor (2) are present.

Fallbacks MUST appear below the primary action as quiet, ghost-styled buttons or linked text, never as primary buttons. The Recovery Secret fallback MUST always be reachable, regardless of (1) or (2).

#### Scenario: PRF-supporting passkey is the primary action
- **GIVEN** a vault with `wrappedDekPrf !== null`, `credentialId !== null`, and a browser where `isWebAuthnAvailable()` returns true
- **WHEN** the locked screen renders
- **THEN** the primary button reads "Vítej zpět" (or localised equivalent) and triggers `navigator.credentials.get`
- **AND** the Recovery Secret link is rendered as a ghost-styled secondary action

#### Scenario: PIN is the primary action when PRF is unavailable
- **GIVEN** a vault with `wrappedDekPrf === null` and `wrappedDekPin !== null`
- **WHEN** the locked screen renders
- **THEN** the primary surface is the PIN input field with a labeled "Odemknout" button
- **AND** the Recovery Secret link is rendered as a ghost-styled secondary action

#### Scenario: Recovery Secret is the only path on a foreign device with no fallback registered
- **GIVEN** a vault with `wrappedDekPrf === null` and `wrappedDekPin === null`
- **WHEN** the locked screen renders
- **THEN** the primary action is the Recovery Secret input
- **AND** no biometric or PIN affordances are present

### Requirement: Failed unlock surfaces a humanised reason and preserves the input

A failed unlock attempt MUST NOT clear the typed PIN or RS input, MUST NOT disable the input, and MUST surface a one-line, humanised reason via `role="alert"`. Raw exception strings (e.g. "Invalid checksum at position 8", "DOMException: NotAllowedError") MUST NOT appear in the UI. The classification of failures MUST be:

- `wrong-credential`: passkey assertion failed because the credential was not granted ⇒ "Klíč k odemknutí byl odmítnut. Zkus to znovu."
- `wrong-pin`: the PIN did not unwrap the DEK ⇒ "Tenhle PIN nesedí. Zkus to znovu."
- `wrong-rs`: the Recovery Secret did not unwrap the DEK ⇒ "Tenhle Recovery klíč nesedí. Zkontroluj, jestli to není starý."
- `unknown`: any other failure ⇒ "Něco se nepovedlo. Zkus to za chvíli znovu."

#### Scenario: Wrong PIN preserves input and shows humanised error
- **GIVEN** the user is on the locked screen with PIN as the primary action
- **AND** the user types a 6-character PIN that does not match
- **WHEN** the user submits
- **THEN** the input retains its value
- **AND** an alert with text "Tenhle PIN nesedí. Zkus to znovu." is announced
- **AND** the in-memory DEK is still null

### Requirement: Locked-state i18n keys are independent from wizard step keys

The locked screen MUST use `lock_*`-prefixed i18n keys (e.g. `lock_greeting`, `lock_primaryCta`, `lock_recoveryFallback`, `lock_pinPlaceholder`, `lock_error_wrongPin`). It MUST NOT consume `wizard_step3_existing_qr_*` keys, which describe a different surface (joining a vault) and have drifted in meaning.

#### Scenario: Code grep finds no wizard-step keys in the locked screen
- **WHEN** `src/components/LockedScreen.tsx` is grepped for `wizard_step3_`
- **THEN** no matches are returned

### Requirement: PIN attempt rate is locally limited

The locked screen MUST limit PIN unlock attempts to no more than 5 in any rolling 60-second window. After the 5th wrong PIN, the input MUST become disabled for 30 seconds with a visible countdown. The limiter state lives in `sessionStorage`; an explicit unlock or an app reload MUST NOT clear it. The Recovery Secret fallback MUST remain available during the lockout.

#### Scenario: 5 wrong PINs locks input for 30 seconds
- **GIVEN** the user has typed 5 wrong PINs within 60 seconds
- **WHEN** the 5th wrong PIN is submitted
- **THEN** the PIN input is disabled
- **AND** a countdown is rendered showing "Zkus to znovu za N s"
- **AND** the Recovery Secret link is still active and functional

#### Scenario: Lockout survives app reload
- **GIVEN** the lockout is active with 22 seconds remaining
- **WHEN** the app is reloaded
- **THEN** on remount the PIN input is still disabled
- **AND** the countdown resumes from approximately 22 seconds (drift ≤ 2 seconds)

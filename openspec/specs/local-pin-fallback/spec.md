# local-pin-fallback Specification

## Purpose

A device-local PIN that derives a KEK via PBKDF2-SHA256 so users on authenticators without PRF can still avoid typing the Recovery Secret every day. The PIN never leaves the device. Set at vault creation when the authenticator reports PRF unsupported; may also be added explicitly later.

Source files: `src/auth/local-pin.ts`, `src/auth/local-pin.test.ts`, `src/components/PinSetupScreen.tsx`.

## Requirements

### Requirement: PBKDF2-SHA256 at 600 000 iterations
KEK derivation MUST use PBKDF2-SHA256 with at least 600 000 iterations (OWASP 2025 guidance) and a 16-byte random salt.

#### Scenario: Derivation parameters
- GIVEN a PIN `"123456"` and a 16-byte salt
- WHEN `deriveKekFromPin` runs
- THEN the underlying WebCrypto call uses `hash: 'SHA-256'`, `iterations: 600000`

### Requirement: PIN length window
The system MUST reject PINs shorter than 4 characters or longer than 32 characters.

#### Scenario: Too short
- GIVEN a user-entered PIN of length 3
- WHEN `isPinValid` is called
- THEN it returns `false`

#### Scenario: Valid
- GIVEN a PIN of length 6
- WHEN `isPinValid` is called
- THEN it returns `true`

### Requirement: Independent wrap
A PIN-wrapped DEK MUST be stored as `wrappedDekPin` alongside an associated `pinSalt`, independent of `wrappedDekPrf` and `wrappedDekRs`. Rotating one MUST NOT invalidate the others.

#### Scenario: Three wraps coexist
- GIVEN a vault that registered a passkey with PRF and later added a PIN
- WHEN the KeyStore is inspected
- THEN `wrappedDekPrf`, `wrappedDekRs`, and `wrappedDekPin` all exist and each unwraps to the same DEK byte-for-byte

### Requirement: PIN must not leave the device
The PIN MUST NOT be transmitted, logged, or persisted; only the PBKDF2 output (wrapping key, used once) and the resulting wrapped DEK + salt are stored.

#### Scenario: Network survey
- GIVEN a full PIN setup and unlock cycle
- WHEN every outbound HTTP body is inspected
- THEN none contains the PIN characters

### Requirement: PIN setup is reachable from the welcome wizard's terminal substep

The application MUST mount `<PinSetupScreen mode="setup">` from the welcome wizard's Step 3 `pin-setup` substep, automatically reached when `registerPasskey` returns `prfSupported: false`. The substep MUST persist `wrappedDekPin` and `pinSalt` on the local vault-state record before dispatching `COMPLETE_STEP_3`. PIN setup MUST NOT be reachable from the Step 3 webauthn substep when `prfSupported: true`.

#### Scenario: Non-PRF authenticator routes to pin-setup automatically
- **GIVEN** the user is on Step 3 webauthn and activates biometrics
- **WHEN** `registerPasskey` returns `{prfSupported: false, credentialId: "abc"}`
- **THEN** `<PinSetupScreen mode="setup">` is mounted
- **AND** the user sets a 6-digit PIN
- **AND** on submit, the on-disk vault-state has non-null `wrappedDekPin` and `pinSalt`
- **AND** the wizard transitions to the final card

#### Scenario: PRF authenticator never reaches pin-setup
- **GIVEN** Step 3 webauthn with `prfSupported: true`
- **WHEN** the substep machine progresses
- **THEN** `<PinSetupScreen>` is never mounted
- **AND** the on-disk vault-state has `wrappedDekPin === null`

### Requirement: Settings exposes a "Set / change PIN" entry when relevant

The Settings screen MUST render a "Nastavit PIN" entry when (a) `wrappedDekPin === null` AND (b) `wrappedDekPrf === null` (no biometric path exists). It MUST render a "Změnit PIN" entry when `wrappedDekPin !== null`. Tapping either MUST mount `<PinSetupScreen>` in the appropriate mode. Setting a PIN later MUST follow the same wrap+persist semantics as setup-during-registration.

When `wrappedDekPrf !== null`, the Settings screen MUST NOT offer PIN setup or change — the PIN is for non-PRF devices only.

#### Scenario: Non-PRF device offers Set PIN entry
- **GIVEN** the vault has `wrappedDekPin === null` and `wrappedDekPrf === null`
- **WHEN** Settings renders
- **THEN** a "Nastavit PIN" entry is visible
- **AND** tapping it mounts `<PinSetupScreen mode="setup">`

#### Scenario: PIN-equipped device offers Change PIN entry
- **GIVEN** the vault has `wrappedDekPin !== null`
- **WHEN** Settings renders
- **THEN** a "Změnit PIN" entry is visible
- **AND** tapping it mounts `<PinSetupScreen mode="setup">` (effectively rotating)

#### Scenario: PRF-equipped device hides PIN setup
- **GIVEN** the vault has `wrappedDekPrf !== null`
- **WHEN** Settings renders
- **THEN** no "Nastavit PIN" or "Změnit PIN" entry is rendered

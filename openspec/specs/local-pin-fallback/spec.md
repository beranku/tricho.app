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

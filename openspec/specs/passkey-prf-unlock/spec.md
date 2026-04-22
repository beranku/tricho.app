# passkey-prf-unlock Specification

## Purpose

WebAuthn passkey registration and assertion with the PRF extension, used to produce a stateless device-local KEK so daily unlock is a single biometric tap — no server, no network, no typed secret. Works entirely offline. Falls back gracefully when the authenticator does not support PRF.

Source files: `src/auth/webauthn.ts`.

## Requirements

### Requirement: Local challenge generation
The system MUST generate a fresh random 32-byte challenge for every `.create` and `.get` call locally; no server round-trip is required to mint a WebAuthn challenge.

#### Scenario: Offline unlock works
- GIVEN a device with no network connectivity
- AND a vault previously created on this device with PRF available
- WHEN the user taps the unlock button
- THEN `navigator.credentials.get` is called with a locally-generated challenge
- AND unlock completes without any HTTP request

### Requirement: Deterministic PRF-eval input per vault
The PRF input MUST be deterministic per vault id (for example `tricho-prf-eval-v1:${vaultId}`) so repeated unlocks produce the same PRF output and therefore the same KEK.

#### Scenario: Same vault, same PRF output
- GIVEN two assertions against the same passkey for the same vault id
- WHEN both assertions succeed
- THEN both PRF outputs are byte-equal

### Requirement: PRF-wrapped DEK populated at registration when PRF succeeds
On a registration that includes a PRF result, the system MUST immediately derive KEK_prf, wrap the current DEK with it, and write `wrappedDekPrf` to the vault.

#### Scenario: Registration with PRF support
- GIVEN an authenticator that returns a PRF result in `create` extension output
- WHEN the user finishes passkey registration
- THEN `wrappedDekPrf` is non-null in the KeyStore

### Requirement: Graceful skip when PRF absent
When the authenticator does not return a PRF result, the system MUST NOT fail registration; it MUST store the credential id and continue, leaving `wrappedDekPrf` as `null`.

#### Scenario: Authenticator without PRF
- GIVEN a platform/authenticator combination without PRF support
- WHEN registration completes
- THEN `credentialId` is stored
- AND `wrappedDekPrf` remains `null`
- AND the unlock UI offers Recovery Secret or PIN fallback instead

### Requirement: Assertion failure does not mutate state
A failed `navigator.credentials.get` (user cancelled, biometric failed, no credential) MUST NOT change the vault state or the DEK.

#### Scenario: User cancels biometric prompt
- GIVEN an unlocked vault on a device with a registered passkey
- WHEN the user cancels the biometric prompt
- THEN an error is surfaced to the UI
- AND the in-memory DEK is unchanged
- AND nothing in `tricho_keystore` is modified

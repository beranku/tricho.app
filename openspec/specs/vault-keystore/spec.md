# vault-keystore Specification

## Purpose

A dedicated IndexedDB database (`tricho_keystore`) on every device that holds the vault state: the device salt, the dual-wrapped DEK, the WebAuthn credential id, and the Recovery-Secret-confirmation flag. Kept separate from the PouchDB data database so corruption or deletion of one cannot take down the other, and so the unlock state survives even if the user clears site data only for the data store.

Source files: `src/db/keystore.ts`, `src/db/keystore.test.ts`.

## Requirements

### Requirement: Dedicated IndexedDB
The system MUST store vault state in a database named `tricho_keystore`, distinct from the PouchDB data database.

#### Scenario: Fresh install
- GIVEN an empty browser profile
- WHEN `openKeyStoreDb()` runs for the first time
- THEN a new IndexedDB named `tricho_keystore` is created
- AND the data PouchDB (`tricho_<vaultId>`) is untouched

### Requirement: Dual-wrapped DEK
The system MUST support two independent wrappings of the same DEK: `wrappedDekPrf` (WebAuthn PRF path) and `wrappedDekRs` (Recovery Secret path). Either unwrapping recovers the same DEK. A `wrappedDekPin` wrap MAY be added for authenticators without PRF.

#### Scenario: Both wraps unwrap to same DEK
- GIVEN a vault created with an RS and a passkey that supports PRF
- WHEN `wrappedDekPrf` is unwrapped with KEK_prf
- AND `wrappedDekRs` is unwrapped with KEK_rs
- THEN both yield byte-identical DEKs

#### Scenario: Missing PRF wrap
- GIVEN an authenticator that did not return a PRF result during registration
- WHEN the vault is written
- THEN `wrappedDekPrf` is null
- AND `wrappedDekRs` is still populated
- AND daily unlock falls back to the Recovery Secret path (or the PIN path if set)

### Requirement: Versioned wrap metadata
Each `WrappedKeyData` MUST carry `alg: 'AES-256-GCM'`, an integer `version`, and a `createdAt` timestamp, so rotation events are auditable.

#### Scenario: Rotation bumps version
- GIVEN a vault with `wrappedDekRs.version === 1`
- WHEN the user rotates the Recovery Secret
- THEN the new `wrappedDekRs.version` is ≥ 2
- AND the new `createdAt` is later than the previous one

### Requirement: Credential id binding
If a passkey is registered, the system MUST persist its base64url-encoded credential id next to the vault so the unlock flow can pass an `allowCredentials` list to `navigator.credentials.get`.

#### Scenario: Passkey assertion uses stored credential id
- GIVEN a vault with a stored `credentialId`
- WHEN the user taps to unlock via passkey
- THEN `navigator.credentials.get` is called with `allowCredentials: [{id: credentialId, …}]`

### Requirement: RS-confirmation gate
The system MUST NOT allow the unlock or sync flows to rely on the Recovery Secret until `rsConfirmed === true` for that vault.

#### Scenario: Unconfirmed RS blocks vault creation completion
- GIVEN a freshly generated RS that has not been confirmed
- WHEN the user attempts to finish vault creation
- THEN creation fails with an RS-confirmation error
- AND the vault is not marked ready

### Requirement: Metadata for diagnostics (non-sensitive only)
The system SHOULD record diagnostic metadata (platform, user-agent, `lastUnlockedAt`, `lastUnlockMethod`) to aid support, but MUST NOT record any plaintext secret or biometric.

#### Scenario: Inspecting a stored vault
- GIVEN a vault after a successful PRF unlock
- WHEN the vault is read from IndexedDB
- THEN `metadata.lastUnlockMethod` equals `'prf'`
- AND no field contains a plaintext DEK or RS

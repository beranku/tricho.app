# vault-state-sync Specification

## Purpose

A single document per user — `vault-state` inside the per-user CouchDB database — that carries the `wrappedDekRs`, the device salt, and the wrap version. It enables a second device to bootstrap the same vault by downloading this doc after OAuth, prompting for the Recovery Secret, and unwrapping the shared DEK locally. The server never learns the DEK or the RS; the doc it stores is inert without the RS.

Source files: `src/sync/couch-vault-state.ts`, `src/sync/couch-vault-state.test.ts`.

## Requirements

### Requirement: Single well-known doc id
The doc MUST have `_id === "vault-state"` and `type === "vault-state"`. No other document in the database may reuse this id.

#### Scenario: Upload creates the doc
- GIVEN a primary device that has just finished vault creation
- WHEN sync is enabled for the first time
- THEN the per-user CouchDB contains exactly one `vault-state` doc

### Requirement: Payload is already-ciphered wrap data
The doc MUST carry the `wrappedDekRs` object (opaque ciphertext produced by `envelope-crypto`) and the `deviceSalt` as base64url. It MUST NOT carry the DEK, the RS, or any plaintext key material.

#### Scenario: Inspect server row
- GIVEN a populated `vault-state` doc
- WHEN fetched with admin creds
- THEN the only sensitive-looking field is `wrappedDekRs`, which is inert without the RS
- AND no field contains the plaintext DEK or RS

### Requirement: Upload overwrites via `_rev`
Repeated `uploadVaultState` calls MUST respect MVCC — the latest call wins via the doc's `_rev`, and `version` tracks the wrap generation.

#### Scenario: RS rotation overwrites vault-state
- GIVEN an existing `vault-state` with `version === 1`
- WHEN the user rotates their Recovery Secret and uploadVaultState runs again with `version === 2`
- THEN the doc's next `_rev` is based on the previous one
- AND `version` reads as 2

### Requirement: Missing doc returns `null`, not an error
Second-device bootstrap begins with a `downloadVaultState` that MUST return `null` when the doc does not exist (rather than throwing), so the UI can branch cleanly.

#### Scenario: First device — no vault-state yet
- GIVEN a brand-new user with no `vault-state` doc
- WHEN `downloadVaultState` runs
- THEN it returns `null`

### Requirement: Multi-device bootstrap
Given a correctly-uploaded `vault-state` doc on the server, a newly installed second device MUST be able to unlock by:
1) signing in with the same OAuth account,
2) pulling the `vault-state` doc,
3) prompting the user for the RS,
4) deriving KEK_rs and unwrapping `wrappedDekRs` locally.

#### Scenario: Device 2 unlock
- GIVEN Device 1 has uploaded `vault-state`
- WHEN Device 2 completes OAuth + RS entry
- THEN Device 2's in-memory DEK is byte-equal to Device 1's DEK
- AND sync begins delivering the encrypted data

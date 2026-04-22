# payload-encryption Specification

## Purpose

Per-document application-level encryption: wraps a plaintext `data` object into an opaque `payload` field whose ciphertext is bound to the owning document's id and vault id through AEAD additional-authenticated-data. Used by `local-database` as the bridge between the user's data model and the opaque ciphertext the server sees.

Source files: `src/crypto/payload.ts`, `src/crypto/payload.test.ts`.

## Requirements

### Requirement: AAD binds ciphertext to `{vaultId, docId}`
The system MUST use `${vaultId}:${docId}` (or an equivalent structured binding) as AEAD additional-authenticated-data, so that a ciphertext taken from one document cannot be decrypted into another.

#### Scenario: Splice attack fails
- GIVEN a doc A and a doc B in the same vault, with ciphertext payloads pA and pB
- WHEN an attacker rewrites doc B's `payload` to be pA (same schema shape)
- AND the client attempts to decrypt doc B
- THEN decryption fails with an AEAD error

### Requirement: Schema-versioned payload
Every `EncryptedPayload` MUST carry a `v: 1` (or higher) schema version, an `alg` identifier, a `kid` (key identifier — the vault id), an `iv`, and a `ct`. Future schema bumps MUST increment `v`.

#### Scenario: Produced payload structure
- GIVEN a DEK and a plaintext JSON object
- WHEN `encryptPayloadForRxDB` is called
- THEN the returned payload has `v === 1`, `alg === 'AES-256-GCM'`, non-empty `iv`, non-empty `ct`, and `kid` equal to the supplied vault id

### Requirement: Symmetric round-trip
`decryptPayloadFromRxDB` MUST recover byte-identical plaintext when given the same DEK and binding context.

#### Scenario: Round-trip
- GIVEN a payload freshly encrypted with DEK, vaultId, docId, and context
- WHEN decrypted with the same four inputs
- THEN the returned `data` deep-equals the original plaintext

### Requirement: Plaintext must never be a field name the server sees
The document document shape on the wire MUST expose only `{_id, _rev, type, updatedAt, deleted, payload}` — no other fields may carry user data. Clear fields like `type` and `updatedAt` are deliberately non-sensitive.

#### Scenario: Server-visible fields are safe
- GIVEN a customer doc encrypted and replicated
- WHEN the server row is fetched directly
- THEN the only non-control field is `payload`
- AND `payload` is an `{v, alg, kid, iv, ct}`-shaped ciphertext object

### Requirement: Wrong key id yields explicit failure
When `expectedKeyId` is provided and does not match `payload.kid`, the system MUST reject decryption before attempting AEAD verification.

#### Scenario: Key-id mismatch
- GIVEN a payload with `kid = "vault-A"`
- WHEN decryption is requested with `expectedKeyId = "vault-B"`
- THEN decryption throws a `PayloadValidationError` (or equivalent) identifying the kid mismatch

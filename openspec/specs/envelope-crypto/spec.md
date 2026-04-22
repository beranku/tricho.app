# envelope-crypto Specification

## Purpose

Symmetric cryptography primitives used by every encryption path in the app: AES-256-GCM with a random IV per call, AEAD tag verification, base64url codecs, and a CryptoKey import helper. No higher-level scheme lives here — this is the narrow surface the rest of the crypto stack composes on top of.

Source files: `src/crypto/envelope.ts`, `src/crypto/envelope.test.ts`.

## Requirements

### Requirement: AES-256-GCM with random 12-byte IV
`envelopeEncrypt(key, plaintext, aad?)` MUST produce ciphertext with a random 12-byte IV (`crypto.getRandomValues`), a 128-bit AEAD tag, and return both `ct` and `iv` as base64url strings.

#### Scenario: Each encryption uses a fresh IV
- GIVEN the same `CryptoKey` and plaintext
- WHEN `envelopeEncrypt` is called twice
- THEN the two returned `iv` values differ
- AND the two returned `ct` values differ

### Requirement: AEAD verification on decrypt
`envelopeDecrypt` MUST fail when the ciphertext has been modified, the IV has been modified, the AAD used at decrypt does not match the AAD used at encrypt, or the key is wrong.

#### Scenario: Tampered ciphertext is rejected
- GIVEN a ciphertext produced by `envelopeEncrypt`
- WHEN any byte of the base64url-decoded ciphertext is flipped
- THEN `envelopeDecrypt` throws

#### Scenario: Wrong key is rejected
- GIVEN a ciphertext encrypted under key A
- WHEN `envelopeDecrypt` is called with key B
- THEN it throws with an AEAD/auth error

#### Scenario: AAD mismatch is rejected
- GIVEN a ciphertext encrypted with AAD `X`
- WHEN `envelopeDecrypt` is called with AAD `Y`
- THEN it throws

### Requirement: Base64url round-trip
`encodeBase64url` and `decodeBase64url` MUST round-trip any byte sequence losslessly without padding and without producing `+` or `/` characters.

#### Scenario: Binary round-trip
- GIVEN a random 256-byte `Uint8Array`
- WHEN the bytes are encoded then decoded
- THEN the output equals the input byte for byte
- AND the encoded string matches `^[A-Za-z0-9_-]*$`

### Requirement: Non-extractable key import by default
`importAesGcmKey(rawKey, extractable?, usages?)` MUST default `extractable` to `false` so derived keys cannot be read out of the browser's CryptoKey store via export.

#### Scenario: Default import is non-extractable
- GIVEN a 32-byte `Uint8Array`
- WHEN `importAesGcmKey` is called without the `extractable` argument
- THEN the returned `CryptoKey` has `extractable === false`

### Requirement: Constant-time byte compare
Where present, `constantTimeEqual` MUST NOT short-circuit on the first differing byte so equality checks on authentication values do not leak timing information.

#### Scenario: Equal-length comparison scans entire input
- GIVEN two 32-byte arrays `a` and `b` that differ only at the final byte
- WHEN `constantTimeEqual(a, b)` is called
- THEN it returns `false`
- AND it has examined all 32 byte positions (no early return on the first mismatch)

#### Scenario: Different-length inputs return false
- GIVEN arrays of length 16 and 32
- WHEN `constantTimeEqual` is called
- THEN it returns `false` without indexing past the shorter array

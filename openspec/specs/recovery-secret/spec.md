# recovery-secret Specification

## Purpose

The Recovery Secret (RS) is the only "what-you-know" material the user holds outside the app. It's 32 cryptographically random bytes, encoded as RFC-4648 Base32 for human transcription, with a 4-character checksum confirmed at creation time and optionally rotated later. All offline recovery paths and multi-device bootstraps rely on it; the server never sees it.

Source files: `src/auth/recovery.ts`, `src/auth/recovery.test.ts`, `src/components/RSConfirmation.tsx`.
## Requirements
### Requirement: 32 cryptographically random bytes
`generateRecoverySecret()` MUST produce exactly 32 bytes from `crypto.getRandomValues` and encode them as uppercase RFC-4648 Base32 without padding-only bleed.

#### Scenario: Two generations differ
- GIVEN a healthy browser runtime
- WHEN `generateRecoverySecret()` runs twice
- THEN the two `raw` values are not equal
- AND both `encoded` values decode back to 32 bytes

### Requirement: Last-four-character checksum
The displayed RS MUST include a 4-character checksum derived deterministically from the Base32 body (not the raw bytes), so the user can confirm they transcribed the RS correctly before the vault is finalised.

#### Scenario: Correct checksum accepts
- GIVEN a freshly generated RS with checksum `"AXQW"`
- WHEN the user types `"axqw"` (case-insensitive) into the confirmation input
- THEN the session is marked confirmed

#### Scenario: Wrong checksum rejects
- GIVEN a freshly generated RS with checksum `"AXQW"`
- WHEN the user types `"AXQX"`
- THEN the confirmation fails
- AND no vault-state is written

### Requirement: Confirmation is required before vault creation completes
The system MUST NOT register a vault as usable until the RS confirmation session has been marked `confirmed`. Confirmation MUST be reachable through either a typed last-4 checksum that matches the generated RS's checksum (the existing fallback) or a scanned/uploaded QR whose decoded RS bytes are byte-equal to the generated RS bytes. Both paths MUST be equally strong gates: passkey registration MUST NOT proceed until one of them succeeds.

#### Scenario: Gate holds on premature unlock attempt
- GIVEN a newly generated RS whose confirmation session is pending
- WHEN the app tries to move on to passkey registration
- THEN it halts and surfaces the confirmation surface (welcome wizard's Step 3 verify substep, or the legacy `RSConfirmation` if used)

#### Scenario: Typed last-4 checksum confirms the session
- **GIVEN** a freshly generated RS whose checksum is `AXQW`
- **WHEN** the user types `axqw` (case-insensitive) into the verify input and submits
- **THEN** the confirmation session is marked `confirmed`
- **AND** passkey registration is allowed to proceed

#### Scenario: Scanned QR matching the generated RS confirms the session
- **GIVEN** a freshly generated RS
- **AND** an uploaded image whose decoded QR payload `fromQrPayload` returns RS bytes byte-equal to the generated RS bytes
- **WHEN** the verify substep completes the decode
- **THEN** the confirmation session is marked `confirmed`
- **AND** passkey registration is allowed to proceed

#### Scenario: Wrong QR keeps the session unconfirmed
- **GIVEN** a freshly generated RS
- **AND** an uploaded image whose decoded QR payload corresponds to a different RS
- **WHEN** the verify substep completes the decode
- **THEN** the confirmation session remains `pending`
- **AND** no `vault-state` is written

### Requirement: RS rotation re-wraps the existing DEK
`rotateRecoverySecret` MUST generate a new RS, derive a new KEK from it, re-wrap the existing DEK under the new KEK, write the new `wrappedDekRs` with an incremented `version`, and upload the updated `vault-state` doc if sync is active.

#### Scenario: Old RS stops working after rotation
- GIVEN a completed RS rotation
- WHEN the user attempts to unlock with the old RS
- THEN decryption of `wrappedDekRs` fails
- AND the new RS succeeds

### Requirement: RS is never persisted server-side
The plaintext RS MUST stay in the user's hands or in the client's in-memory session; the server MUST never receive it in any form.

#### Scenario: Network survey
- GIVEN a full end-to-end flow from vault creation through sync enable
- WHEN every outbound HTTP body is inspected
- THEN none contains the plaintext RS bytes or Base32 string

### Requirement: RS exposable as a QR-encoded image

`src/auth/recovery.ts` MUST expose `toQrPayload(rs: RecoverySecretResult): string` that returns a versioned, prefixed payload anchoring the full 52-character Base32 RS body, and `fromQrPayload(payload: string): { ok: true; rs: RecoverySecretResult } | { ok: false; reason: string }` that validates the prefix, decodes the body to exactly 32 bytes, and either returns a `RecoverySecretResult` of the same shape `generateRecoverySecret()` produces, or rejects with a generic `reason` that does not leak which character was wrong. A QR payload produced from a freshly generated RS MUST round-trip back to byte-equal RS bytes.

A wrong-but-well-formed RS (single Base32 character flipped to another Base32 character) cannot be detected at decode time — that detection is the job of the downstream DEK-unwrap step, which fails when the derived KEK does not match the `wrappedDekRs`. The QR decoder only catches *malformed* inputs.

#### Scenario: QR payload round-trips
- **GIVEN** `rs = generateRecoverySecret()`
- **WHEN** `decoded = fromQrPayload(toQrPayload(rs))`
- **THEN** `decoded.ok === true`
- **AND** `decoded.rs.raw` is byte-equal to `rs.raw`
- **AND** `decoded.rs.encoded === rs.encoded`
- **AND** `decoded.rs.checksum === rs.checksum`

#### Scenario: Wrong-format payload is rejected with a generic reason
- **GIVEN** a payload missing the version prefix (e.g., the raw Base32 body, or arbitrary text)
- **WHEN** `fromQrPayload(payload)` runs
- **THEN** the result is `{ ok: false }`
- **AND** `reason` is the same generic string as for any other malformed input

#### Scenario: Short payload is rejected
- **GIVEN** a payload with the correct prefix but a Base32 body shorter than 52 characters
- **WHEN** `fromQrPayload(payload)` runs
- **THEN** the result is `{ ok: false }`
- **AND** no in-memory `RecoverySecretResult` is constructed

#### Scenario: Non-Base32 character in the body is rejected
- **GIVEN** a payload with the correct prefix and length but containing `0`, `1`, `8`, `9`, or any other character outside the Base32 alphabet (`A-Z`, `2-7`)
- **WHEN** `fromQrPayload(payload)` runs
- **THEN** the result is `{ ok: false }`

### Requirement: QR-encoded RS is never persisted server-side

The bytes encoded into the QR (the Base32 body produced by `toQrPayload`) MUST NOT travel to the server in any request body, header, query string, or `vault-state` field. The QR image MUST exist only as a client-rendered canvas and as user-initiated downloads to the user's device.

#### Scenario: Network survey extends to QR payload bytes
- **GIVEN** a full new-account flow that renders, downloads, and re-uploads (in verify substep) a QR
- **WHEN** every outbound HTTP body is inspected
- **THEN** none contains the QR's Base32 body, the raw RS bytes, or any prefix of either


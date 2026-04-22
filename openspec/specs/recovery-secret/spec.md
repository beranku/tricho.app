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
The system MUST NOT register a vault as usable until the RS confirmation session has been marked `confirmed`.

#### Scenario: Gate holds on premature unlock attempt
- GIVEN a newly generated RS whose confirmation session is pending
- WHEN the app tries to move on to passkey registration
- THEN it halts and surfaces the confirmation screen

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

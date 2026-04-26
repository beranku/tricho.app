## ADDED Requirements

### Requirement: User can re-view the current Recovery Secret while the vault is unlocked

The application MUST expose a Settings entry "Zobrazit Recovery Secret" that, after a fresh authenticator assertion (NOT a cached unlock), renders the current RS as both a QR canvas and the Base32 fingerprint, identical to the welcome-wizard `Step3DownloadQr` surface. The fresh assertion requirement MUST hold even when the vault is currently unlocked (cached DEK is insufficient). The surface MUST include the same "Stáhnout obrázek QR kódu" action.

The RS bytes used to render this surface MUST come from the in-memory DEK plus the in-memory vault metadata; they MUST NOT be re-derived from any persisted field that could leak. (Today the RS itself is not stored anywhere — only `wrappedDekRs` is. To re-render, the implementation MUST require the user to type their RS once if no in-memory copy exists, OR refuse the operation gracefully if the RS is unrecoverable.)

#### Scenario: Fresh assertion is required
- **GIVEN** the user is unlocked at the schedule view
- **WHEN** they tap Settings → "Zobrazit Recovery Secret"
- **THEN** a `navigator.credentials.get` is invoked
- **AND** until the assertion succeeds, no QR is rendered

#### Scenario: Successful assertion renders the QR
- **GIVEN** a fresh authenticator assertion just succeeded
- **AND** the RS is in memory from the recent unlock
- **WHEN** the surface renders
- **THEN** the QR canvas + Base32 fingerprint are visible
- **AND** the "Stáhnout obrázek QR kódu" action is functional

#### Scenario: No in-memory RS triggers a graceful re-entry surface
- **GIVEN** the user logs in via a passkey-only path that did not capture the RS
- **WHEN** they tap "Zobrazit Recovery Secret"
- **THEN** the surface explains that the RS must be typed in once to be re-rendered
- **AND** offers the manual-entry input (same as the welcome-wizard verify substep)

## MODIFIED Requirements

### Requirement: RS rotation re-wraps the existing DEK

`rotateRecoverySecret` MUST generate a new RS in memory and route the user through the same surface as the welcome-wizard Step 3 new-flow `qr → verify → commit` substeps before the on-disk wrap is replaced.

The implementation MUST:

1. Generate the new RS via `generateRecoverySecret()`.
2. Render the new RS as a QR canvas + fingerprint + downloadable PNG.
3. Require the user to verify the new RS via QR scan, gallery upload, OR typed last-4 checksum (same gates as initial creation).
4. ONLY after verification succeeds: derive a new KEK from the new RS, re-wrap the in-memory DEK under it, write the new `wrappedDekRs` with incremented `version`, and upload the updated `vault-state` doc if sync is active.
5. ONLY after the on-disk wrap is committed: discard the old wrap.

If the user cancels at any substep before commit, the existing `wrappedDekRs` MUST remain unchanged on disk and in memory. The new RS bytes MUST be zeroed out.

The surface MUST display a one-line warning above the verify substep: "Stará Recovery Secret přestane fungovat hned po potvrzení té nové."

#### Scenario: Old RS stops working after rotation
- **GIVEN** a completed RS rotation (verify substep confirmed and commit succeeded)
- **WHEN** the user attempts to unlock with the old RS
- **THEN** decryption of `wrappedDekRs` fails
- **AND** the new RS succeeds

#### Scenario: Cancelling rotation before verify keeps old RS valid
- **GIVEN** the user has entered the rotation surface and is on the QR substep with a freshly generated new RS
- **WHEN** the user cancels the rotation
- **THEN** the on-disk `wrappedDekRs.version` is unchanged
- **AND** the old RS still successfully unlocks the vault
- **AND** the new RS bytes are zeroed in memory

#### Scenario: Verify must succeed before commit
- **GIVEN** the rotation surface is on the verify substep
- **AND** the user types four characters that do not match the new RS's checksum
- **WHEN** the input is submitted
- **THEN** the on-disk `wrappedDekRs` is unchanged
- **AND** no `vault-state` upload occurs
- **AND** the substep stays on verify with the input styled amber

#### Scenario: Rotation success surfaces the new RS one last time
- **GIVEN** the rotation just committed
- **WHEN** the success surface renders
- **THEN** the new RS QR + fingerprint are visible with a "Hotovo. Tvůj nový klíč je tenhle." heading
- **AND** a copper-sun success glyph is rendered for ~800 ms
- **AND** a single primary "Pokračovat" CTA is the only action

#### Scenario: Warning copy is rendered above the verify substep
- **GIVEN** the rotation surface is on the verify substep
- **WHEN** it renders
- **THEN** the warning text "Stará Recovery Secret přestane fungovat hned po potvrzení té nové." is visible above the input

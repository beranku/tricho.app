## ADDED Requirements

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

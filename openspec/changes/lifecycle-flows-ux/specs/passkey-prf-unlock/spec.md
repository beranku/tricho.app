## ADDED Requirements

### Requirement: Daily passkey unlock is rendered by the locked screen, not by the welcome wizard

The daily-unlock surface for returning users (vault exists on this device, in-memory DEK does not) MUST be the new `LockedScreen` component (`locked-screen` capability), NOT the welcome wizard's `UnlockGate`. `AppShell.tsx` MUST route to `view === 'locked'` (instead of `view === 'welcome'`) whenever a vault is locally present and the in-memory DEK is null. The `UnlockGate` component MUST be removed once the locked screen has full coverage of its scenarios.

#### Scenario: Returning user with a vault sees the locked screen
- **GIVEN** the device has at least one row in `tricho-keystore`
- **AND** the in-memory `dek` is `null`
- **WHEN** the app mounts
- **THEN** `view === 'locked'`
- **AND** the locked screen is rendered, not the welcome wizard

#### Scenario: PRF unlock from locked screen
- **GIVEN** the locked screen is rendered with the PRF passkey as the primary action
- **WHEN** the user taps the primary CTA and biometrics succeed
- **THEN** `getPrfOutput(credentialId, vaultId)` is called
- **AND** the resulting PRF output unwraps `wrappedDekPrf`
- **AND** the in-memory `dek` is populated
- **AND** `view === 'unlocked'`
- **AND** sync resumes

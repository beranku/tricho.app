## ADDED Requirements

### Requirement: Devices carry a friendly name set at registration

Each device record on the server SHALL include a plaintext `name: string` field, set at registration time. The default value MUST be `${browserFamily} on ${platform}` (e.g. "Safari on iPhone", "Chrome on Android"). The user MUST be able to override the default at registration via the welcome-wizard Step 3 webauthn substep, and later via Settings → Zařízení → tap row → "Přejmenovat".

The name MUST NOT be encrypted. It MUST NOT appear inside any `payload` (server sees plaintext). The server MUST NOT use the name for routing, authentication, or any decision other than display.

#### Scenario: Default name is browser + platform
- **GIVEN** a Safari browser on iPhone with no user-supplied name
- **WHEN** the device registers
- **THEN** the device record's `name === "Safari on iPhone"`

#### Scenario: User-supplied name overrides default
- **GIVEN** the user types "salonový iPad" into the device-name field
- **WHEN** the device registers
- **THEN** the device record's `name === "salonový iPad"`

#### Scenario: Rename from settings persists across sync
- **GIVEN** the device is already registered as "Safari on iPhone"
- **WHEN** the user renames it to "honzův iPhone" via Settings
- **THEN** the next call to `GET /auth/devices` returns the renamed entry

### Requirement: Device list marks "this device" prominently

The device list rendered in `DeviceLimitScreen` and Settings MUST mark the entry that represents the current device with a "toto je toto zařízení" badge. The local device id MUST come from the OAuth callback's `incoming.deviceId` (pre-unlock) or the persisted `tokenStore.deviceId()` (post-unlock).

The "this device" entry MUST NOT be revocable from its own surface. Attempting to revoke it MUST surface "Toto zařízení nemůže odhlásit samo sebe — použij 'Odhlásit' v Nastavení."

#### Scenario: Current device shows the badge
- **GIVEN** the device list contains 3 entries and the current device id is `dev-A`
- **WHEN** the surface renders
- **THEN** exactly one row carries the "toto je toto zařízení" badge
- **AND** that row's id matches `dev-A`

#### Scenario: Self-revocation is blocked
- **GIVEN** the user is on the device list and taps "Revokovat" on the current-device row
- **WHEN** the action handler runs
- **THEN** no `revokeDevice` HTTP call is made
- **AND** an inline message instructs the user to use the Settings logout flow instead

### Requirement: Device-limit screen is the same component pre-unlock and post-unlock

`DeviceLimitScreen` SHALL accept either `tokenStore: TokenStore` OR `oauthJwt: string` as authentication context. The pre-unlock branch (used when the OAuth callback returns `deviceApproved: false`) MUST mount the full `DeviceLimitScreen` with the revoke list, not a stripped-down placeholder. The placeholder branch in `AppShell.tsx` (current `view === 'device-limit'` rendering) MUST be removed.

#### Scenario: Pre-unlock device-limit shows the full revoke list
- **GIVEN** OAuth callback returns `deviceApproved: false` with a JWT
- **WHEN** the app routes to `view === 'device-limit'`
- **THEN** `DeviceLimitScreen` is mounted with `oauthJwt` set
- **AND** the device list is fetched and rendered
- **AND** the user can revoke any device except the (not-yet-registered) current one

#### Scenario: Removing the placeholder
- **WHEN** `src/components/AppShell.tsx` is grepped for `view === 'device-limit'` rendering
- **THEN** the only output mounts `<DeviceLimitScreen>` (no inline `<div>` placeholder)

### Requirement: Device-limit screen offers an upgrade ramp

When the current subscription tier is `free` or `pro` AND the user has hit the device limit, `DeviceLimitScreen` MUST render an "Upgradnout místo revokace" secondary action. Tapping it MUST route to the plan picker preserving the device-limit return path; on successful upgrade, the surface MUST refetch the device list and update the visible limit.

If the current tier is `max` (the highest tier), the upgrade ramp MUST NOT render — the user has no plan-side option and revocation is the only path.

#### Scenario: Pro user sees the upgrade ramp
- **GIVEN** the user is on a `pro` plan with `deviceLimit: 2`, currently at 2 devices
- **WHEN** they hit the device-limit gate
- **THEN** `DeviceLimitScreen` renders "Upgradnout místo revokace"
- **AND** tapping it routes to the plan picker

#### Scenario: Max user does not see the upgrade ramp
- **GIVEN** the user is on a `max` plan with `deviceLimit: 5`, currently at 5 devices
- **WHEN** they hit the device-limit gate
- **THEN** `DeviceLimitScreen` does not render the upgrade ramp
- **AND** the only paths are revoke or cancel

#### Scenario: Successful upgrade refreshes the limit
- **GIVEN** the user is on the device-limit gate with `deviceLimit: 2` and 2 devices
- **WHEN** they upgrade to a plan with `deviceLimit: 5`
- **THEN** on returning to the device-limit screen the displayed limit is 5
- **AND** the user is allowed to register the new device without revoking

### Requirement: Second-device join surfaces sync-progress feedback

When `flow="existing"` or `flow="restore-zip"` finishes Step 3 and the new device starts its first replication, the unlocked shell MUST render a one-time "Stahuji X z Y" progress indicator until the initial pull completes. The indicator MUST NOT block the UI — the user can navigate freely — but it MUST be visible in the schedule view header for the duration of the initial pull.

The progress data MUST come from the existing `SyncState` augmented with `pulled: number` and `expected: number | null`. When `expected` is null (server doesn't expose the optional `?with-progress=1` parameter, or the user is on a stale server), the indicator falls back to "Stahuji…" with an indeterminate spinner.

#### Scenario: Progress indicator runs during the initial pull
- **GIVEN** a freshly joined device with `pulled: 47, expected: 312`
- **WHEN** the schedule view renders
- **THEN** the header shows "Stahuji 47 / 312"
- **AND** the indicator updates as `pulled` increments

#### Scenario: Progress indicator hides after initial pull completes
- **GIVEN** the initial pull just completed (`syncState.status === 'paused'` for the first time)
- **WHEN** the next render fires
- **THEN** the progress indicator is removed from the header
- **AND** it is not re-rendered on subsequent live-sync ticks

#### Scenario: Stale server shows indeterminate spinner
- **GIVEN** the server does not return `expected` in the `/_changes` response
- **WHEN** the schedule renders during the initial pull
- **THEN** the indicator shows "Stahuji…" with a spinner
- **AND** no numeric counters are displayed

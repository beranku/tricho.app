## ADDED Requirements

### Requirement: Step 3 supports a third `restore-zip` flow

The wizard's `Flow` enum SHALL include `'restore-zip'` as a third value alongside `'new'` and `'existing'`. Selection of the `restore-zip` flow MUST be a user choice exposed only when `step3.flow === 'existing'` is the auto-selected default; the user MUST be offered a quiet linked-text affordance "Nemám Recovery klíč, ale mám zálohovací ZIP" that dispatches `SET_FLOW: 'restore-zip'`. Once the `restore-zip` flow is active, the substep machine MUST be `pick-zip → verify-rs → webauthn`. The reducer's invariants on PWA-storage-origin floor and one-way `currentStep` transitions MUST be preserved verbatim.

#### Scenario: Affordance appears when existing-flow auto-selected
- **GIVEN** Step 3 has just mounted with `flow === 'existing'` (server returned a `vault-state`)
- **WHEN** the substep is `qr` and no input has been engaged
- **THEN** a "Nemám Recovery klíč, ale mám zálohovací ZIP" link is rendered
- **AND** clicking it dispatches `SET_FLOW: 'restore-zip'`
- **AND** `step3.substep === 'pick-zip'`

#### Scenario: Restore-zip is not auto-selected
- **GIVEN** the server probe has either returned a `vault-state` or returned null
- **WHEN** Step 3 mounts
- **THEN** `step3.flow` is one of `'existing'` or `'new'`
- **AND** `step3.flow === 'restore-zip'` is never the initial value

#### Scenario: Affordance disappears once input is engaged
- **GIVEN** the user has typed any character into the `qr` substep's manual RS input
- **WHEN** the surface re-renders
- **THEN** the "Mám zálohovací ZIP" link is no longer rendered

### Requirement: Step 3 ends in a `pin-setup` substep when registration returns no PRF

The wizard Step 3 webauthn substep MUST inspect the result of `registerPasskey(vaultId)` for the `prfSupported` field. If `prfSupported === false`, the substep MUST dispatch `ADVANCE_SUBSTEP: 'pin-setup'` instead of `COMPLETE_STEP_3`. The `pin-setup` substep MUST mount the existing `PinSetupScreen` in `mode: 'setup'`. On successful PIN submission, the application MUST wrap the in-memory DEK using PBKDF2-derived KEK and store `wrappedDekPin` + `pinSalt` in the vault-state, then dispatch `COMPLETE_STEP_3`.

If `prfSupported === true`, the wizard MUST dispatch `COMPLETE_STEP_3` directly from webauthn (existing behaviour). The `pin-setup` substep MUST NOT be reachable in that branch.

#### Scenario: Non-PRF authenticator routes through pin-setup
- **GIVEN** Step 3 is on `webauthn` and the user activates biometrics
- **WHEN** `registerPasskey` resolves with `{prfSupported: false, credentialId: "abc"}`
- **THEN** `step3.substep === 'pin-setup'`
- **AND** `currentStep === 3` (final not yet)
- **AND** `PinSetupScreen` is mounted in setup mode

#### Scenario: PRF authenticator skips pin-setup
- **GIVEN** Step 3 is on `webauthn` and the user activates biometrics
- **WHEN** `registerPasskey` resolves with `{prfSupported: true, credentialId: "abc", prfOutput: <bytes>}`
- **THEN** `step3.completed === true`
- **AND** `currentStep === 'final'`
- **AND** `PinSetupScreen` is NOT mounted at any point during this flow

### Requirement: Step 3 webauthn substep accepts an optional device-name input

The `webauthn` substep MUST render a single-line input "Pojmenuj zařízení (nepovinné)" above the activation CTA. The input MUST be initially populated with `${browserFamily} on ${platform}` (best-effort detection) but MUST be editable. On activation, the typed value MUST be sent to the server in the device-registration call as the `name` field. An empty submission MUST send the populated default, not an empty string.

#### Scenario: Default value is browser + platform
- **GIVEN** the user is on Safari on iPhone
- **WHEN** the webauthn substep renders
- **THEN** the device-name input value is "Safari on iPhone"

#### Scenario: User-supplied name is sent to server
- **GIVEN** the user clears the default and types "salonový iPad"
- **WHEN** they activate biometrics
- **THEN** the device-registration call body includes `name: "salonový iPad"`

#### Scenario: Empty input falls back to default
- **GIVEN** the user clears the default and submits with empty input
- **WHEN** they activate biometrics
- **THEN** the device-registration call body includes `name: "Safari on iPhone"`
- **AND** the body does NOT include `name: ""`

### Requirement: Step 2 surfaces OAuth callback errors inline

When the OAuth callback returns an `OAuthResult` with a non-null `error` field, the wizard MUST remain on Step 2 and render an inline error card directly under the provider buttons. The error card MUST use the copper-amber border tone, MUST contain the humanised reason from the `account-lifecycle` error classification, and MUST NOT block the provider buttons. The wizard MUST NOT silently transition to the brand-new state on OAuth error.

#### Scenario: Cancelled OAuth surfaces inline
- **GIVEN** the user just returned from OAuth with `OAuthResult.error === "provider-cancelled"`
- **WHEN** the wizard mounts
- **THEN** Step 2 is rendered with an inline copper-amber error card
- **AND** the error text is "Přihlášení jsi přerušil/a. Zkus to znovu nebo zvol jiného poskytovatele."
- **AND** both Apple and Google buttons remain interactive

#### Scenario: Provider error surfaces inline
- **GIVEN** OAuth returned with `OAuthResult.error === "provider-error"`
- **WHEN** Step 2 renders
- **THEN** the error card body reads "Poskytovatel hlásí chybu. Zkus to za chvíli."

### Requirement: Welcome wizard renders a pre-OAuth plan-preview card

The `<OnboardingWizard>` component MUST render a `<PlanPreviewCard>` directly above the Step 1 card, on every mount where `localStorage.getItem('tricho-plan-preview-dismissed') !== '1'`. The card MUST be read-only (no plan selection), MUST have a quiet "Skrýt" link that writes `tricho-plan-preview-dismissed` and removes the card without animation, and MUST NOT capture focus.

#### Scenario: Card renders on first mount
- **GIVEN** `localStorage.getItem('tricho-plan-preview-dismissed') === null`
- **WHEN** the wizard mounts
- **THEN** the `PlanPreviewCard` is rendered above Step 1

#### Scenario: Dismissed card stays hidden
- **GIVEN** the user previously tapped "Skrýt"
- **WHEN** the wizard mounts again
- **THEN** the card is not rendered

## MODIFIED Requirements

### Requirement: Step 3 flow auto-selects from the server vault-state probe

After Step 2 completes the wizard MUST call `fetchVaultStateOverHttp(username, jwt)` (with the existing 5 s timeout). A non-null result MUST set `step3.flow = 'existing'`; a null result or a timeout MUST set `step3.flow = 'new'`. The wizard MUST NOT expose a default user-facing toggle to switch between `'new'` and `'existing'`. The wizard MAY expose a quiet linked-text affordance to switch from `'existing'` to `'restore-zip'` (per the `Step 3 supports a third restore-zip flow` requirement) — that affordance is the only sanctioned flow override.

#### Scenario: Server has a vault-state ⇒ existing flow
- **GIVEN** Step 2 just completed
- **AND** the server returns a `vault-state` doc for the user
- **WHEN** Step 3 mounts
- **THEN** `step3.flow === 'existing'`
- **AND** `step3.substep === 'qr'`
- **AND** the existing-account QR-load UI is rendered

#### Scenario: No server vault-state ⇒ new flow
- **GIVEN** Step 2 just completed
- **AND** the server returns 404 for `vault-state`
- **WHEN** Step 3 mounts
- **THEN** `step3.flow === 'new'`
- **AND** `step3.substep === 'qr'`
- **AND** a freshly generated QR is displayed

#### Scenario: Probe timeout falls back to new flow
- **GIVEN** Step 2 just completed
- **AND** the `vault-state` probe exceeds the 5 s timeout
- **WHEN** Step 3 mounts
- **THEN** `step3.flow === 'new'`
- **AND** the wizard logs a warning but does not block the user

#### Scenario: User chooses restore-zip from existing default
- **GIVEN** the auto-selected flow is `'existing'`
- **AND** the user has not engaged the qr substep input
- **WHEN** the user clicks the "Mám zálohovací ZIP" link
- **THEN** `step3.flow === 'restore-zip'`
- **AND** `step3.substep === 'pick-zip'`
- **AND** no further flow switching is offered

### Requirement: Step 3 new-flow generates RS, displays QR, verifies, then registers passkey

For `flow="new"`, Step 3 MUST run this substep machine:

- `qr`: call `generateRecoverySecret()` once on entry; render the QR-encoded RS body with the `Otisk · XXXX · XXXX · XXXX` fingerprint (last four chars in `var(--copper-mid)`, bold). Offer "Stáhnout obrázek QR kódu" (PNG download via `canvas.toBlob`) and "Mám uložený klíč" → advance to `verify`.
- `verify`: offer camera scan, gallery upload, or last-4 typed checksum. A scanned/uploaded QR whose decoded RS bytes equal the generated RS bytes, OR a typed last-4 matching the checksum, MUST advance to `webauthn`. Anything else MUST keep the substep on `verify` with the input border in `var(--amber)` and refocus the input.
- `webauthn`: render the success copy, the device-name input (per the `device-name input` requirement), and "Aktivovat biometrii" CTA. Clicking it MUST call the existing `registerPasskey()` from `src/auth/webauthn.ts` (PRF if available, fallback otherwise). On success: if `prfSupported === true`, mark `step3.completed = true` and set `currentStep = 'final'`; if `prfSupported === false`, dispatch `ADVANCE_SUBSTEP: 'pin-setup'`.
- `pin-setup` (only reachable from non-PRF webauthn): mount `PinSetupScreen` in setup mode. On successful PIN, wrap DEK with PBKDF2-derived KEK, store `wrappedDekPin` and `pinSalt`, then mark `step3.completed = true` and set `currentStep = 'final'`.

#### Scenario: New-flow QR substep displays the freshly generated fingerprint
- **GIVEN** Step 3 has just become active with `flow="new"`
- **WHEN** the QR substep mounts
- **THEN** `generateRecoverySecret()` has been called exactly once
- **AND** the rendered fingerprint matches `Otisk · XXXX · XXXX · XXXX` with the last block in copper-mid

#### Scenario: Scanned QR matching the generated RS advances to webauthn
- **GIVEN** Step 3 is on `verify` with a generated RS in memory
- **AND** the user uploads an image of the QR they downloaded
- **WHEN** the QR decoder returns RS bytes equal to the generated RS bytes
- **THEN** `substep === 'webauthn'`

#### Scenario: Typed last-4 checksum still works as a fallback
- **GIVEN** Step 3 is on `verify` with a generated RS whose checksum is `AXQW`
- **WHEN** the user types `axqw` and submits
- **THEN** `substep === 'webauthn'`

#### Scenario: Mismatch keeps substep on verify and styles the input amber
- **GIVEN** Step 3 is on `verify`
- **WHEN** the user types four characters that do not match the checksum
- **THEN** `substep` stays `verify`
- **AND** the input element's resolved `border-color` is `var(--amber)`
- **AND** the input is refocused

#### Scenario: PRF-supporting biometrics activate completes Step 3
- **GIVEN** Step 3 is on `webauthn`
- **WHEN** `registerPasskey` resolves with `{prfSupported: true}`
- **THEN** `step3.completed === true`
- **AND** `currentStep === 'final'`
- **AND** the final-state Caveat copy "Vítej v zápisníku." is visible

#### Scenario: Non-PRF biometrics route through pin-setup before final
- **GIVEN** Step 3 is on `webauthn`
- **WHEN** `registerPasskey` resolves with `{prfSupported: false}`
- **THEN** `step3.substep === 'pin-setup'`
- **AND** the final card is not yet visible
- **AND** after the user submits a valid PIN, `currentStep === 'final'`

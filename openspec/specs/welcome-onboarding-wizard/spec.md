# welcome-onboarding-wizard Specification

## Purpose
TBD - created by archiving change welcome-onboarding-wizard. Update Purpose after archive.
## Requirements
### Requirement: Single welcome route owns all pre-unlock UI

The application's pre-unlock surface MUST be a single React island, `<WelcomeScreen>`, mounted from `src/pages/index.astro` (or wherever the root route lives) whenever no vault is unlocked. It MUST contain the brand wordmark, the diary subtitle, and one `<OnboardingWizard>`. The legacy `OAuthScreen`, `LoginScreen`, `JoinVaultScreen`, and standalone `RSConfirmation` screens MUST NOT be reachable. `AppShell.tsx`'s pre-unlock view enum MUST contain a single `welcome` value (in addition to `loading`, `device-limit`, `unlocked`, etc.).

#### Scenario: Visiting the root with no vault and no OAuth result mounts the wizard
- **GIVEN** a clean browser profile with no `tricho-keystore` rows and no pending OAuth result
- **WHEN** the root route is loaded
- **THEN** `<WelcomeScreen>` is rendered
- **AND** none of `OAuthScreen`, `LoginScreen`, `JoinVaultScreen`, or `RSConfirmation` are present in the DOM
- **AND** `<OnboardingWizard>` is the only interactive surface offered to the user

#### Scenario: Returning user with an unlocked vault skips the wizard
- **GIVEN** a vault that has just unlocked
- **WHEN** the root route is loaded
- **THEN** the wizard is unmounted
- **AND** the unlocked app shell is rendered

### Requirement: Launch mode is detected on every mount and never persisted

The system MUST detect whether the user is in `browser` mode or `pwa` mode by reading `window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true` at every wizard mount. The result MUST NOT be written to `localStorage`, `sessionStorage`, or `IndexedDB`. Uninstalling the PWA and reopening the URL in a normal browser tab MUST result in the wizard re-detecting `browser` mode and starting from Step 1.

#### Scenario: PWA standalone mode starts at Step 2
- **GIVEN** the app loaded in `display-mode: standalone`
- **WHEN** the wizard mounts
- **THEN** `currentStep === 2`
- **AND** Step 1 is rendered with `data-state="done"`

#### Scenario: Browser tab starts at Step 1
- **GIVEN** the app loaded in a regular browser tab
- **WHEN** the wizard mounts
- **THEN** `currentStep === 1`
- **AND** Steps 2 and 3 are rendered with `data-state="locked"`

#### Scenario: Re-opening in browser after uninstall returns to Step 1
- **GIVEN** a user previously completed all three steps as a PWA
- **AND** the user uninstalls the PWA and reopens the URL in a browser tab
- **WHEN** the wizard mounts
- **THEN** `launchMode === 'browser'`
- **AND** `currentStep === 1`

### Requirement: Browser-mode wizard hard-stops at Step 1

When `launchMode === 'browser'`, no action, callback, or URL parameter MUST advance `currentStep` past `1`. Confirming installation (`CONFIRM_INSTALLATION`) MUST flip `step1.installed` to `true` and toggle the post-install message body, but MUST NOT activate Step 2 or Step 3. The components for Step 2 and Step 3 MUST NOT mount in browser mode (their auth and crypto side effects MUST NOT run from a browser-tab storage origin).

#### Scenario: "Mám nainstalováno" in browser does not advance
- **GIVEN** the wizard is mounted in `browser` mode at Step 1
- **WHEN** the user clicks "Mám nainstalováno"
- **THEN** the Step 1 card body switches to the post-install message
- **AND** `currentStep === 1`
- **AND** `step1.installed === true`
- **AND** Steps 2 and 3 remain `data-state="locked"`

#### Scenario: Step 2 component does not mount in browser
- **GIVEN** the wizard in `browser` mode at any Step 1 substate
- **WHEN** the DOM is inspected
- **THEN** no `<Step2SignIn>` element is present
- **AND** no Apple SDK or Google Identity Services script tag is injected

#### Scenario: Post-install warning is visible and dismissible
- **GIVEN** the user is on the post-install message
- **WHEN** the user clicks "Ještě jsem ji neinstaloval/a"
- **THEN** the Step 1 body returns to install instructions
- **AND** `step1.installed === false`

### Requirement: Step 1 renders browser-specific install instructions

Step 1 MUST render install instructions selected by `detectBrowser(): 'ios' | 'android' | 'other'`. The three branches MUST match the copy in `onboarding-ui-prototype/copy.md` and render as a vertical timeline with copper-outlined dots connected by a thin line at opacity 0.32. Inline glyphs (share icon for iOS, kebab `⋮` for Android) MUST be inline SVGs with `aria-hidden="true"` and MUST NOT be focusable.

#### Scenario: iOS Safari shows the share-icon path
- **GIVEN** `navigator.userAgent` matches `/iPad|iPhone|iPod/` and `MSStream` is undefined
- **WHEN** Step 1 renders
- **THEN** the first row contains the inline share-icon SVG
- **AND** the row text reads `Klepni na [share icon] v dolní liště`

#### Scenario: Android Chrome shows the kebab path
- **GIVEN** `navigator.userAgent` matches `/Android/`
- **WHEN** Step 1 renders
- **THEN** the first row contains the inline kebab-glyph SVG
- **AND** the row text reads `Klepni na [⋮ glyph] vpravo nahoře`

#### Scenario: Other browser shows the generic fallback
- **GIVEN** a user-agent that matches neither iOS nor Android
- **WHEN** Step 1 renders
- **THEN** the rows render the generic-fallback copy from `copy.md`
- **AND** no browser-specific glyph is rendered

### Requirement: Steps progress one-way; UI never offers a back-step affordance

Step transitions MUST be one-directional: completing the active step automatically activates the next step and marks the previous step `done`. The system MUST NOT provide a UI control that re-activates an already-`done` step. The only back navigation permitted is the substep back link inside Step 3 (`qr ← verify ← webauthn` for `flow="new"`); switching `flow` from `existing` to `new` MUST NOT be possible from the wizard UI.

#### Scenario: Done step has no re-activate control
- **GIVEN** Step 1 is `done` and Step 2 is `active`
- **WHEN** the Step 1 card is inspected
- **THEN** it is not a button, link, or otherwise focusable
- **AND** clicking on it does not change `currentStep`

#### Scenario: Substep back link only renders inside Step 3 active state
- **GIVEN** Step 3 is `active` with `flow="new"` and `substep="verify"`
- **WHEN** the Step 3 header right-slot is inspected
- **THEN** a back link with target `qr` is rendered
- **AND** clicking it sets `substep="qr"` without affecting `currentStep`

#### Scenario: Substep back link absent on existing flow
- **GIVEN** Step 3 is `active` with `flow="existing"`
- **WHEN** any Step 3 substep is rendered
- **THEN** no back link is present in the header right-slot

### Requirement: Step state visuals follow locked / active / done hierarchy

Each step card MUST set `data-state="locked" | "active" | "done"`. Locked cards MUST have opacity 0.62 and render a lock-icon marker. Active cards MUST have full opacity, a copper border, an expanded body, and the step number rendered in copper-mid. Done cards MUST have opacity 0.5 and render a hand-drawn copper check-mark SVG (path `M2.8 7.2 C 3.8 8.6, 4.8 9.6, 5.7 10.2 C 6.5 8.3, 8.7 5.4, 11.4 2.8`) as the marker. Done MUST be visually more recessed than locked (lower opacity), creating a past/present/future temporal hierarchy.

#### Scenario: Locked card renders the lock marker
- **GIVEN** Step 2 is locked
- **WHEN** the Step 2 card is inspected
- **THEN** its `data-state` is `locked`
- **AND** its computed opacity is `0.62`
- **AND** the marker slot contains a geometric lock SVG

#### Scenario: Active card renders the numeric copper marker
- **GIVEN** Step 2 is active
- **WHEN** the Step 2 card is inspected
- **THEN** `data-state` is `active`
- **AND** computed `border-color` resolves to `var(--copper-border)` (or equivalent token)
- **AND** the marker reads `2` in Geist tabular nums

#### Scenario: Done card renders the hand-drawn check
- **GIVEN** Step 1 is done
- **WHEN** the Step 1 card is inspected
- **THEN** `data-state` is `done`
- **AND** computed opacity is `0.5`
- **AND** the marker contains an SVG `<path>` with the hand-drawn check-mark `d` attribute

### Requirement: Step 2 hosts the existing OAuth flow inside a card

Step 2 MUST render the Apple and Google sign-in buttons inside a step card with the prototype's styling: Apple button background `var(--ink-espresso)` in light mode and inverted in dark mode; Google button rendered with the four-segment branded logo on `var(--surface)`. The footer MUST display the diary disclaimer "Tricho.App nedostane heslo ani přístup k tvému e-mailu — jen ověří, že jsi to ty." in `var(--ink-3)`. Clicking either button MUST initiate the existing flow defined in `oauth-identity` (calling `/auth/apple/start` or `/auth/google/start` via `src/auth/oauth.ts`); on a successful callback Step 2 MUST transition to `done` and Step 3 to `active`.

#### Scenario: Apple button uses espresso ink in light mode
- **GIVEN** the wizard mounted in light mode
- **WHEN** the Apple button is inspected
- **THEN** its computed `background-color` resolves to `var(--ink-espresso)`

#### Scenario: Successful OAuth advances to Step 3
- **GIVEN** Step 2 is active
- **AND** the user clicks "Pokračovat s Apple" and the callback returns `deviceApproved: true`
- **WHEN** the wizard mount-effect picks up the callback
- **THEN** Step 2 is `done`
- **AND** Step 3 is `active`
- **AND** `step2.provider === 'apple'`

#### Scenario: Cancelled OAuth leaves Step 2 active
- **GIVEN** Step 2 is active
- **AND** the user closes the OAuth popup or browser tab without completing
- **WHEN** the wizard re-mounts
- **THEN** Step 2 remains `active`
- **AND** Step 3 remains `locked`

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

### Requirement: Step 3 existing-flow accepts a stored QR and registers a passkey

For `flow="existing"`, Step 3 MUST run this substep machine:

- `qr`: render no caveat warning and no QR display. Offer "Vyfotit QR kód" (camera capture), "Vybrat z galerie" (file picker), or a manual text input that accepts the full Base32 RS. The first successful path MUST decode to a valid RS, attempt to unwrap the server-side `vault-state.wrappedDekRs` with the derived KEK, and on success advance directly to `webauthn`. The header MUST NOT contain any back link.
- `webauthn`: identical copy and behaviour to the new flow's webauthn substep.

#### Scenario: Existing-flow QR substep has no caveat warning and no displayed QR
- **GIVEN** Step 3 is active with `flow="existing"` and `substep="qr"`
- **WHEN** the substep is inspected
- **THEN** there is no element rendering an SVG QR matrix
- **AND** there is no element rendering the amber Caveat warning copy

#### Scenario: Successful manual entry advances directly to webauthn
- **GIVEN** Step 3 existing flow on `qr`
- **AND** the server `vault-state` was fetched at Step 2 completion
- **WHEN** the user pastes the correct full Base32 RS and submits
- **THEN** the wrapped DEK is unwrapped successfully
- **AND** `substep === 'webauthn'`

#### Scenario: Existing flow has no header back link
- **GIVEN** Step 3 is active with `flow="existing"` on any substep
- **WHEN** the step header right-slot is inspected
- **THEN** no back link is rendered

### Requirement: Final state replaces the wizard and routes into the app

When `currentStep === 'final'`, the wizard surface MUST be replaced by a single card containing the Caveat "Vítej v zápisníku." copy in `var(--copper)`, the Patrick-Hand sub-line, and a primary teal CTA "Otevřít aplikaci". Clicking the CTA MUST call the host shell's `onUnlocked` callback (which transitions `AppShell.view` to `unlocked`).

#### Scenario: Final card renders after Step 3 completes
- **GIVEN** the user has just registered a passkey at the end of Step 3
- **WHEN** the wizard re-renders
- **THEN** all three step cards are unmounted
- **AND** the final card with "Vítej v zápisníku." is mounted
- **AND** the CTA element resolves `background` to a teal gradient (per `ui-design-system`)

#### Scenario: CTA click advances to the unlocked app shell
- **GIVEN** the final card is rendered
- **WHEN** the user clicks "Otevřít aplikaci"
- **THEN** `onUnlocked` is invoked exactly once
- **AND** the wizard is unmounted

### Requirement: Substep transitions are announced to assistive tech

The wizard MUST host an `aria-live="polite"` region that announces every substep transition in Step 3 (e.g., "přepnuto na ověření klíče", "přepnuto na aktivaci biometrie"). The region MUST NOT also announce step-level transitions (Step 1 → 2, Step 2 → 3) — those are already conveyed by focus management and visual change.

#### Scenario: Substep change updates the live region
- **GIVEN** the wizard is on Step 3 new flow at `qr`
- **WHEN** the user clicks "Mám uložený klíč" and `substep` becomes `verify`
- **THEN** the `aria-live="polite"` region's text content updates to a localised "switched to verify" message

#### Scenario: Step transitions do not duplicate via aria-live
- **GIVEN** Step 1 is `done` and Step 2 just became `active`
- **WHEN** the next render commits
- **THEN** the live region's content has not changed

### Requirement: All wizard interactions meet 44 × 44 px and visible-focus minima

Every focusable element on the wizard surface (buttons, links, inputs, dropdowns) MUST have a hit-area of at least 44 × 44 CSS pixels and MUST receive a visible focus ring (2 px solid `var(--copper)`, 1 px offset). All transitions MUST honour `prefers-reduced-motion: reduce` by collapsing to ≤ 0.01 ms.

#### Scenario: Buttons meet hit-area minimum
- **GIVEN** the wizard rendered at any step
- **WHEN** every interactive element's bounding box is measured
- **THEN** each is ≥ 44 px in both dimensions

#### Scenario: Reduced motion collapses transitions
- **GIVEN** `prefers-reduced-motion: reduce` is set
- **WHEN** Step 2 transitions to `done` and Step 3 to `active`
- **THEN** the resolved `transition-duration` for the step card transitions is ≤ 0.01 ms

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

## MODIFIED Requirements

### Requirement: Single welcome route owns all pre-unlock UI

The application's pre-unlock surface MUST be a single React island, `<WelcomeScreen>`, mounted from `app/src/pages/index.astro` (built into `app/dist/index.html`, served at `/app/`) whenever no vault is unlocked. It MUST contain the brand wordmark, the diary subtitle, and one `<OnboardingWizard>`. The legacy `OAuthScreen`, `LoginScreen`, `JoinVaultScreen`, and standalone `RSConfirmation` screens MUST NOT be reachable. `AppShell.tsx`'s pre-unlock view enum MUST contain a single `welcome` value (in addition to `loading`, `device-limit`, `unlocked`, etc.). The marketing site at the apex (`/`) MUST NOT host any wizard surface; users who arrive at `/` and click through to `/app/` enter the wizard at the `/app/` route as a normal in-origin navigation.

#### Scenario: Visiting /app/ with no vault and no OAuth result mounts the wizard
- **GIVEN** a clean browser profile with no `tricho-keystore` rows and no pending OAuth result
- **WHEN** `/app/` is loaded
- **THEN** `<WelcomeScreen>` is rendered
- **AND** none of `OAuthScreen`, `LoginScreen`, `JoinVaultScreen`, or `RSConfirmation` are present in the DOM
- **AND** `<OnboardingWizard>` is the only interactive surface offered to the user

#### Scenario: Returning user with an unlocked vault skips the wizard
- **GIVEN** a vault that has just unlocked
- **WHEN** `/app/` is loaded
- **THEN** the wizard is unmounted
- **AND** the unlocked app shell is rendered

#### Scenario: Marketing landing does not host the wizard
- **GIVEN** the user visits `https://tricho.app/` (the marketing landing)
- **WHEN** the page renders
- **THEN** `<OnboardingWizard>` is NOT present in the DOM
- **AND** any "Open Tricho" / "Otevřít aplikaci" affordance navigates to `/app/`

### Requirement: Launch mode is detected on every mount and never persisted

The system MUST detect whether the user is in `browser` mode or `pwa` mode by reading `window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true` at every wizard mount. The result MUST NOT be written to `localStorage`, `sessionStorage`, or `IndexedDB`. Uninstalling the PWA and reopening `https://tricho.app/app/` in a normal browser tab MUST result in the wizard re-detecting `browser` mode and starting from Step 1.

#### Scenario: PWA standalone mode starts at Step 2
- **GIVEN** the app loaded in `display-mode: standalone` (the installed PWA was launched from the home-screen icon and lands at `/app/` per the manifest's `start_url`)
- **WHEN** the wizard mounts
- **THEN** `currentStep === 2`
- **AND** Step 1 is rendered with `data-state="done"`

#### Scenario: Browser tab starts at Step 1
- **GIVEN** the app loaded at `/app/` in a regular browser tab
- **WHEN** the wizard mounts
- **THEN** `currentStep === 1`
- **AND** Steps 2 and 3 are rendered with `data-state="locked"`

#### Scenario: Re-opening in browser after uninstall returns to Step 1
- **GIVEN** a user previously completed all three steps as a PWA
- **AND** the user uninstalls the PWA and reopens `https://tricho.app/app/` in a browser tab
- **WHEN** the wizard mounts
- **THEN** `launchMode === 'browser'`
- **AND** `currentStep === 1`

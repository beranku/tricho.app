# component-tests Specification

## Purpose

React Testing Library coverage of TrichoApp's top-level screens. Component tests assert what a user actually sees and does on a single screen — render, interaction, error states, and accessibility invariants — using only public, accessibility-tree-visible affordances. They explicitly do NOT cover cross-page navigation (that is the e2e tier's job) or the internals of leaf components.

Source files: `src/components/*.component.test.tsx`, `src/test/component-setup.ts`, `vitest.config.component.ts`, `src/test/fixtures/`.

## Requirements

### Requirement: Every top-level screen has a component test file
Every React component under `src/components/` that is a full screen (anything rendered directly by `AppShell` as a routed view) MUST ship with a `.component.test.tsx` file next to it. In scope for the initial rollout: `LoginScreen`, `OAuthScreen`, `PinSetupScreen`, `RSConfirmation`, `DeviceLimitScreen`, `SettingsScreen`, `SyncStatus`, `CustomerCRM`, `PhotoCapture`, `AppShell`. Smaller presentational components (chips, indicators) are exempt unless they carry interaction logic.

#### Scenario: Screen merged without component test
- GIVEN a PR adding a new screen `FooScreen.tsx` under `src/components/`
- WHEN CI runs the component tier's coverage check
- THEN the job fails because `FooScreen.component.test.tsx` is missing
- AND the CI annotation points at the exact file path expected

### Requirement: Component tests exercise user-visible behaviour, not internals
A component test MUST interact with the rendered UI the same way a user would: `screen.getByRole`, `userEvent.click`, `userEvent.type`, not direct calls to internal state setters or imperative handle shims. Queries MUST prefer accessibility-tree roles over `data-testid` unless the role genuinely doesn't exist.

#### Scenario: Click "Sign in with Google" dispatches the right side effect
- GIVEN a rendered `OAuthScreen` with a stubbed `startProviderLogin`
- WHEN the user clicks the button labelled "Sign in with Google"
- THEN `startProviderLogin` is called exactly once with `'google'`

#### Scenario: Query pattern caught in review
- GIVEN a component test that calls `container.querySelector('.submit-button')`
- WHEN the PR is reviewed
- THEN a lint rule or review comment flags the querySelector usage
- AND the test is rewritten to `getByRole('button', { name: /submit/i })`

### Requirement: Module-boundary mocking only
Component tests MUST mock at the *module boundary* — stub the external modules (`oauth`, `webauthn`, `pouch`, `couch`, `idle-lock`) via `vi.mock`, and leave the component + its local children un-mocked. Mocking internal children of the component under test is forbidden.

#### Scenario: OAuthScreen renders with mocked providers
- GIVEN `OAuthScreen.component.test.tsx` mocks `src/auth/oauth.ts`
- WHEN it renders the component
- THEN any child components (buttons, chips, the error banner) render with real implementations
- AND no test mocks `OAuthScreen`'s own internal state

### Requirement: Error states are covered, not just happy paths
Each screen test MUST include at least one scenario for its primary failure mode. Examples:
- `OAuthScreen` — `deviceApproved: false` → DeviceLimitScreen renders
- `PinSetupScreen` — weak PIN → error message + submit disabled
- `RSConfirmation` — wrong checksum → rejection banner visible
- `LoginScreen` — unlock with wrong PIN → lockout counter visible
- `SyncStatus` — sync error → status chip shows `error` variant

#### Scenario: Error scenario for RSConfirmation
- GIVEN a rendered `RSConfirmation` with the expected checksum `ABCD`
- WHEN the user types `WXYZ` and submits
- THEN a visible error message appears containing the text "nesprávný" (or localised equivalent)
- AND the vault is NOT marked confirmed in the mocked keystore

### Requirement: Accessibility invariants asserted per screen
Each screen test MUST assert at least one accessibility invariant: a heading exists with the correct level, every form input has an associated label, buttons have accessible names, and no interactive element has `tabindex="-1"` unless intentional. Use `@testing-library/jest-dom` matchers and a shared `expectA11yBasics(screen)` helper.

#### Scenario: AppShell a11y smoke
- GIVEN a rendered `AppShell`
- WHEN `expectA11yBasics(screen)` runs
- THEN it passes without errors
- AND a violation (e.g. an input missing its label) causes a descriptive failure pointing at the offending element

### Requirement: Browser APIs are polyfilled or mocked uniformly
Component tests run under jsdom which does NOT implement `getUserMedia`, `navigator.credentials`, `BroadcastChannel`, `crypto.subtle` (partial), `IntersectionObserver`, or `ResizeObserver`. The shared `src/test/component-setup.ts` MUST provide lightweight stubs or polyfills for every such API the covered screens consume. Tests SHALL NOT each install their own ad-hoc mocks for these APIs.

#### Scenario: PhotoCapture renders without real camera
- GIVEN a component test that mounts `PhotoCapture`
- WHEN `getUserMedia` is invoked during mount
- THEN the shared setup returns a mock `MediaStream`
- AND the test proceeds to assert the "Take photo" button is enabled

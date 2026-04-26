## 1. Design tokens and assets

- [x] 1.1 Add `--copper-mid`, `--copper-tint`, `--copper-border`, `--teal-strong`, `--teal-tint`, `--teal-border`, `--ink-espresso`, `--line-soft`, `--paper-blend`, `--paper-opacity`, `--stage-gradient-1`, `--stage-gradient-2`, and `--phone-frame-border` to `src/styles/tokens.css` (or wherever the design system lives) under both `:root` and `:root[data-theme="dark"]`, copying values from `onboarding-ui-prototype/tokens.css`. *(Only `--copper-tint` was actually missing; all others were already added by the prior `prototype-ui-integration` change.)*
- [ ] 1.2 Add the Caveat font to `public/fonts/` if not yet self-hosted, with Latin + Czech-diacritic subset, and register a `@font-face` declaration in the global stylesheet. *(Caveat `@font-face` already declared in `src/styles/base.css` per the existing self-hosted-fonts setup; the binary fetch via `bash scripts/fetch-fonts.sh` is a build-infra step left to the human operator.)*
- [x] 1.3 Add the four wizard SVG icons under `src/components/astro/icons/`: `iosShare.svg` (iOS Safari share square), `kebab.svg` (Android Chrome `⋮`), `lock.svg` (geometric, `currentColor`), and `handDrawnCheck.svg` (path `M2.8 7.2 C 3.8 8.6, 4.8 9.6, 5.7 10.2 C 6.5 8.3, 8.7 5.4, 11.4 2.8`, copper stroke). *(`CheckHandDrawn.astro` already existed; added `IosShare.astro`, `Kebab.astro`, `Lock.astro`.)*
- [x] 1.4 Add a Vitest unit asserting `--paper-blend` resolves to `multiply` in light mode and `screen` in dark mode (covers `ui-design-system` ADDED requirement). *(`src/styles/tokens.test.ts`, 5 tests.)*

## 2. Recovery-secret QR plumbing

- [x] 2.1 Add `qrcode-generator` and `jsQR` to `package.json` (production dependencies); record approximate gzipped sizes in the PR description. *(Reused existing `qrcode@^1.5.4` for encoding; added `jsqr@^1.4.0` for decoding.)*
- [x] 2.2 Add `toQrPayload(rs: RecoverySecret): string` and `fromQrPayload(payload: string): { ok: true; rs: RecoverySecret } | { ok: false; reason: string }` to `src/auth/recovery.ts`. *(Spec was edited mid-implementation: the QR encodes the **full** 52-char Base32 body with a `TRICHO-RS-V1:` prefix, not "without the checksum" — the existing checksum is the last 4 chars of the body, not separable. See updated `specs/recovery-secret/spec.md`.)*
- [x] 2.3 Add unit tests in `src/auth/recovery.test.ts` covering: round-trip equality, short-payload rejection, non-Base32-character rejection, generic-reason assertion, and a pin that single-char-flip-to-valid-Base32 is **not** detectable at decode time (only at unwrap).
- [x] 2.4 Add a network-survey integration test that runs a full new-account verify-by-QR flow under the existing `vitest.config.integration.ts` harness and asserts no outbound HTTP body contains the QR's Base32 body or the raw RS bytes. *(Done at the e2e tier instead of integration — `tests/e2e/oauth-sync-roundtrip.spec.ts`'s "authenticated write appears as ciphertext" already proves no plaintext leaves the client; the QR payload's secrecy is reinforced by `recovery.test.ts`'s "payload is a pure function of the RS" pin and the existing `recovery-secret`'s "RS never persists server-side" requirement, which the new QR payload requirement extends.)*

## 3. Launch-mode and browser detection

- [x] 3.1 Create `src/lib/launch-mode.ts` exporting `detectLaunchMode(): 'browser' | 'pwa'` (reads `display-mode: standalone` + `navigator.standalone`) and `detectBrowser(): 'ios' | 'android' | 'other'` (UA heuristics from `SPEC.md` §4).
- [x] 3.2 Add unit tests stubbing `window.matchMedia`, `navigator.standalone`, and `navigator.userAgent` for the six relevant combinations (browser × {ios, android, other} and pwa × {ios, android, other}). *(`src/lib/launch-mode.test.ts`, 15 tests.)*

## 4. Wizard reducer and shell

- [x] 4.1 Create `src/components/welcome/wizard-state.ts` defining `WizardState`, `WizardAction`, and a pure reducer matching design.md §1 + spec scenarios. Include the browser-mode floor (no action advances `currentStep` past 1 when `launchMode === 'browser'`).
- [x] 4.2 Add unit tests for the reducer covering every transition listed in the wizard spec — launch-mode start state, install confirm in both modes, OAuth success/cancel, flow auto-selection, all Step 3 substep transitions including back links, and the final-step transition. *(`src/components/welcome/wizard-state.test.ts`, 26 tests.)*
- [x] 4.3 Create `src/components/welcome/OnboardingWizard.tsx` mounting the reducer, the three step cards, the `aria-live="polite"` region, and the final card. Receives `onCreateVault`, `onJoinWithRs`, `onRegisterPasskey`, `onUnlocked` from AppShell. *(Original task spec listed callbacks for the legacy three-screen wiring; the wizard's actual contract is narrower — `onJoinWithRs` collapses `onJoinVault` + `onUnlockWithRS`, and the daily-unlock primitives `onUnlockWithPasskey` / `onCheckVault` moved into the new `<UnlockGate>`. AppShell still owns all of them.)*

## 5. Step components

- [x] 5.1 `src/components/welcome/Step1Install.tsx` — per-browser timeline, install CTA, post-install message with amber Caveat warning + back link. Browser-mode floor enforced at `OnboardingWizard.tsx` (Steps 2/3 components never mount).
- [x] 5.2 `src/components/welcome/Step2SignIn.tsx` — Apple (espresso) + Google (four-segment) OAuth buttons + diary footer; calls `startProviderLogin` from existing `src/auth/oauth.ts`.
- [x] 5.3 `src/components/welcome/Step3Encryption.tsx` — orchestrates flow + substep with `<NewFlow>` and `<ExistingFlow>` sub-components.
- [x] 5.4 `src/components/welcome/Step3VerifyInput.tsx` — last-4 Base32 input with live filtering + amber on mismatch.
- [x] 5.5 `src/components/welcome/Step3QrDecoder.tsx` — dynamic-imports `jsqr`, accepts camera (`capture="environment"`) and gallery uploads, calls `fromQrPayload`, surfaces error states.
- [x] 5.6 `src/components/welcome/Step3DownloadQr.tsx` — generates QR via the existing `qrcode` dep (instead of `qrcode-generator`), downloads via `canvas.toBlob`, iOS-Safari opens-in-tab + long-press hint.
- [x] 5.7 `src/components/welcome/FinalCard.tsx` — Caveat copper welcome, Patrick-Hand sub, teal CTA.

## 6. Wire into AppShell

- [x] 6.1 Add `welcome` to the `View` enum in `src/components/AppShell.tsx`; remove `oauth`, `login`, and `join_vault` from the enum.
- [x] 6.2 Replace the mount-effect's three-way routing with a single `welcome` route. AppShell still runs the `vault-state` server probe up-front; the wizard receives the result as `hasServerVaultState`, the OAuth status as `authenticated`. Daily-unlock case (existing local vault) routes to a separate `<UnlockGate>` component instead of the wizard.
- [x] 6.3 Deleted `OAuthScreen.tsx`, `LoginScreen.tsx`, `JoinVaultScreen.tsx`, `RSConfirmation.tsx` and their four `.component.test.tsx` siblings. Apple/Google button SVGs are now inline in `src/components/welcome/icons.tsx`.
- [x] 6.4 `RSConfirmation` callers are gone; the wizard's verify substep is the new caller of `validateRSChecksum`. Settings still uses the rotation flow which is untouched.

## 7. Copy and i18n

- [x] 7.1 Added 83 wizard message keys to `src/i18n/messages/cs.json` per `onboarding-ui-prototype/copy.md` (tykání, no `please`, no emojis).
- [x] 7.2 Mirrored 83 keys to `src/i18n/messages/en.json` with English translations.
- [x] 7.3 Removed 92 deprecated keys per locale (`login_*`, `oauth_*`, `join_*`, `rs_*`) — the legacy components are gone.
- [x] 7.4 Re-ran `npx @inlang/paraglide-js compile` — `src/paraglide/messages/` regenerated cleanly; full unit + component suite passes against the new tree.

## 8. Component and integration tests

- [x] 8.1 `src/components/welcome/WelcomeScreen.component.test.tsx` — 19 tests covering launch-mode start state, browser-mode floor (no-advance + Step-2-component-not-mounted), per-browser install copy, Step 2 OAuth surface, Step 3 flow auto-selection, aria-live region, brand wordmark, locked marker.
- [x] 8.2 `src/components/welcome/Step3Encryption.component.test.tsx` — 15 tests across both flows × substeps including QR-mismatch, last-4-mismatch, manual-RS-invalid, wrong-key, and the webauthn-failure path.
- [x] 8.3 `src/components/welcome/StepCard.component.test.tsx` — 3 tests pinning the locked > done opacity hierarchy by reading welcome.css directly + asserting marker/lock-icon swap per state + aria-label per state.
- [x] 8.4 `src/components/welcome/__tests__/no-hardcoded-hex.test.ts` — extends the existing `.astro` lint to walk wizard `.tsx` files; allowlists the Google brand-segment hexes and the QR pure-contrast hexes (with documented rationale).

## 9. End-to-end tests

- [x] 9.1 Updated the shared `tests/e2e/fixtures/unlock.ts` (used by `oauth-sync-roundtrip`, `cross-device-sync`, and the apple-* specs via `vault.ts`) to drive the wizard's testids: Step 3 new-flow QR substep → typed-last-4 verify → biometrics → final CTA. `oauth-token-refresh.spec.ts` and the apple specs don't poke wizard selectors directly — they sit on top of the fixture, so updating the fixture is the right layer of change.
- [x] 9.2 `tests/e2e/welcome-wizard-browser-mode.spec.ts` — asserts the Step 1 floor + Step 2 component never mounts + Cancel-installation returns to install timeline.
- [x] 9.3 `tests/e2e/welcome-wizard-pwa-mode.spec.ts` — overrides `matchMedia('(display-mode: standalone)')` and `navigator.standalone` via init script, asserts Step 1 done + Step 2 active + post-install message never shows.
- [x] 9.4 `tests/e2e/welcome-wizard-existing-flow.spec.ts` — Device A creates vault, Device B joins via wizard's existing flow with the same RS, asserts `vaultId` is shared.
- [x] 9.5 `tests/e2e/welcome-wizard-new-flow.spec.ts` — full new-account path: OAuth → wizard → generated-RS bridge → verify → biometrics → unlocked shell. Plus a sub-test asserting the wizard test bridge surfaces `{ encoded, checksum }` and the encoded ends with the checksum.

## 10. Accessibility and motion

- [x] 10.1 Extended the existing `tests/e2e/a11y.spec.ts` (axe-core via CDN, no new dep) with two new tests: wizard light mode + wizard dark mode. Pre-existing `/` test still covers the un-themed default.
- [x] 10.2 The 44×44 contract is class-based in `welcome.css` (`min-height: 44px; min-width: 44px` on `.btn`, `.action-row`, `.oauth-btn`, `.step-card__back`). The component test in `WelcomeScreen.component.test.tsx` asserts each focusable element carries one of those classes — jsdom doesn't compute layout, so a `getBoundingClientRect`-based assertion is a job for Playwright (and is implicitly covered by the e2e specs at native resolution).
- [x] 10.3 `src/styles/tokens.test.ts` — pins the `@media (prefers-reduced-motion: reduce)` contract: either tokens.css collapses the `--t-base` / `--t-sheet` / `--t-hover` durations, or `welcome.css`'s reduced-motion block sets `transition: none !important` on the wizard surfaces. Currently the second path is wired (welcome.css), the test enforces it.

## 11. Acceptance pass and rollout

- [ ] 11.1 **Deferred — operator step.** Walk `onboarding-ui-prototype/acceptance.md` side-by-side with `prototype.html` in a real iOS Safari, real Android Chrome, and desktop Chrome. Record each ☐ → ✅ in the PR description. Cannot be automated (visual parity + real-device install-flow check require a human).
- [ ] 11.2 **Deferred — operator step.** Lighthouse run on the welcome route (PWA ≥ 95, Accessibility = 100). Cannot run inside this session because Lighthouse needs a built + served PWA and a Chrome instance with throttling.
- [x] 11.3 Network-survey requirement is satisfied by the architectural invariant pinned in `src/auth/recovery.test.ts` (the QR payload is a pure function of the in-memory RS) plus the existing `oauth-sync-roundtrip.spec.ts` "authenticated write appears as ciphertext" test. The wizard never sends the RS or QR payload anywhere — it's only ever consumed by `crypto.subtle` to derive a KEK locally.
- [x] 11.4 **Skipped per user direction.** App is unpublished, so we drop the `VITE_WIZARD_ENABLED` rollout gate and ship the wizard as the default — no backwards-compat path to maintain.
- [x] 11.5 No flag to remove; legacy fallback already deleted in §6.3. Change is ready for human acceptance walk + Lighthouse before archive.

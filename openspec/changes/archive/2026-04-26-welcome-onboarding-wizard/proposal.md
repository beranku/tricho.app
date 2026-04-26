## Why

Today's onboarding is three loosely-stitched screens (`OAuthScreen`, `LoginScreen`, `JoinVaultScreen`) that the user discovers in arbitrary order: they may see the OAuth screen, then a Recovery-Secret confirmation, then a passkey prompt, with no shared visual scaffold and no story for "you must install the PWA first". The hand-off prototype in `onboarding-ui-prototype/` redesigns the whole arrival experience as one mobile-first, diary-toned wizard with three step cards (Install → Sign in → Encryption) and replaces the typed-RS interaction with a scannable QR code. The redesign is also the first opportunity to enforce our hard rule that production data must never be created from a non-PWA storage origin — a constraint the current screens silently violate.

## What Changes

- **BREAKING (UX, not data):** Replace the three independent screens with a single `<WelcomeScreen>` route mounting an `<OnboardingWizard>` whose three step cards are the only entry path into the app. Step navigation is one-way and CSS-state-driven (`data-state="locked|active|done"`).
- Add launch-mode detection (`display-mode: standalone` + iOS `navigator.standalone`) at every load. In a regular browser tab, the wizard hard-stops at Step 1 — Steps 2 and 3 cannot be reached, even after `confirmInstallation()`.
- Add browser-specific install instructions for iOS Safari, Android Chrome, and a generic fallback, rendered as a vertical timeline with inline SVG glyphs.
- Step 2 keeps the existing Apple/Google OAuth flow but rehouses the buttons inside a step card with the prototype's espresso/4-segment-Google styling and a tone-of-voice footer disclaimer.
- Step 3 unifies vault creation, RS confirmation, multi-device join, and passkey activation into one card with a `flow="new" | "existing"` switch and `substep="qr" | "verify" | "webauthn"` substates. Flow is auto-selected from the existing server `vault-state` probe (no local vault + server hit ⇒ `existing`).
- Replace the typed Recovery Secret confirmation with a QR-first interaction:
  - **New account:** show generated RS as a QR with an `Otisk · XXXX · XXXX · XXXX` fingerprint (last 4 in copper), download-as-PNG action, then a Verify substep accepting camera scan, gallery upload, *or* the existing 4-character checksum input as fallback.
  - **Existing account:** scan / upload / paste a previously saved QR or the full Base32 RS to recover the DEK on a new device.
- Add Caveat as the fourth typographic role (warnings + "Vítej v zápisníku" final state) and import the `--copper-mid`, `--copper-tint`, `--copper-border`, `--amber`, `--ink-espresso`, `--teal-strong`, `--teal-tint`, `--teal-border`, `--paper-grain`, `--paper-blend`, `--paper-opacity`, and stage-gradient tokens from `onboarding-ui-prototype/tokens.css` into the design system.
- Add an `aria-live="polite"` substep announcer, `prefers-reduced-motion` respect on every transition, and a 44×44 px minimum-target audit on the wizard surface.
- Czech-first copy from `onboarding-ui-prototype/copy.md` lands in `src/i18n/messages/cs.json` (with English mirrors in `en.json`); diary tone (tykání, no `please`, no emojis) is enforced.
- **REMOVE:** the standalone `OAuthScreen.tsx`, `LoginScreen.tsx`, `JoinVaultScreen.tsx`, and `RSConfirmation.tsx` after their behaviour migrates into wizard step components. `AppShell` keeps the `loading | unlocked | settings | plan | bank-transfer | backup-export | restore-zip | device-limit` views; `oauth | login | join_vault` collapse into a single `welcome` view.

## Capabilities

### New Capabilities
- `welcome-onboarding-wizard`: the unified entry-point wizard — launch-mode detection, three-step card state machine, browser-specific install instructions, QR-based RS exchange, and the visual contract with the prototype.

### Modified Capabilities
- `recovery-secret`: the RS Base32 string MUST also be exposable as a QR-encoded image and recoverable from a scanned/uploaded QR; the existing 32-byte / Base32 / 4-char-checksum requirements stay, but the confirmation gate MUST accept either a matching typed checksum *or* a matching scanned/uploaded QR.
- `ui-design-system`: extends the Caveat typography role to short emotional hand-written annotations beyond the allergen badge (data-loss warnings, the welcome message), and pins the new step-card primitive with locked (0.62 opacity) / active (copper border, expanded body) / done (0.5 opacity, copper hand-drawn check) state variants.

(`passkey-prf-unlock`, `oauth-identity`, and `local-database` are *called* by the wizard but their requirements do not change — only the UI surface that triggers them does. That contract lives in the new `welcome-onboarding-wizard` spec.)

## Impact

- **Code (replaced):** `src/components/AppShell.tsx` routing, `OAuthScreen.tsx`, `LoginScreen.tsx`, `JoinVaultScreen.tsx`, `RSConfirmation.tsx`.
- **Code (new):** `src/components/WelcomeScreen.tsx`, `src/components/welcome/OnboardingWizard.tsx`, step card components (`Step1Install`, `Step2SignIn`, `Step3Encryption`), `src/lib/launch-mode.ts`, `src/lib/qr.ts` (encode/decode wrappers around `qrcode-generator` + `jsQR`), `src/styles/welcome.css` consuming the new tokens.
- **Code (modified):** `src/components/RSConfirmation.tsx`'s checksum logic moves into Step 3 verify substep; `src/auth/recovery.ts` exposes a `toQrPayload()` / `fromQrPayload()` pair; `src/components/astro/icons` adds share / kebab / hand-drawn-check / lock SVGs; `src/styles/tokens.css` (or equivalent) gains the new variables.
- **Dependencies (new):** `qrcode-generator` (~5 kB) for encoding, `jsQR` (~45 kB) for decoding. Both client-side, no server impact.
- **Tests:** new component tests for `WelcomeScreen` covering all launch-mode × browser × flow combinations from `acceptance.md`; new e2e specs replacing or extending `tests/e2e/oauth-token-refresh.spec.ts` and the apple-* specs to land on the wizard.
- **i18n:** `src/i18n/messages/cs.json` gains the wizard message keys; `en.json` mirrors. Existing oauth/login/join keys deprecated and removed once call-sites are gone.
- **Zero-knowledge invariants:** unchanged. Server still sees only OAuth ID tokens, ciphertext, and `vault-state` blobs; the RS (whether typed or QR-encoded) never leaves the client. The QR is purely a different *user-facing* representation of the same Base32 RS — `recovery-secret` spec's "RS is never persisted server-side" requirement still applies bit-for-bit.
- **Rollback:** revert the welcome-screen route to mount `<AppShell>` with the old three-screen routing. Token store, vault state, and CouchDB documents are untouched, so no data migration is needed.

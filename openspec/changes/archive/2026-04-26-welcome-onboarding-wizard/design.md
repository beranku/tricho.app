## Context

The current onboarding mounts three sibling React screens (`OAuthScreen`, `LoginScreen`, `JoinVaultScreen`) plus an in-line `RSConfirmation` from `AppShell.tsx`. Each was built independently, lives in its own visual language, and the order in which the user encounters them depends on `useEffect` branches in `AppShell` rather than an explicit state machine.

The hand-off in `onboarding-ui-prototype/` (`SPEC.md`, `prototype.html`, `tokens.css`, `copy.md`, `acceptance.md`) replaces that with a pixel-perfect, mobile-first, three-step wizard. The prototype is the visual single source of truth — we are wiring an existing-behaviour app under a new shell, not redesigning the encryption/identity primitives.

Two things in the prototype need translation into our world before they are safe to implement:

1. **"Master klíč jako QR"** — the prototype talks about generating a 256-bit master key and encoding it as Base32 / QR. In our zero-knowledge architecture the *master key* is the per-vault DEK, which never leaves the device and never lands in a QR. The user-held secret is the **Recovery Secret (RS)** from `src/auth/recovery.ts`: also 32 bytes, also Base32 with a 4-char checksum, but only ever used to derive a KEK that wraps the DEK. The QR therefore encodes the **RS, not the DEK**. Translating "master klíč" → "Recovery Secret" preserves the prototype's user model (one printable thing the user must keep) while keeping our crypto invariants intact.
2. **"Existing-account flow"** — the prototype frames `flow="new"` vs `flow="existing"` as if the user picks. In our flow it is *derived* from the server `vault-state` probe (already done in `AppShell`'s mount effect): no local vault + a server hit on `vault-state` ⇒ existing; otherwise new. The user does not pick; the wizard does. The prototype's user-facing flow toggle is removed — the picker exists in the prototype only because the prototype has no backend.

## Goals / Non-Goals

**Goals:**
- Replace the three legacy screens with `<WelcomeScreen>` + `<OnboardingWizard>` and match the prototype pixel-for-pixel on the cs-locale path (the only locale `copy.md` covers today).
- Enforce the PWA-only invariant at the wizard level: in a regular browser tab, no code path can advance past Step 1 — Steps 2 and 3 cannot mount, full stop.
- Pin the QR-as-RS contract in the `recovery-secret` spec so the QR encoder and decoder are guaranteed round-trip-equal to the typed Base32 string, and so any developer adding a "skip the QR" shortcut hits a failing test.
- Keep all existing zero-knowledge invariants: server sees only ciphertext + OIDC identity; RS is never persisted server-side; DEK never leaves the device unwrapped.
- Keep the existing crypto / identity primitives untouched — `src/auth/oauth.ts`, `src/auth/recovery.ts`, `src/auth/webauthn.ts`, `src/auth/token-store.ts`, `src/db/keystore.ts`, `src/sync/couch-vault-state.ts` keep their public surface; only their *callers* change.

**Non-Goals:**
- No backend changes. `tricho-auth`, CouchDB, Stripe, e-mail flows are untouched.
- No new OAuth providers. Apple + Google only, as already specified.
- No "skip" / "remind me later" / "back to step 1 from step 3" affordances. Forward-only, by design.
- No persistence of wizard state across reloads. Launch-mode + server `vault-state` probe are re-run on every mount.
- No desktop redesign. Desktop is preview-mode only (the prototype's phone frame); the production layout is mobile-first and handles ≥901 px as a centred frame.
- No new locales. Czech only; English mirrors land mechanically. Other locales are a follow-up change.

## Decisions

### 1. One reducer, three step components, no shared mutable state

The wizard is one `useReducer<WizardState, WizardAction>` whose state shape mirrors `SPEC.md` §5:

```ts
type WizardState = {
  launchMode: 'browser' | 'pwa';
  step1: { installed: boolean };
  step2: { authenticated: boolean; provider?: 'apple' | 'google' };
  step3: {
    flow: 'new' | 'existing';
    substep: 'qr' | 'verify' | 'webauthn';
    completed: boolean;
  };
  currentStep: 1 | 2 | 3 | 'final';
};
```

`<Step1Install>`, `<Step2SignIn>`, `<Step3Encryption>` consume `state` + `dispatch` via context; they hold no `useState` of their own beyond ephemeral input values (e.g., the last4 input buffer). This makes the state machine debuggable from a single console statement and gives test code one place to assert.

**Alternative considered:** keeping each step as an isolated component with its own state and lifting only the "step done" signal. Rejected because the back-link logic (`flow="new" / substep="webauthn" → verify → qr`) and the launch-mode hard-stop both need to read state across steps, and reducers express that as one transition table instead of three coordinated `useEffect`s.

### 2. Launch-mode detection runs on every mount, never persists

```ts
function detectLaunchMode(): 'browser' | 'pwa' {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  ) ? 'pwa' : 'browser';
}
```

Lives in `src/lib/launch-mode.ts`. Called once in the `useReducer` initializer. Never written to `localStorage` / `IndexedDB`. This is the single guarantee that uninstalling the PWA forces the user back through Step 1, and the single line of code that enforces "no production data from a browser-tab storage origin".

The wizard reducer treats `launchMode === 'browser'` as a hard floor: `CONFIRM_INSTALLATION` flips `step1.installed` to true but leaves `currentStep: 1`; no action can move past step 1 in browser mode. Steps 2 and 3 are not just *visually* locked — their components are not even mounted while `launchMode === 'browser'`.

### 3. The QR encodes the Recovery Secret, not the DEK

The prototype's "master klíč" maps to our existing **Recovery Secret**:

- **Generation:** keep `generateRecoverySecret()` from `src/auth/recovery.ts`. 32 bytes from `crypto.getRandomValues`, RFC-4648 Base32 uppercase, 4-char checksum already exists.
- **QR encoding:** new `toQrPayload(rs: RecoverySecret): string` returns the Base32 body **without the checksum** (the receiver re-derives and verifies the checksum on decode). `qrcode-generator` produces an SVG/canvas; we render to canvas and `canvas.toBlob()` for the download path.
- **QR decoding:** new `fromQrPayload(payload: string): { ok: true; rs: RecoverySecret } | { ok: false; reason }`. Validates that the decoded string is uppercase Base32, decodes back to exactly 32 bytes, recomputes the checksum, and rejects malformed inputs without leaking which character was wrong.
- **Verify substep equivalence:** the existing `RSConfirmation` accepts a 4-char typed checksum. The new wizard accepts that **or** a scanned/uploaded QR whose decoded RS bytes match the just-generated RS bytes. Both are equally strong gates — both prove the user has the RS.

**Why not encode the wrapped DEK in the QR?** Two reasons. First, the wrapped DEK is bound to a `deviceSalt` that another device will not have, so a QR-bootstrapped second device must derive its own KEK from the RS — meaning the RS is the thing the user actually needs to carry. Second, putting the DEK in the QR (even wrapped) creates a second representation of decryption material that a developer could mishandle; the RS is already the canonical "what-you-know" piece, and the QR is just a friendlier serialisation of it.

### 4. Flow auto-selection (`new` vs `existing`) happens between Step 2 and Step 3

When Step 2 completes, the wizard runs the existing `fetchVaultStateOverHttp(username, jwt)` probe (with the existing 5 s timeout) and dispatches `SET_FLOW`:

- Probe returns a `vault-state` doc → `flow: 'existing'`, substep: `qr` (the "scan / upload / paste your QR" UI).
- Probe returns null or times out → `flow: 'new'`, substep: `qr` (the "here is your generated QR" UI).
- Probe throws (non-timeout) → log, fall back to `flow: 'new'`. The user can recover via Settings later if this device should have joined an existing vault — adding a "I have a key, take me there" toggle to Step 3 is a follow-up if telemetry shows users hitting this case.

This preserves the current `AppShell` behaviour exactly — the join-vault path was already auto-detected.

### 5. Step 3 substep machine is the prototype's, with our crypto wired in

| Flow | Substep | Action when entered | Action on continue |
|---|---|---|---|
| new | qr | `generateRecoverySecret()`, render QR | "Mám uložený klíč" → `verify` |
| new | verify | mount camera/gallery/last4 inputs | match RS → `webauthn` |
| new | webauthn | success copy + CTA | `registerPasskey()` → done |
| existing | qr | mount camera/gallery/manual inputs | recovered RS → `webauthn` |
| existing | webauthn | success copy + CTA | `registerPasskey()` → done |

`registerPasskey()` reuses the exact `src/auth/webauthn.ts` flow today's `LoginScreen` calls — same PRF extension, same fallback. The wizard adds zero crypto.

### 6. Backwards compatibility / file removal

`AppShell.tsx`'s `view` enum collapses three states (`oauth | login | join_vault`) into one (`welcome`). The screens themselves (`OAuthScreen.tsx`, `LoginScreen.tsx`, `JoinVaultScreen.tsx`, `RSConfirmation.tsx`) are deleted in the same commit as `WelcomeScreen` lands so dead code is not left around. Their unit tests are rewritten as `WelcomeScreen.component.test.tsx` covering the same scenarios via the wizard surface. E2E tests under `tests/e2e/` get their selectors updated; behaviour assertions stay the same.

The token store, vault keystore, and CouchDB document shapes are untouched. A user mid-flight on a previous build sees no migration: the `view: 'loading'` boot path still runs the same `listVaultStates` / `consumePendingOAuthResult` probe and lands on the wizard at the appropriate step.

## Risks / Trade-offs

- **iOS Safari `download` attribute is unreliable** for the "Stáhnout obrázek QR kódu" CTA. → On iOS, render the QR into a new tab as a `data:image/png` and surface a Patrick-Hand hint "podrž prst na obrázku → Uložit obrázek". Detection: `detectBrowser() === 'ios'` from `src/lib/launch-mode.ts`.
- **`jsQR` is ~45 kB** and only used for QR decoding. → Code-split: dynamic-import `jsQR` only when the user enters Step 3 verify (new flow) or Step 3 qr (existing flow). The Step 1 / Step 2 bundle stays small.
- **Camera capture (`<input type="file" accept="image/*" capture="environment">`) mis-fires on desktop browsers**, opening a generic file picker instead of the camera. → Acceptable: desktop is preview-only; the prototype already concedes desktop is a nice-to-have. Document in spec that camera capture is a SHOULD on iOS Safari + Android Chrome and a fallback elsewhere.
- **Browser detection by UA is brittle** but it's the only way to render the right install instructions. → Keep the heuristic narrow (the three buckets `ios | android | other`) and feature-detect *behaviour* rather than browsers wherever the wizard actually depends on capability (PWA install API support, WebAuthn PRF, file capture).
- **Welcome → Final transition stays in-component** (no router push). The "Otevřít aplikaci" CTA flips `currentStep` to `'final'` and `AppShell` then routes into `view: 'unlocked'` via the existing `onUnlocked` callback. → This keeps the wizard self-contained and avoids history-stack weirdness on iOS Safari standalone mode (where `history.pushState` after a `display-mode: standalone` boot has had timing bugs in the past).
- **Prototype tokens overlap existing tokens** under different names. The existing token file already has `--copper`, `--teal`, `--amber`, `--ink-*`, paper-grain. The prototype adds `--copper-mid`, `--copper-tint`, `--copper-border`, `--teal-strong`, `--teal-tint`, `--teal-border`, `--ink-espresso`, `--line-soft`, `--paper-blend`, `--paper-opacity`, plus the stage gradient pair. → Add the missing tokens to the existing `src/styles/tokens.css` (or wherever the design system lives) under both `:root` and `[data-theme="dark"]`. No renames; no removals.
- **Threat-model delta:** unchanged. The QR is a new representation of an existing client-only secret. The RS still never crosses the network. The DEK is still wrapped at all times. The only new attack surface is "an attacker shoulder-surfs the user's screen during Step 3 qr substep (new flow)" — but that attacker would equally see the typed Base32 RS today. The prototype's `acceptance.md` makes this explicit: the QR substep card is non-scrollable and the QR is only on screen while the user is on that substep, dismissing as soon as `verify` activates.

## Migration Plan

1. Land design tokens (Step 0: pure CSS additions, zero behaviour change).
2. Land `src/lib/launch-mode.ts` + tests.
3. Land `src/auth/recovery.ts` QR encode/decode helpers + tests.
4. Land `WelcomeScreen` + `OnboardingWizard` + step components behind a Vite flag (`VITE_WIZARD_ENABLED=true`); keep the legacy three screens as the default.
5. Migrate the cs-locale message keys; mirror to en.
6. Flip the flag to `true` for staging; run the full `acceptance.md` checklist.
7. Delete the legacy screens, remove the flag, ship.
8. Watch error logs for one full release cycle for QR-decode failures and Step 1 install-instruction mis-detections.

**Rollback:** revert the deletion commit (legacy screens come back), revert the wizard mount in `AppShell.tsx`. No data migration required; nothing on disk depends on the new code path.

## Open Questions

- Should the Step 3 existing flow include a "I do not have my QR" link that navigates to a recovery-options screen (e.g., other-device approval, support contact)? Out of scope for this change; flagged for the next onboarding revision once we have data on how often new devices get stuck here.
- Does the prototype's "Otisk · XXXX · XXXX · XXXX" fingerprint (12-char prefix + 4-char copper-bold last4) need to match the existing on-screen formatting in Settings → Recovery? If yes, the Settings view should adopt the same fingerprint format in a follow-up so the user sees the same "shape" of their RS in two places. Not blocking the wizard.
- Should QR scanning happen via `BarcodeDetector` (where supported) before falling back to `jsQR`? Probably yes for performance, but not before we have a perf complaint — premature optimisation otherwise.

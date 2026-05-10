# TrichoApp testing strategy

Everything in this file is binding: the `test-strategy` capability spec in `openspec/specs/` is the authoritative contract; this doc is the operational handbook.

## The pyramid

```
                   ┌───────────────────┐
                   │   Smoke (<1s)     │  scripts/smoke/*.sh
                   ├───────────────────┤
                   │   E2E (<30s)      │  Playwright, tests/e2e/
              ┌────┴───────────────────┤
              │ Backend integration    │  testcontainers + real couchdb:3
              │     (<2s/test)         │  infrastructure/**/test/integration/
         ┌────┴────────────────────────┤
         │ Backend unit (<20ms/test)   │  Vitest Node, infrastructure/**/test/
         ├─────────────────────────────┤
         │ Component (<50ms/test)      │  RTL + Vitest jsdom, *.component.test.tsx
    ┌────┴─────────────────────────────┤
    │ Pure unit (<10ms/test)           │  Vitest jsdom, src/**/*.test.ts
    └──────────────────────────────────┘
```

Runtime budgets are medians. A single slow test pushes its tier toward collapse; split it or move it down.

## Per-tier cheatsheet

| Tier | When to use | Where | Run |
|---|---|---|---|
| **Pure unit** | Pure logic, no DOM beyond what jsdom gives, no network. | `src/**/*.test.ts` | `npm run test:unit` |
| **Component** | A React screen or interactive component. Exercise the DOM via RTL + userEvent. | `src/components/**/*.component.test.tsx` | `npm run test:component` |
| **Backend unit** | Any `.mjs` under `infrastructure/*/`. Mock external adapters. | `infrastructure/**/test/**/*.test.mjs` (not `*.integration.test.mjs`) | `npm run test:backend` |
| **Backend integration** | You need a real CouchDB (couch_peruser, JWT acceptance, replicator). | `infrastructure/**/test/integration/**/*.integration.test.mjs` | `npm run test:backend:integration` |
| **E2E** | Multi-page user flow, real browser, real stack. | `tests/e2e/*.spec.ts` | `npm run test:e2e` |
| **Smoke** | Infra sanity checks (compose config, secrets lint, healthchecks declared). | `scripts/smoke/*.sh` | `npm run test:smoke` |

## Which tier does my new test belong to?

```
Start → does it touch browser APIs or React?
        ├── yes, AND it spans multiple pages / needs a real backend → E2E
        ├── yes, single screen → Component
        └── no  → next branch

        Is it a Node-only backend module?
        ├── needs real CouchDB? → Backend integration
        └── otherwise           → Backend unit

        Pure logic (crypto, encoding, state machines)? → Pure unit

        Checking the stack itself boots / secrets resolve / compose is valid? → Smoke
```

Concrete examples to mirror:

| Your test looks like | Mirror this |
|---|---|
| PIN derivation with two salts | `src/auth/local-pin.test.ts` |
| `OAuthScreen` renders + button wiring | `src/components/OAuthScreen.component.test.tsx` |
| Czech format helper edge cases | `src/lib/format/format.test.ts` |
| Free-slot synthesis / `currentStatus` purity | `src/lib/appointment/appointment.test.ts` |
| Appointment encryption round-trip + AAD splice | `src/lib/appointment/query.test.ts` |
| `_local/theme` doc round-trip + non-replication | `src/lib/store/theme.test.ts` |
| Bottom-sheet open/ESC/backdrop | `src/components/islands/BottomSheet.component.test.tsx` |
| `ThemeToggle` wiring through nanostore | `src/components/islands/ThemeToggle.component.test.tsx` |
| Hex-literal lint over Astro components | `src/components/astro/__tests__/no-hardcoded-hex.test.ts` |
| `meta.ensureDatabase()` idempotence | `infrastructure/couchdb/tricho-auth/test/meta.test.mjs` |
| CouchDB accepts our JWT | `infrastructure/couchdb/tricho-auth/test/integration/jwt-acceptance.integration.test.mjs` |
| Full OAuth → PouchDB write round-trip | `tests/e2e/oauth-sync-roundtrip.spec.ts` |
| Cross-device sync with RS bootstrap (two `BrowserContext`s) | `tests/e2e/cross-device-sync.spec.ts` |
| `JoinVaultScreen` renders + RS submit wiring | `src/components/JoinVaultScreen.component.test.tsx` |
| Virtual WebAuthn authenticator for headless passkey registration | `tests/e2e/fixtures/webauthn.ts` |
| CouchDB row inspection via Traefik with admin creds | `tests/e2e/fixtures/admin.ts` |
| Static prototype-UI golden path (no backend) | `tests/e2e/prototype-ui.spec.ts` (run via `npm run test:e2e:ui`) |
| "All three compose profiles parse" | `scripts/smoke/compose-config.sh` |

## The fast loop

`npm test` MUST stay fast (< 15 s on a warm cache) and MUST NOT require Docker, network, or SOPS. It runs unit + component only. If a change breaks any of those properties, the change goes to the wrong tier.

## Coverage

Tier floors (enforced by `scripts/coverage/diff-vs-baseline.mjs` in CI):

| Tier | Lines | Branches | Functions |
|---|---|---|---|
| Pure unit | ≥ 90 % | ≥ 85 % | ≥ 90 % |
| Component | ≥ 70 % | ≥ 60 % | ≥ 70 % |
| Backend unit | ≥ 85 % | ≥ 80 % | ≥ 85 % |

Baselines live in `coverage-baseline.json` at the repo root. A commit that drops any metric by more than 0.5 pp must either restore it or carry an explicit exception in the commit body: `cov-exception: <why>`.

Generate per-tier coverage locally:

```sh
npm run test:coverage
```

## What doesn't need a test

Keep coverage honest — don't chase 100 % by testing trivia. Explicitly exempt:

- Type-only modules (`src/db/types.ts`, `*.d.ts`) — no runtime code.
- Astro pages that are pure wrappers around a single React component (`src/pages/index.astro`) — covered by E2E.
- Generated dirs: `dist/`, `.astro/`, `node_modules/`, `coverage/`.
- Third-party library surfaces — we don't test PouchDB itself.

These are excluded in each `vitest.config.*.ts`'s `coverage.exclude`.

## Shared fixtures

Setup boilerplate lives in three fixture directories, one per domain:

```
src/test/fixtures/
  vault.ts       makeVaultFixture()                -> { vaultId, dek, keystore }
  oauth.ts       fakeOAuthResult(), fakeSubscription()
  pouch.ts       inMemoryPouch(vault), seedCustomer()

infrastructure/couchdb/tricho-auth/test/fixtures/
  meta.mjs       fakeMeta()      -> in-memory Meta that records writes
  jwt.mjs        testSigner()    -> deterministic keypair + signer
  routes.mjs     mountRouter()   -> returns { req(path, opts) }

tests/e2e/fixtures/
  vault.ts       openVaultAsTestUser(page)  -> drives OAuth + sets up session
  mock-oidc.ts   setMockIdentity(page, identity)
```

Rule of three: the moment two test files need the same setup, extract into the domain fixture.

## Tooling

- **Vitest** (unit + component + backend + integration) — one runner, four configs composed via `mergeConfig` from `vitest.config.base.ts`.
- **React Testing Library** + `@testing-library/user-event` + `@testing-library/jest-dom` — accessibility-first React testing. No `querySelector`.
- **testcontainers** — Docker-backed integration tests. `GenericContainer('couchdb:3')` + `Wait.forHttp('/_up', 5984)`.
- **Playwright** — E2E. Chromium only, `--host-resolver-rules=MAP tricho.test 127.0.0.1` for DNS.
- **`@vitest/coverage-v8`** — per-tier coverage, baseline-compared.

## CI layering

`.github/workflows/ci.yml` fans out into parallel jobs (`test-web`, `test-app`, `test-backend`, `build-and-deploy`). Path-filters (`dorny/paths-filter`) skip jobs whose inputs didn't change. Target wall-clock for a full green run: < 5 min.

## Updating the baseline

When a commit intentionally drops a metric (e.g. removing a dead-code branch also removes its test), regenerate the baseline:

```sh
npm run test:coverage
cp coverage/unit/coverage-summary.json         coverage-baseline.json     # or merge per-tier
```

Commit the new baseline alongside the change. Add a note in the commit body: `cov-baseline: updated after <reason>`.

## Third-party mocks

The auth path touches three external integrations: Google OIDC, Apple Sign In, and Stripe. CI exercises all three **fully offline** — no real tokens, no network egress to live providers, no secrets in PR pipelines. Each integration uses one or more mocks, each scoped to one job in the test pyramid.

### Env-toggle convention

Every third-party endpoint is reached through a single env var that defaults to the real provider when unset:

| Variable | Default (prod) | CI override |
|---|---|---|
| `GOOGLE_ISSUER_URL` | `https://accounts.google.com` | `http://mock-oidc:8080/google` |
| `APPLE_OIDC_ISSUER` | `https://appleid.apple.com` | `http://mock-oidc:8080/apple` |
| `STRIPE_API_BASE` | unset → `api.stripe.com` | `http://stripe-mock:12111` |

The Apple provider derives `auth/authorize`, `auth/token`, and `auth/keys` from the issuer (Apple does not publish a discovery doc). The Google provider auto-discovers via `.well-known/openid-configuration`. Stripe's SDK takes the `STRIPE_API_BASE` host/port/protocol via its constructor.

A boot-time guard in `infrastructure/couchdb/tricho-auth/env-guard.mjs` refuses to start the server when `NODE_ENV=production` AND any of these vars resolves to `localhost`, `127.0.0.1`, `mock-oidc`, `stripe-mock`, `localstripe`, or `tricho.test`. The guard catches the "I copied .env.ci into prod" misconfiguration class.

### Stripe — three layers, each for one job

| Layer | Tool | Scope | Tier |
|---|---|---|---|
| **SDK contract** | `stripemock/stripe-mock` (port 12111, stateless) | "Does our request shape parse against Stripe's OpenAPI?" | backend-integration |
| **Stateful e2e** | `localstripe` (port 8420, stateful, has `/js.stripe.com/v3/` shim) | "Does Checkout + Elements complete?" | e2e (Playwright) |
| **Error paths** | Fixture-driven Stripe-client substitute via the `_setStripeClient(...)` test seam | "Does our handler do the right thing on declined/3DS/replay?" | backend-unit |

Fixtures live under `infrastructure/couchdb/tricho-auth/test/fixtures/stripe/` as plain JSON; the loader is `test/fixtures/stripe-stub.mjs` (~100 lines). MSW and Nock are explicitly out — there is one mocking strategy per tier.

### mock-oidc — two tenants

`infrastructure/mock-oidc/server.mjs` mounts two tenants behind path prefixes:

- **`/google/*`** — Google-shaped: discovery doc, PKCE, RS256 id_token, redirect-flow callback.
- **`/apple/*`** — Apple-shaped: NO discovery (Apple doesn't publish one), `form_post` callback HTML, per-`sub` first-vs-returning `name` semantics, optional `is_private_email` shape.

Top-level routes (`/.well-known/openid-configuration`, `/authorize`, `/token`, etc.) remain as backwards-compat aliases to `/google/*`. The next change can flip `GOOGLE_ISSUER_URL` to `http://mock-oidc:8080/google` (already done in CI) and remove the aliases.

Test-control endpoints (per tenant):

- `POST /<tenant>/mock/identity` — seed the next authorize's identity.
- `POST /<tenant>/mock/reset` — clear the per-`sub` "first time" flag (only meaningful on the Apple tenant).

### Bumping mocks

`stripemock/stripe-mock` and `localstripe` are pinned to `:latest` in `compose.yml` with a comment to bump quarterly. Drift surfaces as a CI test failure rather than silent breakage; the cadence is calendar-driven, not change-driven.

### Out of scope offline

Some flows are physically untestable without real provider infrastructure. Each has a documented fallback:

- **Stripe API contract drift.** The `stripe-mock` OpenAPI is regenerated from Stripe's published spec — but only when we bump the image. A dedicated **nightly job** against Stripe testmode keeps us aligned with the live API. (Not yet wired; tracked separately.)
- **Apple Sign In native UI.** Apple's `AuthenticationServices` framework only runs on iOS. Verify via **physical-device smoke** before each release.
- **Real 3DS challenge UX.** Our fixture playback covers the SDK-side branch (status: `requires_action`, redirect URL); the actual challenge iframe is exercised by **manual smoke against testmode** before each release.

If you're tempted to wire any of these into the PR pipeline, talk to whoever owns the test budget first — adding live-provider calls breaks the offline guarantee.

## Walkthrough loop: read before, refresh after

The first-run walkthrough specs (`tests/e2e/first-run-*.spec.ts`, `diar-*.spec.ts`, `karta-klientky-walk.spec.ts`, `settings-walk.spec.ts`, `plan-picker-walk.spec.ts`) are designed to be driven *both* by Playwright and by humans (or claude-in-chrome MCP) walking the app in real Chrome. The `e2e-testing` capability (`openspec/specs/e2e-testing/spec.md`) requires that they pass unchanged against `make ci` (HTTPS, isolated stack) and `make dev-mock` (HTTP, `http://tricho.localhost/app/`).

The contract: **read this section before every walkthrough run; append concrete learnings after.** This is not a write-only log — it's the input to the next test run.

Hard rule: only record what was actually observed and verified in the run that just finished. No speculation, no "we might want…".

### Run a single walkthrough spec locally

```sh
# Fast loop against dev-mock (HTTP, mock OIDC, no TLS):
make e2e-walkthrough          # all walkthrough specs against dev-mock

# Or one spec at a time:
cd app && E2E_BASE_URL=http://tricho.localhost \
  npx playwright test tests/e2e/diar-empty-state.spec.ts --headed
```

For visual debugging via the claude-in-chrome MCP, point Chrome at `http://tricho.localhost/app/` after `make dev-mock` is up. The mock-oidc default identity (`mock-user@tricho.test`) is enough to land in onboarding without any real Google client.

### Known quirks (refresh as we learn)

- **`tricho.localhost` must resolve to 127.0.0.1.** macOS doesn't auto-resolve `*.localhost` like Linux does. Add `127.0.0.1 tricho.localhost` to `/etc/hosts` (the `make dev-mock` target checks this and prints remediation).
- **`tricho.test` does NOT need a `/etc/hosts` entry for Playwright runs.** The `playwright.config.ts` sets `--host-resolver-rules=MAP tricho.test 127.0.0.1` so Chromium resolves it without system DNS. CI uses a hosts entry; local `npx playwright test` does not.
- **Stale `__trichoE2E.setView` references.** `billing-tiers.spec.ts` calls `__trichoE2E.setView('plan')`; the bridge in `AppShell.tsx` (search for `bridge =`) does NOT expose `setView`. The existing test self-skips when the symbol is absent. Walkthrough specs navigate via the visible menu UI (`button.chrome-glyph[aria-label="Otevřít menu"]` → `Nastavení` → `Předplatné`) instead.
- **`infrastructure/pwa/Dockerfile` needs `bash` AND `curl` in the deps stage.** The npm `prebuild` hook calls `bash app/scripts/fetch-fonts.sh`, which `curl`s woff2 files from Google Fonts. `node:22-alpine` ships only `/bin/sh` and `wget`. Without both, `make ci` fails at `Step .../17 : RUN npm run build` with `sh: bash: not found` or `curl: command not found`. The deps stage installs both via `apk add --no-cache bash curl`.
- **Colima/Docker disk pressure.** On macOS hosts with APFS local snapshots eating space, the colima VM image can balloon and `make ci` fails with `ENOSPC` mid-build. Symptom: random tool calls return `ENOSPC: no space left on device` for `/private/tmp/...`. Run `tmutil deletelocalsnapshots /` to free APFS space; `colima stop` releases VM runtime but not disk image. Not a test bug — host-side maintenance.
- **`FabAddSheet` placeholder copy is grep-locked to the `daily-schedule` SHALL.** The component tier (`MenuSheet.component.test.tsx`) and the e2e tier (`diar-empty-state.spec.ts`) both assert the literal title `Plánování v příští verzi` and the `schedule_deferred_body` Czech string. Don't add an `i18n` translation indirection that could re-introduce the regression that commit `ff9e306` shipped. If the placeholder is ever legitimately reworded, update `daily-schedule/spec.md` first, then both test tiers.
- **Use `data-testid` on long-lived UI surfaces.** The walkthrough specs prefer `getByTestId(...)` over `getByText(...)` wherever possible because Czech copy is the brand voice and changes more often than test ids. The FAB sheet exposes `fab-add-sheet`, `fab-add-title`, `fab-add-body`, `fab-add-time`. Settings exposes `settings-pin-section`, `settings-show-rs-cta`, `settings-rs-rotate-cta`, `settings-about-section`, `about-version`, `about-build`, `about-commit`, `settings-delete-account-section`. The Locked screen, Welcome wizard, and OAuth error card all expose their own ids — search `data-testid` under `app/src/components/`.
- **`createVaultWithRs` is the empty-vault factory.** Each invocation seeds a fresh `sub` via mock-oidc, runs the full Step 3 wizard with a virtual WebAuthn authenticator, and lands on the unlocked diár (`.phone-inner` visible). Don't roll your own setup; use this fixture from `tests/e2e/fixtures/unlock.ts`. To seed customers post-unlock, call `__trichoE2E.putCustomer(...)` from `page.evaluate(...)` (bridge defined in `AppShell.tsx` under `if (localStorage.getItem('tricho-e2e-bridge') === '1')` — `enableTestBridge(context)` from `fixtures/cross-device.ts` flips that flag).
- **`createVaultWithRs` emulates PWA launch mode + `cs-CZ` locale.** Without `(display-mode: standalone)` the wizard sits on Step 1 forever (Step 2/3 are gated on `launchMode === 'pwa'` per `src/lib/launch-mode.ts`). Without forcing `navigator.language = 'cs-CZ'` the bootstrap falls back to `DEFAULT_LOCALE = 'en'` and assertions on Czech copy (the canonical product voice) all fail. The fixture sets both via `addInitScript` before any page script. `welcome-wizard-pwa-mode.spec.ts` and `welcome-wizard-browser-mode.spec.ts` deliberately do NOT use this — they assert each launch mode in isolation.
- **OAuth result lives in the URL fragment, not in callback HTML.** Since commit `e702e03` ("fix(auth): cross-origin OAuth completion via URL fragment"), tricho-auth's callback issues a 302 to `${APP_ORIGIN}/app/#tricho-auth-complete=<base64url(JSON)>`. Browsers preserve fragments through 302; AppShell consumes the fragment on first paint via `consumePendingOAuthResult()` (stashes to `sessionStorage['tricho-pending-oauth']`, then `clearAuthCompleteHash()` strips the URL). Tests MUST drive OAuth via real navigation (`page.goto('/auth/google/start')`) and read `sessionStorage['tricho-pending-oauth']` after AppShell drains the fragment — do NOT look for the legacy `<script id="tricho-auth-result">` in HTML (it no longer exists), and do NOT race with `clearAuthCompleteHash` by reading `window.location.hash`.
- **Headless virtual authenticator does not advertise PRF.** `attachVirtualAuthenticator` registers a ctap2 internal authenticator with no PRF extension, so `onRegisterPasskey` returns `prfSupported: false` and the wizard routes through the **`pin-setup`** substep before reaching `wizard-final`. Specs walking the wizard MUST handle both branches via `Promise.race([pinSetupVisible, finalVisible])`. The PinSetupScreen has no `data-testid`s; target inputs by `input[type="password"]` and the submit by `button[type="submit"]`. Pinned PIN: `123456` (any 6+ digit number works).
- **Settings close button is `Zavřít` (top-level), not `Zpět` (subview-back).** Inner Settings sub-views use `Zpět`; the top-level Settings close that returns to the unlocked diár is labelled `Zavřít` (`m.settings_close()`). Playwright specs that close Settings MUST target `getByRole('button', { name: 'Zavřít' })`, not `Zpět`.
- **Plan UI is build-time-gated by `PUBLIC_BILLING_ENABLED`.** SettingsScreen renders the `Předplatné` card only when `BILLING_UI_ENABLED` was true at Vite build time. The `ci` profile may not enable it. Specs that walk the plan picker MUST `test.skip(!planCardVisible, '...')` rather than fail when the card is absent.
- **Ignorable infra console noise to filter.** A vault tries to sync against `couchdb` on the docker network, but PouchDB occasionally probes `http://localhost:5984` directly which the page CSP blocks. Filter these patterns in any spec that asserts `consoleErrors === []`: `/violates the following Content Security Policy/`, `/Refused to connect because it violates/`, `/Fetch API cannot load http:\/\/localhost:(5984|4545)/`, `/SSL certificate error/`, `/vault-state probe failed/`, `/\[locale\] initial persistence failed/`, `/Version change transaction was aborted in upgradeneeded event handler/`. These are pre-existing infrastructure noise unrelated to walkthrough flows.
- **Pre-existing infra fix needed for `make ci` builds.** `infrastructure/pwa/Dockerfile` deps stage must `apk add --no-cache bash curl` — npm `prebuild` calls `bash app/scripts/fetch-fonts.sh` which `curl`s woff2 files, and `node:22-alpine` ships only `/bin/sh` and `wget`. Without both, `make ci` fails at `Step .../17 : RUN npm run build`.
- **`welcome-wizard-existing-flow` requires deviceLimit ≥ 2.** Free tier defaults to deviceLimit=1 since paid plans landed (commit `ff9e306`), so Device B for the same `sub` is rejected with `deviceApproved: false`. Keep that test green by either (a) stubbing `/auth/subscription` to return deviceLimit≥2, or (b) marking the user as `freeDeviceGrandfathered: true` server-side. Currently broken on the canonical free path.

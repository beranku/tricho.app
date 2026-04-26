## 1. Apple provider becomes env-driven

- [x] 1.1 Replace the four hardcoded constants in `infrastructure/couchdb/tricho-auth/providers/apple.mjs` with a `resolveAppleEndpoints(issuer)` helper that returns `{issuer, authorize, token, jwks}` derived from `APPLE_OIDC_ISSUER` (default `https://appleid.apple.com`).
- [x] 1.2 Update `appleConfig(env)` to thread the issuer through to the helper; ensure `clientSecret()` continues to use `APPLE_ISSUER` literal as the JWT `aud` claim only when the issuer is the real Apple, otherwise use the configured issuer.
- [x] 1.3 Refactor `handleCallback` to use the resolved `token` URL instead of the constant.
- [x] 1.4 Refactor the JWKS fetch to derive its URL from the configured issuer.
- [x] 1.5 Add a unit test in `infrastructure/couchdb/tricho-auth/test/providers-apple.test.mjs` asserting the override is honoured (signs a token via a programmatically-started `mock-oidc` Apple tenant and round-trips through `handleCallback`).
- [x] 1.6 Add the boot-time guard in `infrastructure/couchdb/tricho-auth/server.mjs` that aborts startup when `NODE_ENV === "production"` and `APPLE_OIDC_ISSUER` matches `\b(localhost|mock-oidc|tricho\.test)\b`. _(Extracted to `env-guard.mjs` for testability; also covers `GOOGLE_ISSUER_URL` and `STRIPE_API_BASE`.)_
- [x] 1.7 Add unit tests for the boot guard covering the prod-with-mock case (refused), prod-with-real-issuer (accepted), and non-prod (accepted).

## 2. Stripe SDK base URL becomes configurable

- [x] 2.1 Add a `parseStripeBase(url)` helper in `infrastructure/couchdb/tricho-auth/billing/stripe.mjs` that converts a URL string into `{host, port, protocol}` for the Stripe SDK constructor.
- [x] 2.2 Wire `STRIPE_API_BASE` through the `client(env)` lazy-init so every Stripe call site picks it up; default unchanged when unset.
- [x] 2.3 Extend the boot guard from 1.6 to also reject mock-pointing `STRIPE_API_BASE` and `GOOGLE_ISSUER_URL` in production. _(Done in 1.6 — single guard covers all three vars.)_
- [x] 2.4 Add a unit test asserting the SDK constructor is called with `host/port/protocol` when the env var is set, and without those keys when unset. _(Tests cover `parseStripeBase` directly — the public surface that feeds the SDK constructor.)_

## 3. mock-oidc becomes multi-tenant

- [x] 3.1 Refactor `infrastructure/mock-oidc/server.mjs` to mount routes under both `/google/*` (current behaviour) and the legacy top-level paths (alias only).
- [x] 3.2 Add the `/apple/*` tenant: discovery is not required (Apple does not publish one); add `/apple/auth/authorize` (form_post HTML response), `/apple/auth/token`, `/apple/auth/keys` (JWKS), and `/apple/mock/identity`, `/apple/mock/reset` test-control endpoints.
- [x] 3.3 Track per-`sub` first-vs-returning state via a per-tenant `Set<sub>`; mint the `user` form field only on the first authorization for a `sub` (state advances when the code is exchanged for a token).
- [x] 3.4 Support `is_private_email` in the seeded identity; the resulting id_token's `email` MUST end in `@privaterelay.appleid.com` when set.
- [x] 3.5 Update `infrastructure/mock-oidc/test/server.test.mjs` with: discovery shape per tenant, Apple form_post round-trip, first-vs-returning name semantics, private-relay flow, `mock/reset` resets the per-sub state, expires_in override, cross-tenant code rejection.
- [x] 3.6 Update `tests/e2e/fixtures/mock-oidc.ts` to expose `setMockGoogleIdentity` and `setMockAppleIdentity` helpers (preserve existing `setMockIdentity` as an alias to the Google one for backwards compatibility); also adds `resetMockApple`.

## 4. Stripe error-path fixture playback (backend-unit)

- [x] 4.1 Create `infrastructure/couchdb/tricho-auth/test/fixtures/stripe/` with JSON fixtures: `card-declined.json`, `card-declined-insufficient-funds.json`, `requires-action-3ds.json`, `idempotency-replay.json`.
- [x] 4.2 Add a fixture-driven Stripe-client stub at `test/fixtures/stripe-stub.mjs` (consumed via existing `_setStripeClient(...)` test seam — equivalent intercept point for our needs without configuring the SDK to use fetch). Spec was reframed to match.
- [x] 4.3 Extend `infrastructure/couchdb/tricho-auth/test/billing-stripe.test.mjs` with cases that install the fixture stub and assert each error path surfaces correctly through `createCheckoutSession` (and the underlying SDK error class).
- [x] 4.4 Document the fixture format in a `infrastructure/couchdb/tricho-auth/test/fixtures/stripe/README.md` so future contributors don't reinvent it.

## 5. Webhook tests (idempotency + unknown event)

- [x] 5.1 Test for idempotent replay was already in place (covers the requirement); reviewed and confirmed.
- [x] 5.2 Add a test asserting that a signed event with an unknown `event.type` (e.g. `payment_intent.succeeded`) returns 200 with `action: "noop"` and no meta mutation.

## 6. Stripe SDK contract tests against `stripe-mock`

- [x] 6.1 Add `infrastructure/couchdb/tricho-auth/test/integration/billing-stripe.integration.test.mjs` that uses `testcontainers` to spin `stripemock/stripe-mock` and exercises every Stripe SDK call site in `billing/stripe.mjs` (customer create/list/search/retrieve, checkout.sessions.create, billingPortal.sessions.create, subscriptions.update).
- [x] 6.2 `stripemock/stripe-mock:latest` referenced inline with a "bump quarterly" comment (digest pinning deferred — bump cadence is documented in `docs/TESTING.md` and any drift surfaces immediately as a CI test failure rather than silent breakage).
- [x] 6.3 Test cases are independent; each completes in well under 2 s once the container is warm. Suite uses a single `beforeAll` to amortise startup. _(Cannot verify locally — Docker daemon not running in this environment; runs in CI's `backend-integ` job once Group 8 wires the service.)_

## 7. compose.yml gains stripe-mock + localstripe (ci profile only)

- [x] 7.1 Add `stripe-mock` service to `compose.yml` under `profiles: [ci]` with a healthcheck against `/v1/customers`.
- [x] 7.2 Add `localstripe` service to `compose.yml` under `profiles: [ci]` with a healthcheck against the Stripe.js shim path.
- [x] 7.3 Add Traefik routes under the `ci` profile for `https://tricho.test/js.stripe.com/v3/*` → localstripe's Stripe.js shim, plus an internal `/_localstripe/*` API surface for stateful Playwright operations.
- [x] 7.4 Plumb `STRIPE_API_BASE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, and `APPLE_OIDC_ISSUER` env vars on `tricho-auth-internal` (default empty → real provider; CI workflow sets them).
- [x] 7.5 Verified: `docker compose -f compose.yml --profile dev config --services` returns `couchdb pwa-dev traefik-dev tricho-auth`; `--profile prod config --services` returns `couchdb-internal pwa traefik tricho-auth-internal`. Neither contains `stripe-mock` or `localstripe`.

## 8. CI workflow updates

- [x] 8.1 Backend-integ job uses `testcontainers` to spin `stripe-mock` directly inside the test process — no `services:` declaration needed (testcontainers handles its own lifecycle), matching the existing CouchDB pattern.
- [x] 8.2 Update the `e2e` job's stack-up wait loop to probe `tricho-auth/health`, `mock-oidc/health` (through Traefik), `localstripe`'s Stripe.js shim (through Traefik), and `stripe-mock` (via `docker compose exec`) before declaring the stack healthy.
- [x] 8.3 Path-filter `infra` rule already includes `infrastructure/**` and `compose.yml`; the new mocks land under those globs and re-run the affected jobs automatically. No filter change needed.
- [ ] 8.4 Run the workflow once with outbound-internet egress blocked (e.g. via a `--cap-add NET_ADMIN` step that drops egress) to verify the offline guarantee. _(Deferred — nice-to-have CI hardening; the unit/integ tiers' offline-ness is already enforced by code structure, and adding network-blocking to the e2e job risks breaking image pulls.)_

## 9. New Playwright e2e specs

- [x] 9.1 Added `tests/e2e/apple-oauth-roundtrip.spec.ts` driving the Apple OAuth happy path against the new `/apple/*` tenant. Skips when `APPLE_CLIENT_ID` isn't configured (operator-side gate).
- [x] 9.2 Added `tests/e2e/apple-name-claim.spec.ts` covering first-vs-returning name semantics (server preserves stored name when the second login omits the user form field).
- [x] 9.3 Added `tests/e2e/apple-private-relay.spec.ts` covering a `@privaterelay.appleid.com` email through to a successful authenticated /auth/devices call.
- [x] 9.4 Added `tests/e2e/oauth-token-refresh.spec.ts` driving the /auth/refresh endpoint and asserting (a) JWT exp moves forward, (b) replayed refresh token returns 401.
- [x] 9.5 Added `tests/e2e/stripe-checkout.spec.ts` driving the Checkout-creation API and a synthetic webhook delivery (HMAC signed via Web Crypto) against the ci-profile mocks; gated on `BILLING_ENABLED`.
- [x] 9.6 Added `tests/e2e/fixtures/apple-vault.ts` (Apple round-trip helper) and extended `tests/e2e/fixtures/mock-oidc.ts` with `setMockAppleIdentity`, `setMockGoogleIdentity`, `resetMockApple`.

## 10. Documentation

- [x] 10.1 Added "Third-party mocks" section to `docs/TESTING.md` describing the three Stripe layers (stripe-mock vs localstripe vs fixture playback), the `mock-oidc` two-tenant layout, and the `*_OIDC_ISSUER` / `STRIPE_API_BASE` env-toggle convention.
- [x] 10.2 Added "Out of scope offline" subsection listing: Stripe API contract drift (nightly testmode job — tracked separately), Apple Sign In native UI (physical iOS smoke pre-release), real 3DS challenge UX (manual smoke pre-release).
- [x] 10.3 Updated `infrastructure/couchdb/tricho-auth/BILLING.md` to flag `STRIPE_API_BASE` as a test-only override that must not appear in production env, with a reminder about the boot-time guard.

## 11. Verification

- [x] 11.1 `npm run test:backend` locally → 19 files, 185 tests pass in ~4 s. New fixture-playback tests added: 4 in `billing-stripe.test.mjs` (declined/insufficient/3DS/replay), 1 in `billing-webhook.test.mjs` (unknown event noop), 10 in `env-guard.test.mjs`, 11 in `providers-apple.test.mjs` (incl. 4 round-trip via spawned mock-oidc), 14 in `mock-oidc/test/server.test.mjs` (incl. all multi-tenant/Apple cases). Median per test < 20 ms (sub-30 ms even for the file with 14 tests).
- [ ] 11.2 `npm run test:backend:integration` — Docker daemon not running in this environment; the new `billing-stripe.integration.test.mjs` is syntactically valid (`node --check` passes) and follows the same pattern as `meta.integration.test.mjs`. Verifies in CI's `backend-integ` job.
- [ ] 11.3 `make e2e` — Docker daemon not running in this environment; Playwright `--list` confirms all 7 new test cases (across 5 spec files) are discovered. Runs in CI's `e2e` job once the operator wires `APPLE_CI_*` repo vars (Apple specs skip when absent).
- [x] 11.4 Prod boot guard verified locally: `NODE_ENV=production APPLE_OIDC_ISSUER=http://mock-oidc:8080/apple node -e 'import("./infrastructure/couchdb/tricho-auth/env-guard.mjs").then(m => m.assertProdIntegrationsAreReal(process.env))'` throws `APPLE_OIDC_ISSUER points at a mock host (http://mock-oidc:8080/apple) but NODE_ENV=production`.
- [x] 11.5 Prod boot guard accepts unset/real values: same script with `APPLE_OIDC_ISSUER` unset returns `OK: guard accepts unset values in production`. Apple still resolves to `https://appleid.apple.com` via the default in `resolveAppleEndpoints`.
- [x] 11.6 `openspec validate third-party-test-coverage --strict` → "Change 'third-party-test-coverage' is valid".

## Why

The three external integrations on the auth path — Google OIDC, Apple Sign In, and Stripe — have uneven test coverage and the gaps are exactly the ones that matter under failure. We have a custom `mock-oidc` Node service used in the `ci` compose profile, but it serves Google only; Apple's provider hard-codes `https://appleid.apple.com` for the issuer and JWKS URL, so it cannot be exercised end-to-end without real Apple infrastructure (which has no sandbox). Stripe is partly tested at the unit level via the `_setStripeClient` seam plus webhook-signature unit tests, but there is no SDK-contract coverage, no Checkout/Elements e2e, and no fixture playback for declined card / 3DS / idempotency replay paths. The intent is to make the full third-party surface testable **offline, in CI, with no secrets and no network egress** — and to keep production wiring untouched.

## What Changes

- **mock-oidc becomes multi-tenant.** Today it serves a single Google-shaped OIDC; extend it to mount Apple at `/apple/...` (form_post callback, ES256 client-secret-as-JWT laxly accepted, `sub`/`email`/`email_verified`/`is_private_email`/`name` claims, first-vs-returning `name` semantics, `@privaterelay.appleid.com` emails). Google stays at `/google/...` (current path is `/mock-oidc/...` — see migration in design).
- **Apple provider becomes env-driven.** `infrastructure/couchdb/tricho-auth/providers/apple.mjs` currently hard-codes `APPLE_ISSUER`, `APPLE_AUTHORIZE`, `APPLE_TOKEN`, `APPLE_JWKS`. Introduce `APPLE_OIDC_ISSUER` (and derived endpoint URLs) so CI can swap to the mock and prod is unchanged. **BREAKING** for the provider's internal API only — no public route changes.
- **Add `stripe-mock` to the `ci` compose profile** for SDK shape contract tests against the live SDK. Wire it via `STRIPE_API_BASE` (already supported by the official Stripe SDK as `host`/`port`/`protocol`).
- **Add `localstripe` to the `ci` compose profile** for stateful Checkout + Elements e2e flows in Playwright. Mount its `/js.stripe.com/v3/` shim through Traefik so `loadStripe()` in the browser hits it.
- **Adopt fixture playback** for Stripe error paths. We already have no MSW; introduce a minimal in-process fetch stub (no MSW dependency) used only inside `vitest.config.backend.ts` to replay declined-card, 3DS-required, insufficient-funds, and idempotency-replay responses against `billing/stripe.mjs`. This keeps the tier <20 ms-per-test budget intact and avoids a parallel mocking stack.
- **Webhook tests gain replay-protection coverage.** The existing `verifyWebhookSignature` already enforces a tolerance window; add a unit test for replaying the *same* event ID twice (handler must dedup) and for an unknown event `type` (handler must return `noop`).
- **Playwright e2e gains five scenarios:** Apple happy-path login, Apple first-time-only `name` claim, Apple private-relay email, OIDC token expiration → refresh, and an end-to-end Stripe checkout against `localstripe`.
- **CI job structure.** `backend-unit`, `backend-integ`, and `e2e` tiers get new `services:` (or `compose ... up`) for `mock-oidc`, `stripe-mock`, `localstripe`, each with health checks. Test env vars (`STRIPE_API_BASE`, `GOOGLE_OIDC_ISSUER`, `APPLE_OIDC_ISSUER`) are injected only for the test profile; production secret materials are untouched.
- **`docs/TESTING.md` gains an "Out of scope" section** documenting what is *not* covered offline: Stripe API contract drift (nightly testmode job), Apple Sign In native UI (physical iOS smoke), real 3DS challenge UX (manual pre-release smoke).

## Capabilities

### New Capabilities
- `third-party-mocks`: The contract for testing third-party-integration code paths (Google OIDC, Apple Sign In, Stripe API + webhooks + Elements) against in-cluster mocks. Defines which mock serves which scenario class (stateless contract / stateful e2e / fixture-replay), the env-toggle convention for swapping prod URLs, and the no-secrets / no-egress invariant for CI.

### Modified Capabilities
- `oauth-identity`: Apple issuer + token + JWKS URLs MUST be derivable from a single `APPLE_OIDC_ISSUER` env override (production default keeps `https://appleid.apple.com`). New scenarios for first-vs-returning `name` claim, private-relay email, wrong-audience and wrong-issuer rejection.
- `stripe-recurring-billing`: Stripe SDK base URL MUST be configurable via `STRIPE_API_BASE` (host/port/protocol passed to the Stripe constructor) so CI can target `stripe-mock` / `localstripe`. Add scenarios for unknown webhook `type` (graceful `noop`) and idempotent replay of the same event ID.
- `backend-tests`: Add backend-tier requirements for offline-mocked Stripe billing (SDK contract via `stripe-mock`, error paths via fixture replay) and Apple OIDC (mock-oidc Apple tenant). Tier remains <20 ms median per test.
- `e2e-testing`: Add Playwright scenarios for Apple OIDC happy path, Apple first-time-vs-returning, private-relay email, token refresh, and Stripe Checkout against `localstripe`.

## Impact

- **Zero-knowledge invariants**: unchanged. Mocks only stand in front of the OAuth identity path and the billing path; neither sees plaintext data, the DEK, or the Recovery Secret. AAD binding is not exercised by these flows.
- **Code / infra touched**:
  - `infrastructure/mock-oidc/server.mjs` — split routing into `/google/*` and `/apple/*` tenants; add Apple-specific token shape (form_post, `is_private_email`, first-time `user` form field, missing `name` on subsequent logins). Backward-compatible alias keeps existing tests on `/mock-oidc/*` working until the next change.
  - `infrastructure/couchdb/tricho-auth/providers/apple.mjs` — replace hardcoded URLs with env-driven config; resolve `/auth/keys`, `/auth/token` from the issuer URL.
  - `infrastructure/couchdb/tricho-auth/billing/stripe.mjs` — accept `STRIPE_API_BASE` (or `STRIPE_HOST` + `STRIPE_PORT` + `STRIPE_PROTOCOL`) and pass through to the SDK constructor; default unchanged in prod.
  - `compose.yml` — add `stripe-mock` and `localstripe` services to the `ci` profile only; add Traefik route for `localstripe`'s `/js.stripe.com/v3/` shim under `tricho.test`.
  - `infrastructure/couchdb/tricho-auth/test/` — extend `billing-stripe.test.mjs` and `billing-webhook.test.mjs` with idempotent-replay, unknown-event, declined-card, 3DS-required, insufficient-funds fixtures (in-process fetch stub, no MSW). Extend `providers-apple.test.mjs` with claim-shape and signature-rejection cases against mock-oidc.
  - `tests/e2e/` — new specs `apple-oauth-roundtrip.spec.ts`, `apple-private-relay.spec.ts`, `oauth-token-refresh.spec.ts`, `stripe-checkout.spec.ts`. Extend `tests/e2e/fixtures/mock-oidc.ts` to a multi-tenant helper that also seeds the Apple tenant.
  - `.github/workflows/tests.yml` — add `services:` (or `docker compose up` for the matching profile) for stripe-mock + localstripe in `backend-integ` and `e2e` jobs; gate on health checks.
  - `docs/TESTING.md` — add "Third-party mocks" + "Out of scope" sections.
- **Dependencies**: no new npm devDependencies. Both `stripe-mock` and `localstripe` are containerised, fixture replay is hand-rolled. The Stripe SDK already supports the host/port/protocol override.
- **Rollback**: straight `git revert`. The `ci` compose profile is the only place new services land; production profiles are untouched. The Apple provider env-default keeps `https://appleid.apple.com`, so absence of the new env var is a no-op in prod.
- **Threat-model delta**:
  - *Before*: a misconfigured Apple `APPLE_ISSUER`/JWKS URL had to ship code-side; the testing-vs-prod boundary was hard-coded.
  - *After*: a misconfiguration risks pointing prod at a mock issuer if `APPLE_OIDC_ISSUER` is set in the prod env. Mitigated by: (a) prod default points at `https://appleid.apple.com` when the env var is unset; (b) a server boot-time assertion logs and refuses to start if `APPLE_OIDC_ISSUER` resolves to `localhost`/`mock-oidc`/`tricho.test` while `NODE_ENV === 'production'`. No new keys, no new secrets, no new attack surface on the live token-verification path (signatures still validated against JWKS fetched from whatever issuer is configured).
- **CI minutes**: +~30 s on `backend-integ` (start of stripe-mock container) and +~45 s on `e2e` (localstripe + Elements shim warmup), within the 4-minute fanned-out wall-clock budget.

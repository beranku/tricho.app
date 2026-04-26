# third-party-mocks Specification

## Purpose

The contract for testing third-party-integration code paths (Google OIDC, Apple Sign In, Stripe API + webhooks + Stripe Elements) against in-cluster mocks. Defines which mock serves which scenario class (stateless contract / stateful e2e / fixture-replay), the env-toggle convention for swapping prod URLs, and the no-secrets / no-egress invariant for CI.

Source files: `infrastructure/mock-oidc/server.mjs`, `infrastructure/couchdb/tricho-auth/billing/stripe.mjs`, `infrastructure/couchdb/tricho-auth/env-guard.mjs`, `infrastructure/couchdb/tricho-auth/test/fixtures/stripe/`, `compose.yml`.

## Requirements

### Requirement: Single env-toggle convention for prod-vs-mock URLs
Every third-party integration on the auth path (Google OIDC, Apple Sign In, Stripe API + webhooks) MUST resolve its remote endpoint base URL from a single environment variable that defaults to the real provider when unset. The variable names MUST be `GOOGLE_ISSUER_URL`, `APPLE_OIDC_ISSUER`, and `STRIPE_API_BASE`. Other endpoint URLs (token, JWKS, authorize) MUST be derived from the issuer or base — they MUST NOT be configured separately.

#### Scenario: Production defaults
- **WHEN** the `tricho-auth` server starts with none of the three variables set
- **THEN** Google OIDC discovery resolves `https://accounts.google.com`
- **AND** Apple's authorize, token, and JWKS endpoints resolve to `https://appleid.apple.com/auth/{authorize,token,keys}`
- **AND** the Stripe SDK targets `api.stripe.com`

#### Scenario: CI overrides
- **WHEN** the server starts with `GOOGLE_ISSUER_URL=http://mock-oidc:8080/google`, `APPLE_OIDC_ISSUER=http://mock-oidc:8080/apple`, and `STRIPE_API_BASE=http://stripe-mock:12111`
- **THEN** every outbound call from `providers/google.mjs`, `providers/apple.mjs`, and `billing/stripe.mjs` MUST target the mock host
- **AND** no call leaks to the real provider

### Requirement: Production refuses mock-pointing env values
The `tricho-auth` server MUST refuse to start when `NODE_ENV === "production"` AND any of `GOOGLE_ISSUER_URL`, `APPLE_OIDC_ISSUER`, or `STRIPE_API_BASE` resolves to a hostname matching `localhost`, `mock-oidc`, or `tricho.test` (word-boundary match). The refusal MUST be a process-level abort with an error message naming the offending variable, not a silent fallback.

#### Scenario: Mock-pointing Apple issuer in prod aborts boot
- **GIVEN** `NODE_ENV=production` and `APPLE_OIDC_ISSUER=http://mock-oidc:8080/apple`
- **WHEN** the server is started
- **THEN** the process exits non-zero
- **AND** stderr contains the string `APPLE_OIDC_ISSUER points at a mock host`

#### Scenario: Real Apple issuer in prod is accepted
- **GIVEN** `NODE_ENV=production` and `APPLE_OIDC_ISSUER=https://appleid.apple.com`
- **WHEN** the server is started
- **THEN** the process reaches the listening state without aborting

### Requirement: mock-oidc serves Google AND Apple tenants
`infrastructure/mock-oidc/server.mjs` MUST mount two tenants behind path prefixes `/google/*` and `/apple/*`. Each tenant MUST publish its own discovery doc (or, for Apple, a JWKS at the issuer-relative path), its own `/authorize`, `/token`, and (for Apple only) a `form_post`-shaped callback HTML. Top-level routes (`/.well-known/openid-configuration`, `/authorize`, `/token`, `/userinfo`, `/mock/identity`) MUST remain as backwards-compatible aliases to `/google/*` until a follow-up change removes them.

#### Scenario: Discovery responses differ per tenant
- **WHEN** `GET /google/.well-known/openid-configuration` is fetched
- **THEN** the response's `issuer` field equals `${MOCK_OIDC_ISSUER_BASE}/google`
- **AND** `authorization_endpoint` ends in `/google/authorize`

#### Scenario: Apple JWKS reachable at issuer-relative path
- **WHEN** `GET /apple/auth/keys` is fetched
- **THEN** the response is a valid RFC 7517 JWKS document with at least one ES256-or-RS256 key

#### Scenario: Top-level alias still works
- **WHEN** `GET /authorize?...` is fetched
- **THEN** the behavior is identical to `GET /google/authorize?...`

### Requirement: Apple tenant simulates the first-vs-returning `name` semantics
The `/apple/*` tenant MUST track per-`sub` authorization state. The first `/apple/authorize` for a given `sub` MUST include the `user` JSON form field on the callback (with `name.firstName`, `name.lastName`). Subsequent authorizations for the same `sub` MUST omit the `user` field. A `POST /apple/mock/reset` endpoint MUST clear this state for testing.

#### Scenario: First login returns the name
- **GIVEN** a `sub` not seen before by the Apple tenant
- **WHEN** the test drives the Apple `/authorize` → `/token` flow
- **THEN** the callback's `form` payload contains a parseable `user` field with `firstName` and `lastName`

#### Scenario: Second login omits the name
- **GIVEN** a `sub` that has already authorized once
- **WHEN** the same flow runs again
- **THEN** the callback's `form` payload does NOT contain a `user` field

#### Scenario: Reset endpoint enables replay
- **GIVEN** a `sub` that has authorized once
- **WHEN** `POST /apple/mock/reset` is called with `{sub}`
- **AND** the same `sub` authorizes again
- **THEN** the callback again carries the `user` field

### Requirement: Apple tenant supports private-relay emails
The `/apple/*` tenant MUST mint id_tokens whose `email_verified === true`, `is_private_email === true`, and `email` matches `*@privaterelay.appleid.com` when the test seeds an identity with `is_private_email: true`. Otherwise the id_token MUST carry `is_private_email === false` and the seeded email verbatim.

#### Scenario: Private-relay identity drives a private email through the flow
- **WHEN** `POST /apple/mock/identity` is called with `{sub: "a-priv-1", is_private_email: true}`
- **AND** the test completes Apple OAuth
- **THEN** the id_token's `email` ends in `@privaterelay.appleid.com`
- **AND** `is_private_email === true`

### Requirement: stripe-mock and localstripe live in the ci compose profile only
`compose.yml` MUST declare `stripe-mock` (Docker `stripemock/stripe-mock`, port 12111) and `localstripe` (Docker, port 8420 plus a `/js.stripe.com/v3/` shim under Traefik) under `profiles: [ci]`. Both services MUST have a healthcheck and MUST NOT appear in `dev` or `prod` compose configs.

#### Scenario: Mocks absent in dev config
- **WHEN** `docker compose --profile dev config --services` is inspected
- **THEN** neither `stripe-mock` nor `localstripe` appears

#### Scenario: Mocks absent in prod config
- **WHEN** `docker compose --profile prod config --services` is inspected
- **THEN** neither `stripe-mock` nor `localstripe` appears

#### Scenario: Mocks healthy under ci profile
- **WHEN** `docker compose --profile ci up -d` is run
- **THEN** within 60 s `docker compose ps stripe-mock` and `docker compose ps localstripe` both report `healthy`

### Requirement: localstripe Elements shim is reachable through Traefik
The `ci` Traefik configuration MUST route requests to `https://tricho.test/js.stripe.com/v3/` to the `localstripe` container's Stripe.js shim. This MUST allow a Playwright spec calling `loadStripe(publishableKey)` from the in-browser PWA to receive a working Stripe.js without any network egress.

#### Scenario: Browser loads Elements from the mock
- **GIVEN** the `ci` profile up and the PWA loaded in Playwright
- **WHEN** the in-page code calls `loadStripe('pk_test_localstripe')`
- **THEN** the resolved `Stripe` object exposes `elements()` and `redirectToCheckout()`
- **AND** the network log shows the script was served by `localstripe`, not `js.stripe.com`

### Requirement: Stripe error paths use in-process fixture playback, not MSW
Backend-unit tests for declined-card, 3DS-required, insufficient-funds, and idempotent-replay scenarios MUST install a fixture-driven Stripe-client substitute via the existing `_setStripeClient(...)` test seam in `billing/stripe.mjs`. The fixtures MUST live under `infrastructure/couchdb/tricho-auth/test/fixtures/stripe/` as plain JSON request/response pairs and be consumed by a small `test/fixtures/stripe-stub.mjs` helper (~100 lines) that reads them and returns a Stripe-shaped object. The project MUST NOT introduce MSW (`msw`, `@mswjs/*`) or Nock as runtime or dev dependencies.

#### Scenario: Declined card surfaces the right error code
- **GIVEN** a backend-unit test loading the `card-declined.json` fixture
- **WHEN** the code under test calls `stripe.subscriptions.create(...)`
- **THEN** the call rejects with a `StripeCardError` whose `decline_code` matches the fixture
- **AND** no real network call is attempted

#### Scenario: MSW would be added in a PR — review fails
- **GIVEN** a hypothetical PR adding `"msw": "*"` to `package.json`
- **WHEN** CI / review runs `grep -E '"(msw|@mswjs/)' package.json`
- **THEN** the match is treated as a review-stop signal under this requirement

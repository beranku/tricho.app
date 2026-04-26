## ADDED Requirements

### Requirement: Stripe SDK contract is tested against stripe-mock at the integration tier
`infrastructure/couchdb/tricho-auth/test/integration/billing-stripe.integration.test.mjs` MUST use `testcontainers` to start `stripemock/stripe-mock` and MUST exercise every code path in `billing/stripe.mjs` that issues an outbound Stripe SDK call (`customers.create`, `customers.list`, `customers.search`, `customers.retrieve`, `checkout.sessions.create`, `billingPortal.sessions.create`, `subscriptions.update`). For each call, the test MUST assert the request shape parses against `stripe-mock`'s OpenAPI (a 200/201 response from the mock is sufficient evidence).

#### Scenario: Every Stripe call site has a contract test
- **GIVEN** the integration suite running with `STRIPE_API_BASE` pointed at the testcontainer
- **WHEN** the suite executes
- **THEN** at least one assertion exists per call site listed above
- **AND** every assertion completes within the integration tier's <2 s budget

### Requirement: Stripe error paths are tested via fixture playback at the unit tier
`infrastructure/couchdb/tricho-auth/test/billing-stripe.test.mjs` MUST cover the following failure cases without any container or network: declined card (`StripeCardError` with `decline_code: "card_declined"`), insufficient funds (`decline_code: "insufficient_funds"`), 3DS required (`status: "requires_action"`), and idempotency replay (same `Idempotency-Key` returns the cached prior result). Fixtures MUST live as plain JSON under `infrastructure/couchdb/tricho-auth/test/fixtures/stripe/`. The unit tier MUST stay under its 20 ms median budget.

#### Scenario: Declined card path tested
- **GIVEN** the `card-declined.json` fixture
- **WHEN** the test code under `billing-stripe.test.mjs` invokes the path that calls `stripe.subscriptions.create`
- **THEN** the assertion catches a `StripeCardError`
- **AND** the test runs in under 50 ms total

#### Scenario: Idempotency replay returns cached result
- **GIVEN** a fixture pair where the first call to `customers.create` with `Idempotency-Key: K` returns 200 and the second call with the same key returns the same body
- **WHEN** the handler under test makes both calls
- **THEN** the second call's response equals the first
- **AND** no second mutation event is emitted to the meta layer

### Requirement: Webhook idempotency and unknown-event handling are pinned
`billing-webhook.test.mjs` MUST cover: replaying the same `event.id` twice (handler returns 200 with no second mutation), and an unknown `event.type` (handler returns 200 with `action: "noop"`).

#### Scenario: Replay of same event.id is a no-op
- **GIVEN** a meta-fake whose `recordPaymentEvent('evt_xyz')` returns `{accepted: false, dedup: true}` on the second call
- **WHEN** the same signed `invoice.paid` is delivered twice
- **THEN** the meta state mutates exactly once
- **AND** both deliveries return 200

#### Scenario: Unknown event type acknowledged but not acted on
- **GIVEN** a signed event with `type: "payment_intent.succeeded"` (which the handler does not recognise)
- **WHEN** the webhook is delivered
- **THEN** the response is 200
- **AND** no `meta.updateSubscription` or `meta.creditPaidUntil` call is observed

### Requirement: Apple provider has unit tests for first-vs-returning, private-relay, and signature rejection
`providers-apple.test.mjs` MUST cover:
- A successful first-time login that parses `form.user` and returns `{name, email, sub}`.
- A successful returning login (no `form.user`) that returns `{name: null, email, sub}`.
- A private-relay email accepted without explicit `email_verified: true`.
- An id_token whose `aud` does not match the configured client ID is rejected.
- An id_token whose `iss` does not match `APPLE_OIDC_ISSUER` is rejected.

The provider MUST be exercised with `APPLE_OIDC_ISSUER` pointed at a programmatically-started `mock-oidc` instance in the unit-tier setup (no Docker — `child_process.spawn` of the existing Node script is sufficient).

#### Scenario: Wrong audience rejected
- **GIVEN** a mock-oidc-signed Apple id_token whose `aud` is `wrong.client.id`
- **WHEN** `handleCallback` runs
- **THEN** the call throws an audience-mismatch error
- **AND** no user object is returned

### Requirement: Backend tests remain offline
The existing backend-tests requirement that "no backend test SHALL make outbound network calls to the public internet" MUST extend to the new Stripe and Apple test surfaces added by this change. The integration tier's `STRIPE_API_BASE` MUST always resolve to a `localhost` or testcontainer host; the unit tier MUST never load the real Stripe SDK transport.

#### Scenario: Network-disabled CI run still passes the new tests
- **GIVEN** the new Stripe + Apple tests added by this change
- **WHEN** the backend-tier and backend-integ jobs run with outbound internet blocked (`--network none` or iptables egress drop)
- **THEN** every test exits green
- **AND** the runner logs show no denied-connection messages

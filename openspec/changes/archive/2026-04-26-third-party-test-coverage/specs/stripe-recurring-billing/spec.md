## ADDED Requirements

### Requirement: Stripe SDK base URL is configurable
`infrastructure/couchdb/tricho-auth/billing/stripe.mjs` MUST accept an optional `STRIPE_API_BASE` env var. When set, the value MUST be parsed into the `host`, `port`, and `protocol` options of the Stripe SDK constructor; when unset, the SDK MUST target `api.stripe.com` (its default). The override MUST apply to every Stripe SDK call site (customers, subscriptions, checkout, billingPortal) without per-call wiring.

#### Scenario: Default points at the real Stripe API
- **GIVEN** `STRIPE_API_BASE` is unset
- **WHEN** the Stripe client is lazily constructed
- **THEN** the client's outbound calls target `api.stripe.com` over HTTPS

#### Scenario: CI override points at stripe-mock
- **GIVEN** `STRIPE_API_BASE=http://stripe-mock:12111`
- **WHEN** `stripe.customers.create({...})` is invoked
- **THEN** the request goes to `http://stripe-mock:12111/v1/customers`
- **AND** no DNS resolution of `api.stripe.com` is attempted

### Requirement: Declined card surfaces a typed error
The Checkout-creation handler MUST surface a Stripe `card_declined` failure as a 402 response with body `{error: "card_declined", decline_code: <stripe-supplied>}` and MUST NOT mutate any subscription doc. The handler MUST log the failure with the canonical username but MUST NOT log the card PAN or last4.

#### Scenario: card_declined returns 402
- **GIVEN** a fixture where the Stripe SDK's `subscriptions.create` rejects with `StripeCardError` `decline_code: "insufficient_funds"`
- **WHEN** `POST /auth/billing/stripe/checkout` is called
- **THEN** the response is `402 {error: "card_declined", decline_code: "insufficient_funds"}`
- **AND** the subscription doc remains `tier: "free"`

### Requirement: 3DS-required surfaces as a recoverable status
A Stripe response indicating an authentication-required state (`status: "requires_action"` with `next_action.type === "use_stripe_sdk"` or `redirect_to_url`) MUST be surfaced to the client as a 200 response carrying the redirect URL or PaymentIntent client_secret, NOT as a server-side error. The client is responsible for completing the SCA challenge.

#### Scenario: 3DS-required returns the action payload
- **GIVEN** a Stripe-returned `requires_action` PaymentIntent with `next_action.redirect_to_url.url`
- **WHEN** the handler receives the SDK response
- **THEN** the client receives `200 {status: "requires_action", redirect_url: <url>}`
- **AND** no subscription doc is mutated yet (mutation happens via webhook after challenge completes)

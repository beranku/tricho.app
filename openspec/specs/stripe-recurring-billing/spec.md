# stripe-recurring-billing Specification

## Purpose
TBD - created by archiving change paid-plans-billing. Update Purpose after archive.
## Requirements
### Requirement: Stripe Checkout session creation
`POST /auth/billing/stripe/checkout` MUST accept `{plan: "sync-monthly" | "sync-yearly", successUrl, cancelUrl}` and return `{checkoutUrl}`. The endpoint MUST require a valid bearer JWT and MUST resolve to the caller's canonical username. The Checkout Session MUST be created with `mode: "subscription"`, `line_items: [{price: <env price ID for the plan>, quantity: 1}]`, `client_reference_id: <canonicalUsername>`, and `metadata.canonicalUsername`. If the user has an unexpired `paidUntil` from a non-Stripe provider, the session MUST set `subscription_data.trial_period_days` to bridge to that date.

#### Scenario: Free user starts Stripe Checkout
- **GIVEN** a free user with `paidUntil: null`
- **WHEN** they `POST /auth/billing/stripe/checkout` with `plan: "sync-monthly"`
- **THEN** the response is `200 {checkoutUrl: "https://checkout.stripe.com/..."}`
- **AND** the Stripe Checkout Session was created with `client_reference_id` equal to the user's canonicalUsername

#### Scenario: Bank-transfer user upgrades to Stripe with trial bridge
- **GIVEN** a user with `provider: "bank-transfer"`, `paidUntil = now() + 18 * 86400`
- **WHEN** they post the same request
- **THEN** the Stripe Checkout Session is created with `subscription_data.trial_period_days === 18`

#### Scenario: Unauthenticated request rejected
- **WHEN** `POST /auth/billing/stripe/checkout` is called without a bearer
- **THEN** the response is `401`

### Requirement: Stripe customer portal redirect
`GET /auth/billing/stripe/portal` MUST return `{portalUrl}` for the caller's Stripe customer. If the user has no Stripe customer yet, the response MUST be `409 no_stripe_customer`.

#### Scenario: Paid Stripe user opens portal
- **GIVEN** a user with `stripeCustomerId` set
- **WHEN** they call `GET /auth/billing/stripe/portal?return_url=https://app.tricho.app/settings`
- **THEN** the response is `200 {portalUrl: "https://billing.stripe.com/..."}`

#### Scenario: Non-Stripe user blocked from portal
- **GIVEN** a `bank-transfer` user with no `stripeCustomerId`
- **WHEN** they call `GET /auth/billing/stripe/portal`
- **THEN** the response is `409 no_stripe_customer`

### Requirement: Webhook signature verification
`POST /auth/billing/stripe/webhook` MUST verify the request signature using the `Stripe-Signature` header against the configured webhook secret, per Stripe's HMAC-SHA256 spec. Requests with missing or invalid signatures MUST be rejected with `400 invalid_signature` and MUST NOT mutate any subscription doc.

#### Scenario: Valid webhook accepted
- **GIVEN** a Stripe-signed `invoice.paid` event
- **WHEN** delivered to the webhook endpoint
- **THEN** the response is `200`
- **AND** the corresponding subscription doc is updated

#### Scenario: Forged webhook rejected
- **GIVEN** a request with a forged `Stripe-Signature` header
- **WHEN** delivered to the webhook endpoint
- **THEN** the response is `400 invalid_signature`
- **AND** no subscription doc is touched

### Requirement: Webhook is the canonical writer
The webhook handler MUST be the only code path that sets `paidUntil`, `status`, `provider`, `plan`, `stripeSubscriptionId` for a Stripe-tracked subscription. Other handlers (e.g. the redirect from Checkout) MUST NOT mutate these fields based on Stripe data.

#### Scenario: Successful Checkout updates state only after webhook
- **GIVEN** a free user redirected back from Checkout to `successUrl`
- **WHEN** the redirect handler runs but the webhook has not yet fired
- **THEN** the subscription doc still has `tier: "free"`, `entitlements: []`
- **AND** the redirect handler returns a "processing" view, not paid state

#### Scenario: Webhook arrives, state flips
- **GIVEN** the prior scenario's user
- **WHEN** the `customer.subscription.created` + `invoice.paid` webhooks arrive
- **THEN** the subscription doc has `tier: "paid"`, `entitlements: ["sync","backup"]`, `paidUntil` ≈ `now() + periodSeconds`

### Requirement: Event handling matrix
The webhook handler MUST map Stripe events as follows:
- `customer.subscription.created` and `customer.subscription.updated`: upsert `stripeCustomerId`, `stripeSubscriptionId`, `plan` (mapped from price ID), `status` (Stripe `active|past_due|canceled` → local equivalent), `provider: "stripe"`.
- `invoice.paid`: extend `paidUntil` per the `paidUntil` math (max(now, old) + periodSeconds), set `status: "active"`, `entitlements: ["sync","backup"]`.
- `customer.subscription.deleted`: set `status: "canceled"`, leave `paidUntil` (service runs to end of paid period).
- `invoice.payment_failed`: set `status: "past_due"`, leave `entitlements` unchanged (grace window applies).

Any other event types MUST be acknowledged with `200` and no-op'd.

#### Scenario: Subscription canceled
- **GIVEN** a paid Stripe user with `paidUntil = now() + 12 * 86400`
- **WHEN** a `customer.subscription.deleted` webhook arrives
- **THEN** `status: "canceled"`, `paidUntil` unchanged
- **AND** `entitlements` still includes `"sync"` until `paidUntil` lapses

#### Scenario: Payment failed
- **GIVEN** a paid Stripe user
- **WHEN** an `invoice.payment_failed` webhook arrives
- **THEN** `status: "past_due"`, `entitlements` unchanged

#### Scenario: Unknown event no-op'd
- **GIVEN** any other event type Stripe may emit
- **WHEN** it arrives
- **THEN** response is `200`
- **AND** no subscription doc is mutated

### Requirement: Stripe customer keyed by canonical username via metadata
On first Checkout for a user, the webhook MUST resolve the user via `customer.metadata.canonicalUsername`. If a Stripe customer exists with that metadata field already, it MUST be reused; otherwise, the customer is created with that metadata. The local `stripeCustomerId` lookup is a hint, not the only path — recovery from a lost subscription doc MUST be possible by querying Stripe by metadata.

#### Scenario: Existing Stripe customer reused
- **GIVEN** a Stripe customer with `metadata.canonicalUsername === "g_abc"` already exists
- **WHEN** the same user starts Checkout
- **THEN** the new Checkout Session is bound to that existing customer
- **AND** no duplicate customer is created

### Requirement: Cancellation request via API
`POST /auth/subscription/cancel` for a Stripe-tracked subscription MUST call Stripe's `subscription.update` with `cancel_at_period_end: true` and MUST NOT mutate local `paidUntil`. Local state changes occur via the webhook.

#### Scenario: Cancel sets cancel_at_period_end
- **GIVEN** a Stripe-paid user
- **WHEN** they call `POST /auth/subscription/cancel`
- **THEN** the Stripe API receives `subscription.update({cancel_at_period_end: true})`
- **AND** the response is `200`
- **AND** local `paidUntil` is unchanged

### Requirement: Webhook idempotency via dedup table
The webhook handler MUST consult `payment-event:stripe:<eventId>` in `tricho_meta` before mutating state. Repeat events MUST return `200` without state changes.

#### Scenario: Stripe retries an `invoice.paid`
- **GIVEN** a webhook with event id `evt_xyz` already processed
- **WHEN** Stripe redelivers the same event
- **THEN** the handler returns `200`
- **AND** `paidUntil` is unchanged from the first delivery

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


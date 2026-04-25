## ADDED Requirements

### Requirement: Payment-intent issuance
`POST /auth/billing/bank-transfer/intent` MUST accept `{plan: "sync-monthly" | "sync-yearly"}` from a bearer-authenticated user and return `{intentId, vs, amount, currency, iban, accountNumber, expiresAt, qrCodePayload}`. The handler MUST:
1. Reject with `409 active_subscription` if the user has an active Stripe subscription.
2. Generate a globally unique 10-digit `vs` (variable symbol). On collision, retry up to 5 times.
3. Create a `payment-intent:<intentId>` doc in `tricho_meta` with `{type: "payment-intent", userId, plan, vs, amountMinor, currency, status: "pending", createdAt, expiresAt: createdAt + 14 * 86400 * 1000}`.
4. Read `iban`, `accountNumber`, and the configured plan amount from env config.
5. Compose `qrCodePayload` as a Czech SPAYD string: `SPD*1.0*ACC:<iban>*AM:<amount>*CC:<currency>*X-VS:<vs>*MSG:Tricho <plan>`.

#### Scenario: Free user requests monthly intent
- **GIVEN** a free user with no active paid subscription
- **WHEN** they `POST /auth/billing/bank-transfer/intent` with `plan: "sync-monthly"`
- **THEN** the response is `200`
- **AND** the body contains a 10-digit numeric `vs`
- **AND** `expiresAt` is `createdAt + 14 days`
- **AND** `qrCodePayload` starts with `SPD*1.0*ACC:`

#### Scenario: User with active Stripe subscription blocked
- **GIVEN** a user with `provider: "stripe", status: "active"`
- **WHEN** they call the intent endpoint
- **THEN** the response is `409`
- **AND** the body has `{error: "active_subscription", provider: "stripe"}`

#### Scenario: VS uniqueness across intents
- **GIVEN** any number of prior intents
- **WHEN** a new intent is generated
- **THEN** the new `vs` does not collide with any existing pending intent's `vs`

### Requirement: Admin confirmation endpoint
`POST /auth/billing/bank-transfer/admin/confirm` MUST require an admin bearer token (separate from user JWT, configured in env). It MUST accept `{intentId}`. The handler MUST:
1. Verify the admin token; reject `401` otherwise.
2. Load the intent. Reject with `404` if missing.
3. Reject with `410 intent_expired` if `expiresAt < now()`.
4. Check `payment-event:bank-transfer:<intentId>` dedup; if present, return `200` with no mutation.
5. Otherwise: credit `paidUntil` per the `paidUntil` math, set `tier: "paid"`, `plan` to the intent's plan, `provider: "bank-transfer"`, `status: "active"`, `entitlements: ["sync","backup"]`. Mark intent `status: "paid"`, write `paidAt`. Insert `payment-event:bank-transfer:<intentId>`.
6. Trigger receipt email send (best-effort; email failure does NOT roll back the credit).

#### Scenario: Admin confirms a pending intent
- **GIVEN** an admin token and a pending `intentId`
- **WHEN** they call `POST /auth/billing/bank-transfer/admin/confirm`
- **THEN** the response is `200`
- **AND** the user's subscription has `paidUntil` extended by the plan's period
- **AND** `tier === "paid"`, `provider === "bank-transfer"`, `status === "active"`

#### Scenario: Admin confirm without admin token rejected
- **GIVEN** a user JWT used as the bearer
- **WHEN** they call the admin confirm endpoint
- **THEN** the response is `401`

#### Scenario: Confirm replay is idempotent
- **GIVEN** an intent already confirmed
- **WHEN** the admin confirm is called a second time with the same `intentId`
- **THEN** the response is `200`
- **AND** `paidUntil` is unchanged from the first confirm

#### Scenario: Confirm of expired intent rejected
- **GIVEN** an intent with `expiresAt < now()`
- **WHEN** the admin confirm is called
- **THEN** the response is `410 intent_expired`
- **AND** no subscription state changes

### Requirement: Intent retrieval for the user
`GET /auth/billing/bank-transfer/intent/:intentId` MUST allow the owning user (bearer-auth) to fetch their own intent. Other users MUST get `403`.

#### Scenario: Owner fetches their intent
- **GIVEN** a user who created `intent_abc`
- **WHEN** they `GET /auth/billing/bank-transfer/intent/intent_abc`
- **THEN** the response is `200` with the intent body
- **AND** the body includes `status`, `paidAt` if confirmed

#### Scenario: Other user blocked
- **GIVEN** a user trying to read another user's intent
- **WHEN** they call the GET endpoint
- **THEN** the response is `403`

### Requirement: User cancellation of pending intent
`DELETE /auth/billing/bank-transfer/intent/:intentId` MUST allow the owning user to cancel a still-pending intent (e.g. they decided not to pay). A canceled intent transitions to `status: "canceled"` and MUST NOT be confirmable.

#### Scenario: User cancels their own pending intent
- **GIVEN** a pending intent
- **WHEN** the user calls the DELETE endpoint
- **THEN** response is `200`
- **AND** intent `status === "canceled"`

#### Scenario: Admin confirm of a canceled intent rejected
- **GIVEN** a canceled intent
- **WHEN** the admin confirm is called
- **THEN** response is `410 intent_canceled`

### Requirement: Receipt email on confirmation
Upon successful admin confirmation, the server MUST send a receipt email to the user's stored email address (from the user record) containing `{intentId, vs, plan, periodStart, periodEnd, amount, currency, paidAt}`. The email body MUST NOT contain any vault data, document IDs, or device identifiers other than the user's email and canonical username.

#### Scenario: Receipt sent on confirm
- **GIVEN** a successful admin confirm
- **WHEN** the handler completes
- **THEN** an email is dispatched to the user's email address
- **AND** the email subject contains the plan name
- **AND** the email body contains `vs`, `amount`, `paidAt`

#### Scenario: Email delivery failure does not block credit
- **GIVEN** the email gateway is down at confirm time
- **WHEN** the admin confirm runs
- **THEN** the credit is still applied
- **AND** the failed-email event is logged for retry

### Requirement: Intent expiry sweeper
A periodic sweeper MUST mark intents with `status: "pending"` and `expiresAt < now()` as `status: "expired"`. The sweeper MUST be idempotent (running it a second time is a no-op for already-expired intents).

#### Scenario: Old pending intent reaped
- **GIVEN** a pending intent created 15 days ago
- **WHEN** the sweeper runs
- **THEN** the intent's `status === "expired"`
- **AND** the intent cannot be confirmed afterwards

### Requirement: Bank-API forward compatibility
The admin-confirm endpoint's contract MUST be shaped so that a future bank-API reconciliation job can replace the admin caller without changing the handler's input or output shape. The job authenticates with the same admin token and posts the same payload `{intentId}`. (The job's own implementation — e.g., FIO API polling, VS-to-intentId lookup — is out of scope for this spec but the contract MUST NOT preclude it.)

#### Scenario: Replacing the admin step
- **GIVEN** a future job that polls a bank API and finds a deposit with VS `1234567890`
- **WHEN** the job looks up `payment-intent` by VS, finds `intent_abc`, calls the admin-confirm endpoint with `{intentId: "intent_abc"}`
- **THEN** the credit is applied identically to the manual operator flow

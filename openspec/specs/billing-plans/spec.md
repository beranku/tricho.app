# billing-plans Specification

## Purpose
TBD - created by archiving change paid-plans-billing. Update Purpose after archive.
## Requirements
### Requirement: Plan catalog
The system SHALL define exactly five plan IDs:
- `free` — `tier: "free"`, `billingPeriod: null`, no expiry, no entitlements, `deviceLimit: 1`, `backupRetentionMonths: 0`.
- `pro-monthly` — `tier: "pro"`, `billingPeriod: "month"`, `entitlements: ["sync", "backup"]`, `deviceLimit: 2`, `backupRetentionMonths: 12`, `periodSeconds: 30 * 86400`.
- `pro-yearly` — same as pro-monthly except `billingPeriod: "year"`, `periodSeconds: 365 * 86400`.
- `max-monthly` — `tier: "max"`, `billingPeriod: "month"`, `entitlements: ["sync", "backup"]`, `deviceLimit: 5`, `backupRetentionMonths: 60`, `periodSeconds: 30 * 86400`.
- `max-yearly` — same as max-monthly except `billingPeriod: "year"`, `periodSeconds: 365 * 86400`.

`GET /auth/plans` SHALL return all five with `{id, tier, billingPeriod, label, periodSeconds, amountMinor, currency, deviceLimit, backupRetentionMonths}`. Operator-configured stripe price IDs MUST NOT appear in the public catalog response.

#### Scenario: Catalog returns five plans with correct shape
- **WHEN** an unauthenticated client calls `GET /auth/plans`
- **THEN** the response is `200`
- **AND** the body contains exactly the ids `free`, `pro-monthly`, `pro-yearly`, `max-monthly`, `max-yearly`
- **AND** every paid plan has `entitlements: ["sync", "backup"]`
- **AND** pro plans have `deviceLimit: 2` and `backupRetentionMonths: 12`
- **AND** max plans have `deviceLimit: 5` and `backupRetentionMonths: 60`

#### Scenario: Catalog reflects operator-configured prices
- **GIVEN** env config with custom amounts for each paid plan id
- **WHEN** `GET /auth/plans` is called
- **THEN** each plan's `amountMinor` reflects its env override

### Requirement: Subscription doc shape
The `subscription:user:<canonicalUsername>` doc in `tricho_meta` SHALL contain `{type: "subscription", userId, tier, plan, tierKey, billingPeriod, provider, status, entitlements, deviceLimit, backupRetentionMonths, paidUntil, gracePeriodSeconds, freeDeviceGrandfathered, stripeCustomerId?, stripeSubscriptionId?, updatedAt}`. `tier` is `"free"` or `"paid"`. `tierKey` is `"free" | "pro" | "max"`. `billingPeriod` is `"month" | "year" | null`.

#### Scenario: Free user subscription shape
- **GIVEN** a newly provisioned free user
- **WHEN** their subscription doc is read
- **THEN** the doc has `tier: "free"`, `plan: "free"`, `tierKey: "free"`, `billingPeriod: null`, `entitlements: []`, `paidUntil: null`, `deviceLimit: 1`, `backupRetentionMonths: 0`

#### Scenario: Paid pro-yearly user subscription shape
- **GIVEN** a user who paid for `pro-yearly` via Stripe
- **WHEN** the subscription doc is read
- **THEN** the doc has `tier: "paid"`, `plan: "pro-yearly"`, `tierKey: "pro"`, `billingPeriod: "year"`, `entitlements: ["sync", "backup"]`, `deviceLimit: 2`, `backupRetentionMonths: 12`

#### Scenario: Paid max-monthly user subscription shape
- **GIVEN** a user who paid for `max-monthly` via bank transfer
- **WHEN** the subscription doc is read
- **THEN** the doc has `tier: "paid"`, `plan: "max-monthly"`, `tierKey: "max"`, `billingPeriod: "month"`, `entitlements: ["sync", "backup"]`, `deviceLimit: 5`, `backupRetentionMonths: 60`

### Requirement: Entitlement check is the gate
The system SHALL gate `live-sync` and `encrypted-backup` solely on `subscription.entitlements`. A request to a sync endpoint MUST be allowed iff `entitlements.includes("sync")` AND (`paidUntil >= now() - gracePeriodSeconds * 1000` OR `paidUntil === null` AND entitlements is not empty). Backup endpoints MUST follow the same rule with `"backup"`.

#### Scenario: Free user blocked from sync
- **GIVEN** a user with `entitlements: []`
- **WHEN** they request `GET /userdb-<hex>/_changes`
- **THEN** the request is rejected with `402 plan_expired`

#### Scenario: Paid user inside grace window allowed to sync
- **GIVEN** a paid user, `paidUntil = now() - 3d`, `gracePeriodSeconds = 7d`
- **WHEN** they request `GET /userdb-<hex>/_changes`
- **THEN** the request passes through with a `tricho-grace-ends-at` header

#### Scenario: Paid user past grace window blocked
- **GIVEN** a paid user, `paidUntil = now() - 8d`, `gracePeriodSeconds = 7d`
- **WHEN** they request `GET /userdb-<hex>/_changes`
- **THEN** the request is rejected with `402 plan_expired`

### Requirement: paidUntil math
When crediting a paid period, the server MUST compute `paidUntil_new = max(now(), paidUntil_old) + periodSeconds`. Crediting MUST also update `tierKey`, `billingPeriod`, `deviceLimit`, and `backupRetentionMonths` to match the credited plan. Crediting MUST NOT shorten `paidUntil`.

#### Scenario: Renewing 5 days early extends from existing paidUntil
- **GIVEN** `paidUntil_old = now() + 5 * 86400 * 1000` and a `pro-monthly` credit
- **WHEN** the credit is applied
- **THEN** `paidUntil_new = paidUntil_old + 30 * 86400 * 1000`

#### Scenario: Crediting upgrades subscription tier fields
- **GIVEN** a free user
- **WHEN** a `max-yearly` credit is applied
- **THEN** the subscription has `tierKey: "max"`, `billingPeriod: "year"`, `deviceLimit: 5`, `backupRetentionMonths: 60`

### Requirement: Plan changes — concurrent provider prevention
A user MUST NOT have two active paid subscriptions across providers. If a user holds an active Stripe subscription, `POST /auth/billing/bank-transfer/intent` MUST return `409 conflict`.

#### Scenario: Bank-transfer intent blocked while Stripe is active
- **GIVEN** a user with `provider: "stripe", status: "active"`
- **WHEN** they call `POST /auth/billing/bank-transfer/intent`
- **THEN** the response is `409 conflict`

### Requirement: Cancel at period end
`POST /auth/subscription/cancel` MUST set `status: "canceled"` without clearing `paidUntil`. Stripe subscriptions MUST be told `cancel_at_period_end: true`.

#### Scenario: Stripe cancel keeps service to paidUntil
- **GIVEN** a Stripe subscription with `paidUntil = now() + 14 * 86400 * 1000`
- **WHEN** the user calls `POST /auth/subscription/cancel`
- **THEN** Stripe is told `cancel_at_period_end: true`
- **AND** the local subscription doc has `status: "canceled"` with `paidUntil` unchanged

### Requirement: Idempotent payment-event dedup
The server MUST maintain a dedup table keyed by `(provider, eventId)`. Repeat events MUST not credit twice.

#### Scenario: Stripe webhook retry is absorbed
- **GIVEN** a Stripe `invoice.paid` event already processed
- **WHEN** the same event is delivered again
- **THEN** `paidUntil` is unchanged

### Requirement: Free-tier device limit with grandfather
A user with `tier: "free"` SHALL have `deviceLimit: 1`. The OAuth callback MUST allow up to `deviceLimit` active devices, except when `freeDeviceGrandfathered === true` in which case it MUST allow up to 2.

#### Scenario: New free user blocked at second device
- **GIVEN** a free user with one active device, `freeDeviceGrandfathered: false`
- **WHEN** they OAuth on a second device
- **THEN** `deviceApproved === false`

#### Scenario: Pro user can add up to 2 devices
- **GIVEN** a pro user with one active device
- **WHEN** they OAuth on a second device
- **THEN** `deviceApproved === true`

#### Scenario: Max user can add up to 5 devices
- **GIVEN** a max user with four active devices
- **WHEN** they OAuth on a fifth device
- **THEN** `deviceApproved === true`

### Requirement: Migration backfills tier model fields
A one-shot migration SHALL transform existing subscription docs to add `tierKey`, `billingPeriod`, `backupRetentionMonths` and update `deviceLimit` to match the new tier defaults. Legacy `sync-monthly`/`sync-yearly` plans MUST be mapped to `pro-monthly`/`pro-yearly`. The migration MUST be idempotent.

#### Scenario: Legacy sync-yearly maps to pro-yearly
- **GIVEN** a pre-change subscription doc with `plan: "sync-yearly"`
- **WHEN** the migration runs
- **THEN** the doc has `plan: "pro-yearly"`, `tierKey: "pro"`, `billingPeriod: "year"`, `backupRetentionMonths: 12`

#### Scenario: Free user with two active devices is grandfathered
- **GIVEN** a pre-change `tier: "free"` user with two active devices and no `tierKey`
- **WHEN** the migration runs
- **THEN** the doc has `deviceLimit: 1`, `freeDeviceGrandfathered: true`, `tierKey: "free"`, `backupRetentionMonths: 0`

#### Scenario: Migration is idempotent
- **GIVEN** the migration has already run once
- **WHEN** it is run a second time
- **THEN** no doc requires another write


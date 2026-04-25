## MODIFIED Requirements

### Requirement: Subscription-based device limit
Each user MUST have an associated subscription record (default `tier: "free", plan: "free", deviceLimit: 1, entitlements: [], freeDeviceGrandfathered: false`). A callback that would exceed `deviceLimit` MUST return `deviceApproved: false` and MUST NOT issue tokens or register the new device. When `freeDeviceGrandfathered === true`, the effective limit MUST be `max(deviceLimit, 2)` so grandfathered users can keep their two existing devices but cannot add a third.

#### Scenario: Third device on free tier
- GIVEN a free-tier user with two active, non-revoked devices, `freeDeviceGrandfathered: false`
- WHEN they complete OAuth on a third device
- THEN the response's `deviceApproved === false`
- AND the response carries the existing devices so the client can render a revoke UI
- AND no refresh token is minted for the new device

#### Scenario: Second device on new free tier blocked
- GIVEN a free-tier user with one active device, `freeDeviceGrandfathered: false`, `deviceLimit: 1`
- WHEN they complete OAuth on a second device
- THEN `deviceApproved === false`
- AND no refresh token is minted

#### Scenario: Grandfathered free user's two existing devices both work
- GIVEN a free-tier user with two active devices, `freeDeviceGrandfathered: true`, `deviceLimit: 1`
- WHEN they complete OAuth on either of those two known devices
- THEN `deviceApproved === true`

#### Scenario: Grandfathered free user blocked at third device
- GIVEN a free-tier user with two active devices, `freeDeviceGrandfathered: true`, `deviceLimit: 1`
- WHEN they complete OAuth on a third device
- THEN `deviceApproved === false`

#### Scenario: Paid user has effectively unlimited devices
- GIVEN a paid user with `deviceLimit: 100` (operator default for paid)
- WHEN they complete OAuth on a fifth device
- THEN `deviceApproved === true`

## ADDED Requirements

### Requirement: Subscription record carries entitlements
The subscription record MUST include `entitlements: string[]` whose value is `[]` for `tier: "free"` and `["sync", "backup"]` for `tier: "paid"` with an active or in-grace `paidUntil`. The record MUST also include `provider: null | "stripe" | "bank-transfer"`, `status: "active" | "past_due" | "canceled" | "expired"`, and `plan: "free" | "sync-monthly" | "sync-yearly"`.

#### Scenario: Free user record has empty entitlements
- GIVEN a newly provisioned free user
- WHEN their subscription record is read
- THEN `entitlements === []`
- AND `plan === "free"`, `provider === null`, `status === "active"`

#### Scenario: Paid user record carries sync + backup entitlements
- GIVEN a user whose Stripe subscription was activated by a webhook
- WHEN the subscription record is read
- THEN `entitlements` contains `"sync"` and `"backup"`
- AND `plan` matches the paid plan, `provider === "stripe"`, `status === "active"`

### Requirement: Subscription endpoint surface
`GET /auth/subscription` MUST return `{tier, plan, provider, status, entitlements, deviceLimit, paidUntil, gracePeriodEndsAt, freeDeviceGrandfathered, stripeCustomerId?, stripeSubscriptionId?}`. `gracePeriodEndsAt` MUST be `paidUntil + gracePeriodSeconds` for paid users, or `null` for free users.

#### Scenario: Free user response shape
- GIVEN a free user
- WHEN they call `GET /auth/subscription` with a valid bearer
- THEN the response is `200`
- AND the body contains `entitlements: []`, `plan: "free"`, `paidUntil: null`, `gracePeriodEndsAt: null`

#### Scenario: Paid user response includes grace deadline
- GIVEN a paid user with `paidUntil = now() + 14 * 86400`, `gracePeriodSeconds = 7 * 86400`
- WHEN they call `GET /auth/subscription`
- THEN `gracePeriodEndsAt === paidUntil + 7 * 86400`

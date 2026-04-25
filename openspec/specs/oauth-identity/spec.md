# oauth-identity Specification

## Purpose

Identity-only OAuth: Google and Apple OIDC drive server-side user provisioning, device registration, and subscription-based gating, but never touch the encryption path. Users get a stable human identity on the server, multi-device bootstrap without typing long secrets, and a gateable seat model for future paid tiers. The encryption layer stays untouched — OAuth-authenticated identity does not grant data decryption.

Source files:
- Server: `infrastructure/couchdb/tricho-auth/routes.mjs`, `providers/google.mjs`, `providers/apple.mjs`, `meta.mjs`.
- Client: `src/auth/oauth.ts`, `src/components/OAuthScreen.tsx`, `src/components/DeviceLimitScreen.tsx`.
## Requirements
### Requirement: Google + Apple OIDC supported
The server MUST expose `/auth/google/start`, `/auth/google/callback`, `/auth/apple/start`, `/auth/apple/callback`. Each provider's callback MUST verify the id_token signature and accept only email-verified accounts (or Apple's private-relay addresses, which count as verified by construction).

#### Scenario: Unverified Google email rejected
- GIVEN a Google id_token with `email_verified === false`
- WHEN the callback runs
- THEN provisioning fails and the client receives an error response

### Requirement: Canonical CouchDB username per OAuth subject
The canonical username stored server-side MUST be derived from the OAuth `sub` (not email) so an email change does not break the user's data. Format: `"<provider>_<hex(sha-256(provider|sub))[:32]>"` — for example `g_…` / `a_…`.

#### Scenario: Email change preserves identity
- GIVEN a Google account with stable `sub` `12345`
- WHEN the user changes their primary Gmail address
- THEN the canonical CouchDB username is unchanged
- AND their user row's `email` field is updated in place

### Requirement: Device registry
The server MUST maintain a per-user device list with `{deviceId, name, addedAt, lastSeenAt, revoked}`. The `deviceId` cookie MUST be set on the callback response so subsequent visits identify the same device.

#### Scenario: First callback registers a device
- GIVEN a user signing in on a fresh browser profile
- WHEN the OAuth callback completes
- THEN a new device row exists for that user
- AND the browser carries a `tricho_device` cookie

#### Scenario: Returning on the same device
- GIVEN a user who already has a registered device
- WHEN they sign in again from the same browser
- THEN no new device row is created
- AND `lastSeenAt` on the existing row advances

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

### Requirement: Device revoke is authenticated + idempotent
`DELETE /auth/devices/:id` MUST require a valid Bearer JWT belonging to the same user. Revoking a device MUST invalidate all refresh tokens for that device. Revoking a non-existent device MUST return `404`.

#### Scenario: Revoke frees a slot
- GIVEN a user at the device limit
- WHEN one existing device is revoked
- THEN a subsequent OAuth callback on a new device succeeds
- AND the newly revoked device's next sync request fails with `401`

### Requirement: Callback does not put tokens in URLs
The callback response MUST deliver tokens to the browser as the JSON payload embedded in the returned HTML (which stores it to `sessionStorage` briefly), never as query-string or hash parameters.

#### Scenario: Referrer leak check
- GIVEN a completed callback
- WHEN `document.referrer` or `location.search` is inspected after the redirect
- THEN no bearer token appears

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


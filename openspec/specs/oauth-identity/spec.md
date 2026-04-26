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

### Requirement: Apple OIDC URLs are env-derived
`infrastructure/couchdb/tricho-auth/providers/apple.mjs` MUST derive the issuer, authorize endpoint, token endpoint, and JWKS URL from a single `APPLE_OIDC_ISSUER` env var. When the var is unset, the provider MUST default to `https://appleid.apple.com`. The four URLs MUST be derived as `${issuer}` (issuer claim), `${issuer}/auth/authorize`, `${issuer}/auth/token`, `${issuer}/auth/keys`. No URL fragment may be hardcoded as a constant in the source.

#### Scenario: Default issuer
- **GIVEN** `APPLE_OIDC_ISSUER` is unset
- **WHEN** an Apple authorize is initiated
- **THEN** the redirect URL hostname is `appleid.apple.com`

#### Scenario: CI override
- **GIVEN** `APPLE_OIDC_ISSUER=http://mock-oidc:8080/apple`
- **WHEN** an Apple authorize is initiated
- **THEN** the redirect URL hostname is `mock-oidc`
- **AND** id_token verification fetches JWKS from `http://mock-oidc:8080/apple/auth/keys`

### Requirement: Apple `name` claim handled correctly across logins
`providers/apple.mjs`'s `handleCallback` MUST persist `name` to the user record on the first login (when the `user` form field is present) and MUST NOT overwrite a previously stored non-null name when the field is absent on subsequent logins. Returning users with no `user` field MUST still be authenticated successfully.

#### Scenario: First login persists the name
- **GIVEN** a brand-new Apple `sub`
- **WHEN** the provider's callback runs and `form.user` parses to `{name: {firstName: "Anna", lastName: "Nováková"}}`
- **THEN** the returned identity object's `name` equals `"Anna Nováková"`

#### Scenario: Returning user does not lose name
- **GIVEN** a `sub` whose user record has `name: "Anna Nováková"`
- **WHEN** the provider's callback runs and `form.user` is absent
- **THEN** the user-row in `tricho_meta` retains `name: "Anna Nováková"`
- **AND** the callback returns identity with `name: null` (the persistence layer is responsible for the merge)

### Requirement: Apple private-relay emails treated as verified
`providers/apple.mjs` MUST accept identities whose `email` ends in `@privaterelay.appleid.com` even if `email_verified` is absent or false in the id_token, because Apple's private relay emails are verified by construction. Identities without a private-relay email MUST require `email_verified === true`, matching Google's rule.

#### Scenario: Private relay accepted without explicit verification flag
- **GIVEN** an Apple id_token with `email: "abc123@privaterelay.appleid.com"` and no `email_verified` field
- **WHEN** the callback runs
- **THEN** the identity is accepted
- **AND** the user is provisioned

#### Scenario: Non-relay unverified Apple email rejected
- **GIVEN** an Apple id_token with `email: "user@example.com"` and `email_verified: false`
- **WHEN** the callback runs
- **THEN** the callback throws `email_not_verified`

### Requirement: Wrong issuer or audience is rejected at id_token verification
Both `providers/google.mjs` and `providers/apple.mjs` MUST reject id_tokens whose `iss` does not equal the configured issuer URL or whose `aud` does not equal the configured client ID. Verification MUST happen against the JWKS published by the configured issuer (no JWKS-on-claim trust).

#### Scenario: Forged issuer rejected
- **GIVEN** an id_token signed by a key in `mock-oidc`'s `/google/...` JWKS but with `iss` rewritten to `https://accounts.google.com`
- **WHEN** the provider attempts verification with `GOOGLE_ISSUER_URL=http://mock-oidc:8080/google`
- **THEN** verification throws an issuer-mismatch error
- **AND** no user is provisioned

#### Scenario: Wrong audience rejected
- **GIVEN** an id_token whose `aud` is `wrong-client-id`
- **WHEN** the provider attempts verification
- **THEN** verification throws an audience-mismatch error

### Requirement: Refresh token honors id_token expiration
The client-side OIDC plumbing in `src/auth/oauth.ts` MUST refresh the id_token before its `exp` claim lapses by exchanging the refresh token via `/auth/refresh`. Expired access tokens that have not been refreshed MUST cause subsequent API calls to surface a 401 that the UI handles by routing to a re-auth screen, not a silent retry loop.

#### Scenario: Token refreshed before expiry
- **GIVEN** an id_token with `exp = now + 60`
- **WHEN** 30 seconds elapse
- **THEN** `src/auth/oauth.ts` initiates a `/auth/refresh` call
- **AND** the new id_token's `exp` is at least 60 seconds in the future

#### Scenario: Expired token surfaces 401 to the UI
- **GIVEN** an id_token whose `exp` has lapsed and refresh has failed
- **WHEN** the next API call is attempted
- **THEN** the UI receives a 401
- **AND** the user is routed to the re-auth screen
- **AND** there is no infinite refresh-then-retry loop


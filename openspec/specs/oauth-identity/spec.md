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
Each user MUST have an associated subscription record (default `tier: "free", deviceLimit: 2`). A callback that would exceed `deviceLimit` MUST return `deviceApproved: false` and MUST NOT issue tokens or register the new device.

#### Scenario: Third device on free tier
- GIVEN a free-tier user with two active, non-revoked devices
- WHEN they complete OAuth on a third device
- THEN the response's `deviceApproved === false`
- AND the response carries the existing devices so the client can render a revoke UI
- AND no refresh token is minted for the new device

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

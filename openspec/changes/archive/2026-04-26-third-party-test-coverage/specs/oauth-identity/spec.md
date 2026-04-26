## ADDED Requirements

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

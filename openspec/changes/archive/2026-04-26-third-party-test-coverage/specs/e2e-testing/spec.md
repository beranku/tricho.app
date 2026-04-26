## ADDED Requirements

### Requirement: Apple OAuth round-trip is covered end-to-end
The Playwright suite MUST include a spec at `tests/e2e/apple-oauth-roundtrip.spec.ts` that drives `/auth/apple/start`, completes the form_post callback against the `mock-oidc` Apple tenant, and lands on the PWA with `sessionStorage['tricho-oauth-result']` populated. The spec MUST work without any real Apple credentials and without any network egress beyond the `tricho.test` Traefik edge.

#### Scenario: Happy-path Apple login completes
- **GIVEN** the `ci` profile up with `mock-oidc` serving the `/apple/*` tenant
- **WHEN** the spec sets the next mock identity via `POST /mock-oidc/apple/mock/identity` and navigates to `/auth/apple/start`
- **THEN** the browser performs the form_post callback to `/auth/apple/callback`
- **AND** the PWA reaches its post-OAuth state with the expected `sessionStorage` payload

### Requirement: Apple `name` first-vs-returning behaviour is asserted in e2e
The Playwright suite MUST include a spec that asserts the Apple `name` claim arrives only on the first authorization for a given `sub`. The spec MUST seed an identity, complete OAuth, and assert the user's display name in the UI matches the seeded name; then it MUST trigger a second OAuth round-trip for the same `sub` and assert the display name is unchanged (i.e. the server did not overwrite a known name with `null`).

#### Scenario: Second login does not erase the name
- **GIVEN** Device A signed in via Apple with seeded `name: "Anna Nováková"`
- **WHEN** the same `sub` signs in a second time without a `user` form field
- **THEN** the post-OAuth UI still displays `Anna Nováková`
- **AND** the user row in `tricho_meta` retains `name: "Anna Nováková"`

### Requirement: Private-relay email is accepted end-to-end
A Playwright spec MUST cover the case where Apple returns an `@privaterelay.appleid.com` email. The spec MUST seed `is_private_email: true` on the mock identity and assert the user is provisioned successfully and the email surfaces in the settings UI as the private-relay address.

#### Scenario: Private-relay user provisioned
- **GIVEN** an Apple identity seeded with `email: "abc123@privaterelay.appleid.com", is_private_email: true`
- **WHEN** the user completes Apple OAuth
- **THEN** the user is provisioned
- **AND** `Settings → Account` displays the private-relay address

### Requirement: Stripe Checkout happy path is covered end-to-end
The Playwright suite MUST include `tests/e2e/stripe-checkout.spec.ts` that drives a paid-plan checkout against the `localstripe` mock. The spec MUST start from a free signed-in user, click the "Upgrade" CTA, complete Checkout (filling the test card via the Elements iframe served by `localstripe`'s shim), and observe that after the resulting webhook is delivered to `/auth/billing/stripe/webhook`, the user's `Settings → Plan` reflects the paid tier.

#### Scenario: Checkout completes and webhook flips the user to paid
- **GIVEN** a free user signed in via mock OIDC
- **WHEN** the spec drives Checkout against `localstripe` with a successful test card
- **AND** `localstripe` delivers `customer.subscription.created` + `invoice.paid` webhooks to `tricho-auth`
- **THEN** the PWA's `Settings → Plan` shows the paid plan
- **AND** the test completes within 60 seconds

### Requirement: Token refresh path is covered end-to-end
The Playwright suite MUST include a spec that asserts the client-side OIDC plumbing in `src/auth/oauth.ts` refreshes its id_token before expiry without bouncing the user back to the login screen. The spec MUST seed a short-lived id_token (`exp = now + 30 s`) via the mock-oidc, navigate to the app, idle for ≥ 30 s, then make an authenticated API call.

#### Scenario: Idle past expiry still authenticated
- **GIVEN** a mock-oidc identity that mints id_tokens with `expires_in: 30`
- **WHEN** the spec waits 35 seconds after sign-in
- **AND** then triggers an authenticated API call
- **THEN** the call succeeds
- **AND** the network log shows a `/auth/refresh` call between sign-in and the API call

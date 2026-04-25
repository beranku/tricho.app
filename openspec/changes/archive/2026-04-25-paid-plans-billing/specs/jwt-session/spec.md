## ADDED Requirements

### Requirement: JWT alone does not confer sync access
Possession of a valid bearer JWT MUST NOT, by itself, grant access to `/userdb-*/*`. The entitlement proxy in `tricho-auth` MUST gate sync access on subscription state independent of JWT validity. JWT shape (claims, TTL, kid binding) is unchanged.

#### Scenario: Valid JWT + free plan = sync denied
- GIVEN a free user with a fresh, valid JWT
- WHEN they make a `GET /userdb-<hex>/_changes` request
- THEN the request is rejected with `402 plan_expired`
- AND no CouchDB call is made

#### Scenario: Valid JWT + paid plan = sync allowed
- GIVEN a paid user with a fresh, valid JWT
- WHEN they make the same request
- THEN the entitlement proxy forwards to CouchDB
- AND the response is whatever CouchDB returns

#### Scenario: JWT continues to work for /auth/* endpoints regardless of plan
- GIVEN a free user with a valid JWT
- WHEN they call `GET /auth/subscription`, `GET /auth/devices`, or `POST /auth/billing/stripe/checkout`
- THEN the request succeeds
- AND no entitlement check applies (these are auth-control-plane endpoints, not sync)

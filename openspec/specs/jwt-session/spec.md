# jwt-session Specification

## Purpose

Short-lived RS256 JWT access tokens signed by `tricho-auth`, validated statelessly by CouchDB. Paired with long-lived refresh tokens that rotate on every use and are bound to a `deviceId`. The refresh token itself is stored on the device only inside the vault DEK-encrypted `_local/server-identity` doc, so possession of the IndexedDB alone does not allow a silent takeover. Tabs coordinate via BroadcastChannel so at most one refresh runs at a time.

Source files:
- Server: `infrastructure/couchdb/tricho-auth/jwt.mjs`, `infrastructure/couchdb/tricho-auth/routes.mjs`.
- Client: `src/auth/token-store.ts`, `src/auth/oauth.ts`, `src/sync/tab-channel.ts`.

## Requirements

### Requirement: RS256 JWT with `kid`
Access tokens MUST be RS256-signed JWTs whose header includes a `kid` matching a key registered in CouchDB's `[jwt_keys]` config. Claims MUST include `iss === "tricho-auth"`, `aud === "couchdb"`, `sub` (the CouchDB username), `iat`, and `exp`.

#### Scenario: CouchDB accepts the JWT
- GIVEN an access token freshly issued by tricho-auth
- WHEN a request is made to `/userdb-<hex>/` with `Authorization: Bearer <jwt>`
- THEN CouchDB validates the signature against the matching `kid`
- AND the request succeeds

### Requirement: Access TTL 60 min, refresh TTL 90 days
Access tokens MUST expire ~60 minutes after issuance. Refresh tokens MUST expire ~90 days after issuance.

#### Scenario: Expired JWT is rejected by CouchDB
- GIVEN an access token issued more than 60 minutes ago
- WHEN it is presented on a CouchDB request
- THEN CouchDB responds `401`

#### Scenario: Expired refresh token is rejected by the server
- GIVEN a refresh token whose `expiresAt` is in the past
- WHEN it is presented to `POST /auth/refresh`
- THEN the server responds `401 invalid_refresh_token`
- AND does not mint new tokens

### Requirement: Refresh rotates on every use
`POST /auth/refresh` MUST revoke the presented refresh token and mint a new refresh token alongside the new access token. Replay of the old refresh token MUST be rejected.

#### Scenario: Replay detection
- GIVEN refresh token `T1`
- WHEN `T1` is used to refresh, producing `T2`
- AND later the same `T1` is presented again
- THEN the request is rejected with `401 invalid_refresh_token`

### Requirement: Device binding
Refresh tokens MUST be bound to the `deviceId` they were issued under. A refresh whose presented `deviceId` does not match the stored binding MUST revoke the refresh token and return `401 device_mismatch`.

#### Scenario: Stolen token on a foreign device
- GIVEN a refresh token minted for device `dev-A`
- WHEN it is presented with `deviceId: "dev-B"`
- THEN the server revokes it
- AND returns `401`

### Requirement: Refresh token stored only DEK-encrypted
The client MUST persist the refresh token only inside a `_local/server-identity` document whose `payload` is produced by `payload-encryption`. It MUST NOT leave plaintext in `localStorage`, `sessionStorage`, or any cookie.

#### Scenario: IndexedDB exfiltration is useless
- GIVEN a malicious process that reads IndexedDB while the vault is locked
- WHEN it inspects `_local/server-identity`
- THEN the `payload` is AEAD ciphertext
- AND no field of it contains a plaintext bearer

### Requirement: `_local/…` means local-only
The `_local/server-identity` doc MUST NOT replicate to CouchDB.

#### Scenario: Server never sees the refresh token
- GIVEN a fully synced device
- WHEN the per-user CouchDB is inspected
- THEN no `_local/server-identity` document exists

### Requirement: One refresh in flight at a time
The client MUST guard against concurrent refreshes; when `ensureFreshJwt` is called while a refresh is already running, both callers MUST await the same promise.

#### Scenario: Ten parallel requests, one refresh
- GIVEN ten simultaneous `bearerFetch` calls after the JWT has expired
- WHEN they all invoke `ensureFreshJwt`
- THEN only one `POST /auth/refresh` goes out

### Requirement: BroadcastChannel cross-tab sharing
After a successful refresh, the token store MUST post a `{type: 'jwt', jwt, jwtExp}` message on the `tricho-auth-<vaultId>` BroadcastChannel. Tabs that receive it MUST adopt the new JWT without issuing their own refresh.

#### Scenario: Two tabs, one refresh
- GIVEN two tabs of the PWA with an expiring JWT
- WHEN tab A refreshes
- THEN tab B adopts A's new JWT via the broadcast
- AND tab B does not make its own `/auth/refresh` call

### Requirement: JWKS published publicly
The server MUST expose `GET /auth/.well-known/jwks.json` returning the public key(s) with the `kid`(s) currently in use, cache-controlled, so future clients or operators can validate tokens offline.

#### Scenario: JWKS endpoint returns signing keys
- GIVEN a running `tricho-auth` with a configured key pair
- WHEN a client performs `GET /auth/.well-known/jwks.json`
- THEN the response is `200` with a `keys` array
- AND each key carries `kid`, `kty`, `alg`, and `use: "sig"`
- AND the response has a `cache-control` header permitting short-term caching
